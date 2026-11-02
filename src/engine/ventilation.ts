// Zone ventilation and AHU ventilation: port of workbook sheet C7_Air (pilot r8, the newest C7).
// ASHRAE 62.1-2022 Ventilation Rate Procedure §6.2 with Appendix A, exhaust §6.5, air classes §5.13.
// Column letters in comments refer to C7_Air; AHU cells to C7_Air C60:C92.

import { ceiling, isBlank, n, round, sum, textEq } from "./excel";
import { lookup, type Vent621Libraries, type VentExhaustRow, type VentZoneRow } from "./libraries";

export type SysType = "CAV" | "VAV";
export type VentSysSetting = "Auto" | "Single-zone" | "Multiple-zone" | "100% OA";
export type VentSys = Exclude<VentSysSetting, "Auto">;
export type EvMethod = "Appendix A" | "Simplified";

/** 01_Project air-side inputs. Defaults marked "workbook choice" are not ASHRAE values. */
export interface AirSideSettings {
  sysType: SysType; // in_SysType B7
  ventSys: VentSysSetting; // in_VentSys B47
  evMethod: EvMethod; // in_EvMethod B48
  ps: number | null; // in_Ps B49, null = ΣPz
  ezDefault: string; // in_EzDefault B50 (Table 6-4 ID)
  vavMin: number; // in_VAVmin B51 — workbook choice 0.30
  pressurization: number; // in_Pressurize B52, cfm
  cfmRound: number; // in_cfmRound B53 — workbook choice 5; 0 = no rounding
  zpzMax: number; // in_ZpzMax B54 — workbook choice 0.40; 1 = off
  exhMakeup: number; // in_ExhMakeup B56 — workbook choice 0.9; 0 = off
}

/** 02_Spaces columns used by C7. */
export interface VentSpace {
  id: string; // A
  name: string; // B
  area: number; // C, ft²
  ventCat: string; // E, Table 6-1 category
  people: number | null; // F, Pz; null = default density
  exhType: string | null; // O, Table 6-2 type
  exhCfm: number | null; // P, exhaust override
  xferTo: string | null; // Q, comma list of Space IDs
  ez: string | null; // V, Table 6-4 ID; null = project default
  exhUnits: number | null; // W
  xferCfm: number | null; // X, transfer override
}

export interface Issue {
  room?: string;
  severity: "error" | "flag";
  code: string;
  text: string;
}

/** 01_Project B55 calc_VentSys: Auto = Single-zone for one space, else Multiple-zone. */
export function resolveVentSys(setting: VentSysSetting, spaceCount: number): VentSys {
  if (setting !== "Auto") return setting;
  return spaceCount <= 1 ? "Single-zone" : "Multiple-zone";
}

/** C7 G and I: sizing sensible × (1 + SF), then cfm = max(0, G) / (Cs · ΔT). */
export function supplyCfmFromLoad(sensible: number, sf: number, cs: number, dTsupply: number): number {
  return Math.max(0, sensible * (1 + sf)) / (cs * dTsupply);
}

// ---------------------------------------------------------------------------------------------
// Step 1: zone ventilation (needs no load data)

export interface ZoneVent {
  id: string;
  ventRow?: VentZoneRow; // cited Table 6-1 row
  Rp: number; // K
  Ra: number; // L
  Pz: number; // M
  PzFromDefaultDensity: boolean;
  Vbz: number; // N, Eq. 6-1
  Ez: number; // O
  Voz: number; // P, Eq. 6-2
  exhaust: number; // Q
  exhRow?: VentExhaustRow;
  airClass: number; // V
  RpPz: number; // AF
  RaAz: number; // AG
  issues: Issue[];
}

export function zoneVentilation(s: VentSpace, set: AirSideSettings, lib: Vent621Libraries): ZoneVent {
  const issues: Issue[] = [];
  const err = (code: string, text: string) => issues.push({ room: s.id, severity: "error", code, text });

  const ventRow = lookup(lib.zone.rows, (r) => r.category, s.ventCat);
  if (!ventRow) err("vent-cat-missing", `62.1 category "${s.ventCat}" not in Table 6-1 library`);
  else if (ventRow.scope === "workbook")
    issues.push({ room: s.id, severity: "flag", code: "not-621-category", text: `"${ventRow.category}" is a workbook row, not a 62.1 category` });

  const Rp = ventRow ? n(ventRow.Rp_cfm_per_person) : NaN;
  const Ra = ventRow ? n(ventRow.Ra_cfm_per_ft2) : NaN;

  // M: entered people, else area × default density / 1000
  const PzFromDefaultDensity = s.people === null;
  const Pz = s.people ?? (ventRow ? (s.area * n(ventRow.default_density_per_1000ft2)) / 1000 : NaN);
  if (PzFromDefaultDensity)
    issues.push({ room: s.id, severity: "flag", code: "pz-default-density", text: "Pz from 62.1 default density (ventilation only; people load uses the entered count)" });

  const Vbz = Rp * Pz + Ra * s.area;

  const ezId = isBlank(s.ez) ? set.ezDefault : s.ez;
  const ezRow = lookup(lib.ez.rows, (r) => r.id, ezId);
  if (!ezRow) err("ez-missing", `Ez configuration "${ezId}" not in Table 6-4 library`);
  const Ez = ezRow ? ezRow.Ez : NaN;
  const Voz = Vbz / Ez;

  // Q: override, else Table 6-2 cfm/unit × units + cfm/ft² × area
  let exhaust = 0;
  let exhRow: VentExhaustRow | undefined;
  if (!isBlank(s.exhType)) {
    exhRow = lookup(lib.exhaust.rows, (r) => r.type, s.exhType);
    if (!exhRow && s.exhCfm === null) err("exh-type-missing", `Exhaust type "${s.exhType}" not in Table 6-2 library`);
  }
  if (s.exhCfm !== null) exhaust = s.exhCfm;
  else if (!isBlank(s.exhType))
    exhaust = exhRow ? n(exhRow.cfm_per_unit) * n(s.exhUnits) + n(exhRow.cfm_per_ft2) * s.area : NaN;

  // V: max of Table 6-1 and Table 6-2 air class
  const airClass = Math.max(ventRow ? n(ventRow.air_class) : NaN, isBlank(s.exhType) ? 0 : exhRow ? n(exhRow.air_class) : NaN);

  return { id: s.id, ventRow, Rp, Ra, Pz, PzFromDefaultDensity, Vbz, Ez, Voz, exhaust, exhRow, airClass, RpPz: Rp * Pz, RaAz: Ra * s.area, issues };
}

// ---------------------------------------------------------------------------------------------
// Step 3: room supply, transfer, return, and the AHU ventilation block

export type SupplyGovernor = "load" | "Voz" | "exhaust makeup" | "1.5·Voz (Simplified VAV)" | "Voz / ZpzMax";

export interface RoomAir {
  id: string;
  loadCfm: number; // I
  supply: number; // R
  governedBy: SupplyGovernor;
  Vpz: number; // S, Vpz for Zpz
  Zpz: number | "no air"; // T, Eq. A-3
  Evz: number | null; // U, Eq. A-2
  xferTo: string[]; // W, parsed
  xferOut: number; // X
  xferIn: number; // Y
  ret: number; // Z
  cfmPerFt2: number | null; // AA
  exhaustCheck: "—" | "PASS" | "FAIL"; // AB §6.5.1.2
  transferCheck: "—" | "PASS" | "FAIL"; // AC §5.13.3
  zoneCheck: "PASS" | "FAIL"; // AD
  zoneCheckDetail: string; // AE
  destinations: number; // AH
  sourcesHere: number; // AI
  shortfall: number; // AJ
  xferOverride: number; // AK, -1 = none
}

export interface BlockLoad {
  sensibleWorst: number; // C65, AHU block room sensible, worst month (Btu/h)
  sf: number; // in_SF
  cs: number; // calc_Cs
  dTsupply: number; // in_dTsupply
}

export interface AhuVent {
  ventSys: VentSys; // C60
  sysType: SysType; // C61
  sumSupply: number; // C62
  blockSupply: number; // C66
  sumVavMin: number; // C67
  Vps: number; // C68
  sumPz: number; // C69
  Ps: number; // C70
  D: number; // C71, Eq. 6-6
  sumRpPz: number; // C72
  sumRaAz: number; // C73
  Vou: number; // C74, Eq. 6-5
  Xs: number; // C75, Eq. A-1
  EvSimplified: number; // C76, Eq. 6-7/6-8
  EvAppendixA: number; // C77, Eq. A-9
  Ev: number; // C78
  VotVRP: number; // C79
  sumExhaust: number; // C80
  pressurization: number; // C81
  Vot: number; // C82, design OA intake
  oaGovernedBy: string; // C83
  oaFraction: number; // C84
  recirculated: number; // C85
  sumReturn: number; // C86
  relief: number; // C87
  cfmPerFt2: number; // C91
  systemCheck: "PASS" | "FAIL"; // C92
}

export interface AirBalance {
  rooms: RoomAir[];
  ahu: AhuVent;
}

/** ","&id&"," found in ","&list-without-spaces&"," (SEARCH: case-insensitive substring). */
function listHas(rawList: string | null, id: string): boolean {
  if (isBlank(rawList)) return false;
  return `,${rawList.replace(/ /g, "")},`.toLowerCase().includes(`,${id},`.toLowerCase());
}

export function airBalance(
  spaces: readonly VentSpace[],
  zones: readonly ZoneVent[],
  loadCfm: readonly number[],
  set: AirSideSettings,
  block: BlockLoad,
): AirBalance {
  const ventSys = resolveVentSys(set.ventSys, spaces.length);
  const multi = ventSys === "Multiple-zone";
  const appA = multi && set.evMethod === "Appendix A";
  const simpVav = set.sysType === "VAV" && set.evMethod === "Simplified" && multi;
  const ceil = (x: number) => (set.cfmRound > 0 ? ceiling(x, set.cfmRound) : x);

  // R, S, AH, AJ, AK (pass 1: everything that does not need other rooms)
  const p1 = spaces.map((s, i) => {
    const z = zones[i]!;
    const I = loadCfm[i]!;
    const terms: [number, SupplyGovernor][] = [
      [I, "load"],
      [z.Voz, "Voz"],
      [z.exhaust > 0 ? round(z.exhaust * set.exhMakeup, 6) : 0, "exhaust makeup"],
      [simpVav ? 1.5 * z.Voz : 0, "1.5·Voz (Simplified VAV)"],
      [appA ? z.Voz / set.zpzMax : 0, "Voz / ZpzMax"],
    ];
    const max = Math.max(...terms.map((t) => t[0]));
    // NaN load (an input ID not found) matches no term: report it as load-governed rather than throw
    const governedBy = (terms.find((t) => t[0] === max) ?? terms[0]!)[1];
    const R = ceil(max);
    const S =
      set.sysType === "VAV"
        ? Math.min(R, Math.max(set.vavMin * R, set.evMethod === "Simplified" ? 1.5 * z.Voz : 0, appA ? z.Voz / set.zpzMax : 0))
        : R;
    const W = isBlank(s.xferTo) ? "" : s.xferTo;
    const AH = W === "" ? 0 : W.replace(/ /g, "").split(",").length;
    const AK = W === "" ? -1 : s.xferCfm ?? -1;
    const AJ = Math.max(0, n(z.exhaust) - n(R));
    return { I, R, governedBy, S, W, AH, AK, AJ };
  });

  // AI: sources naming this room
  const AI = spaces.map((s) => spaces.filter((_, j) => listHas(p1[j]!.W, s.id)).length);
  const div = (x: number) => x + (x === 0 ? 1 : 0);

  // AHU sums needed for Xs
  const sumSupply = sum(p1.map((r) => r.R));
  const sumExhaust = sum(zones.map((z) => z.exhaust));
  const blockSupply = ceil((block.sensibleWorst * (1 + block.sf)) / (block.cs * block.dTsupply));
  const sumVavMin = set.sysType === "VAV" ? sum(p1.map((r) => r.S)) : 0;
  const Vps =
    ventSys === "100% OA"
      ? ceil(Math.max(sumSupply, sumExhaust + set.pressurization))
      : set.sysType === "VAV"
        ? Math.max(blockSupply, sumVavMin)
        : sumSupply;
  const sumPz = sum(zones.map((z) => z.Pz));
  const Ps = set.ps ?? sumPz;
  const D = sumPz > 0 ? Ps / sumPz : 1;
  const sumRpPz = sum(zones.map((z) => z.RpPz));
  const sumRaAz = sum(zones.map((z) => z.RaAz));
  const Vou = D * sumRpPz + sumRaAz;
  const Xs = Vps > 0 ? Vou / Vps : 0;

  const rooms: RoomAir[] = spaces.map((s, i) => {
    const z = zones[i]!;
    const r = p1[i]!;
    const T: number | "no air" = r.S > 0 ? z.Voz / r.S : z.Voz > 0 ? "no air" : 0;
    const U = typeof T === "number" ? 1 + Xs - T : null;

    // X: override, else Σ over destinations of (destination shortfall / its source count)
    const X =
      r.W === "" ? 0 : r.AK >= 0 ? r.AK : sum(spaces.map((d, j) => (listHas(r.W, d.id) ? p1[j]!.AJ / div(AI[j]!) : 0)));
    // Y: Σ over sources naming this room (source override split equally, else own shortfall / source count)
    const Y = sum(
      spaces.map((_, j) => {
        const src = p1[j]!;
        if (!listHas(src.W, s.id)) return 0;
        return src.AK >= 0 ? src.AK / div(src.AH) : r.AJ / div(AI[i]!);
      }),
    );
    const Z = r.R + Y - X - z.exhaust;

    const matched = spaces.map((d) => listHas(r.W, d.id));
    const nMatched = matched.filter(Boolean).length;
    let AC: RoomAir["transferCheck"] = "—";
    if (r.W !== "") {
      if (listHas(r.W, s.id) || nMatched !== r.AH) AC = "FAIL";
      else if (z.airClass === 1 || (z.airClass === 2 && zones.filter((_, j) => matched[j] && zones[j]!.airClass < 2).length === 0)) AC = "PASS";
      else AC = "FAIL";
    }

    const AE =
      (Z < -0.5 ? "Return < 0 (exhaust + transfer out > supply + transfer in); " : "") +
      (T === "no air" ? "Voz > 0 but no supply air; " : "") +
      (typeof T === "number" && T > 1 ? "Zpz > 1; " : "") +
      (r.S > r.R + 0.5 ? "VAV minimum > room supply (raise supply or lower minimum); " : "") +
      (ventSys === "100% OA" && r.R < z.Voz - 0.5 ? "Supply < Voz; " : "");

    return {
      id: s.id,
      loadCfm: r.I,
      supply: r.R,
      governedBy: r.governedBy,
      Vpz: r.S,
      Zpz: T,
      Evz: U,
      xferTo: r.W === "" ? [] : r.W.replace(/ /g, "").split(","),
      xferOut: X,
      xferIn: Y,
      ret: Z,
      cfmPerFt2: n(s.area) === 0 ? null : r.R / s.area,
      exhaustCheck: isBlank(s.exhType) ? "—" : z.exhaust > r.R ? "PASS" : "FAIL",
      transferCheck: AC,
      zoneCheck: AE === "" ? "PASS" : "FAIL",
      zoneCheckDetail: AE,
      destinations: r.AH,
      sourcesHere: AI[i]!,
      shortfall: r.AJ,
      xferOverride: r.AK,
    };
  });

  const evz = rooms.map((r) => r.Evz).filter((u): u is number => u !== null);
  const EvSimplified = D < 0.6 ? 0.88 * D + 0.22 : 0.75;
  const EvAppendixA = evz.length === 0 ? 1 : Math.min(...evz);
  const Ev = !multi ? 1 : set.evMethod === "Simplified" ? EvSimplified : EvAppendixA;
  const VotVRP = multi ? Vou / Ev : sum(zones.map((z) => z.Voz));
  const exhPress = sumExhaust + set.pressurization;
  const Vot = ceil(ventSys === "100% OA" ? Math.max(VotVRP, exhPress, sumSupply) : Math.max(VotVRP, exhPress));
  const sumReturn = sum(rooms.map((r) => r.ret));
  const sumArea = sum(spaces.map((s) => s.area));

  return {
    rooms,
    ahu: {
      ventSys,
      sysType: set.sysType,
      sumSupply,
      blockSupply,
      sumVavMin,
      Vps,
      sumPz,
      Ps,
      D,
      sumRpPz,
      sumRaAz,
      Vou,
      Xs,
      EvSimplified,
      EvAppendixA,
      Ev,
      VotVRP,
      sumExhaust,
      pressurization: set.pressurization,
      Vot,
      oaGovernedBy: ventSys === "100% OA" ? "100% OA (supply)" : exhPress > VotVRP ? "Exhaust + pressurization" : "62.1 VRP",
      oaFraction: Vps > 0 ? Vot / Vps : 0,
      recirculated: Math.max(0, Vps - Vot),
      sumReturn,
      relief: Vot - sumExhaust,
      cfmPerFt2: sumArea > 0 ? Vps / sumArea : 0,
      systemCheck: Ev > 0 && Xs <= 1 && Vot <= Vps + 0.5 && sumReturn >= -0.5 ? "PASS" : "FAIL",
    },
  };
}
