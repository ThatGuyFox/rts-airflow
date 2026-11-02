// Project runner: one AHU system (one workbook) from inputs to room and AHU airflows.
// C1 → C6 for the design month and, with the sweep on, months 1–12; each room at its worst month
// (C7 D–I), the AHU block at its worst month (C7 C63–C66); then zone ventilation and the air balance
// (C7 J–AK, C60–C92), and the return plenum gain / return temperature (C7 C88–C90).
// Pure: no file or DOM access. The caller passes the project and the libraries in.

import { designConditions, solarDay, type ClimateLibrary, type ClimateOverride, type DailyProfileLibrary, type DesignConditions, type DesignInputs, type SolarDay } from "./climate";
import { conduction, peak, type ConductionBlock, type Construction, type EnvelopeOptions, type Surface } from "./conduction";
import { isBlank, n, textEq } from "./excel";
import { fenestration, resolveGlazing, type AcfRow, type FenestrationBlock, type Glazing, type GlazingInput, type InteriorShade } from "./fenestration";
import { infiltration, psychro, type InfiltrationBlock, type InfSpace } from "./infiltration";
import { internalGains, type GainLibraries, type GainSpace, type InternalBlock, type Schedule } from "./internal";
import type { Vent621Libraries } from "./libraries";
import { blockLoads, roomLoads, type RoomLoad, type RoomLoadSpace, type RtsSeries } from "./rts";
import { airBalance, zoneVentilation, type AhuVent, type AirSideSettings, type Issue, type RoomAir, type VentSpace, type ZoneVent } from "./ventilation";

// ---------------------------------------------------------------------------------------------
// Inputs

/** 02_Spaces row: every column C4, C5, C6 and C7 read. */
export interface ProjectSpace extends VentSpace, GainSpace, InfSpace, RoomLoadSpace {
  notes?: string | null; // free text; "ASSUMED" marks an assumed input
}

/** One AHU system: 01_Project, 02_Spaces, 03_Surfaces, 04_Schedules and the project library rows. */
export interface ProjectInput {
  format: "rts-airflow-project";
  version: 1;
  name: string | null; // 01_Project B5
  ahu: string | null; // 01_Project B6
  climate: {
    climSrc: DesignInputs["climSrc"]; // in_ClimSrc B8
    designPct: string; // in_DesignPct B9
    designMonth: number; // in_Month B10
    dst: boolean; // in_DST B11
    airBasis: DesignInputs["airBasis"]; // in_AirBasis B44
    rhoG: number; // in_RhoG B18
    override?: ClimateOverride; // L1 A78:B91
  };
  indoor: { tin: number; rhIn: number }; // in_Tin B12, in_RHin B13
  load: { dTsupply: number; sf: number }; // in_dTsupply B14, in_SF B17
  envelope: Omit<EnvelopeOptions, "tin"> & { frWin: number }; // B37:B41
  air: AirSideSettings; // B7, B47:B56
  /** Model azimuth of true north, ° clockwise from model +Y. Surface azimuths below are already true azimuths. */
  north: { deg: number | null; source: string | null };
  spaces: ProjectSpace[];
  surfaces: Surface[];
  constructions: Construction[]; // L2 project rows (63+)
  glazing: GlazingInput[]; // L3 project rows (6–25)
  shades: InteriorShade[]; // L3 project shade rows not in the library
  rts: RtsSeries[]; // L4 project rows (31–40)
  schedules: Schedule[]; // 04_Schedules
}

/** Library JSON (libraries/), passed in by the caller. */
export interface EngineLibraries {
  climate: ClimateLibrary;
  profile: DailyProfileLibrary;
  constructions: Construction[];
  acf: AcfRow[];
  shades: InteriorShade[];
  rts: RtsSeries[];
  gains: GainLibraries;
  vent621: Vent621Libraries;
}

export interface RunOptions {
  /** true (default) = design month plus months 1–12, as the O3 sweep intended; false = design month only. */
  sweep?: boolean;
}

// ---------------------------------------------------------------------------------------------
// One month: C1 → C6

export interface MonthResult {
  month: number;
  dc: DesignConditions;
  solar: SolarDay;
  conduction: ConductionBlock[];
  fenestration: FenestrationBlock[];
  infiltration: InfiltrationBlock[];
  rooms: RoomLoad[];
  block: ReturnType<typeof blockLoads>;
}

interface Prepared {
  constructions: Construction[];
  glazing: Glazing[];
  shades: InteriorShade[];
  rts: RtsSeries[];
  internal: InternalBlock[]; // C4 has no month dependence
}

function prepare(p: ProjectInput, lib: EngineLibraries): Prepared {
  return {
    constructions: [...lib.constructions, ...p.constructions],
    glazing: p.glazing.map((g) => resolveGlazing(g, lib.acf)),
    shades: [...lib.shades, ...p.shades],
    rts: [...lib.rts, ...p.rts],
    internal: internalGains(p.spaces, p.schedules, lib.gains),
  };
}

export function runMonth(p: ProjectInput, lib: EngineLibraries, month: number, prep: Prepared = prepare(p, lib)): MonthResult {
  const c = p.climate;
  const inp: DesignInputs = { climSrc: c.climSrc, designPct: c.designPct, month, dst: c.dst, airBasis: c.airBasis, rhoG: c.rhoG, override: c.override };
  const dc = designConditions(inp, lib.climate);
  const solar = solarDay(dc, lib.profile);
  const e = p.envelope;
  const b2 = conduction(p.surfaces, p.spaces, prep.constructions, { tin: p.indoor.tin, roofPlenum: e.roofPlenum, frWall: e.frWall, frRoof: e.frRoof, lwHoriz: e.lwHoriz }, solar, c.rhoG);
  const b3 = fenestration(p.surfaces, prep.glazing, prep.shades, { tin: p.indoor.tin, frWin: e.frWin }, solar, c.rhoG);
  const b5 = infiltration(p.spaces, psychro(dc, solar, p.indoor.tin, p.indoor.rhIn), dc.cs, dc.cl);
  const rooms = roomLoads(p.spaces, prep.rts, b2, b3, prep.internal, b5, e.frWin);
  return { month, dc, solar, conduction: b2, fenestration: b3, infiltration: b5, rooms, block: blockLoads(rooms) };
}

// ---------------------------------------------------------------------------------------------
// Results

export interface RoomResult {
  id: string;
  name: string;
  designSensible: number; // D, room sensible peak, design month (Btu/h)
  sweepMax: number | null; // E, max over months 1–12; null without the sweep
  governingMonth: number; // F, sizing month (design month unless the sweep is strictly higher)
  sizingSensible: number; // G, max(D, E) × (1 + SF)
  latentAtPeak: number | null; // H, design-month latent at the design-month sensible peak hour
  loadCfm: number; // I
  monthlyPeaks: { month: number; value: number; hour: number | null }[]; // every month run
  zone: ZoneVent; // Step 1
  air: RoomAir; // Step 3
  errors: Issue[]; // inputs the engine cannot compute with
}

export interface BlockResult {
  designSensible: number; // C63
  designHour: number | null; // C64
  worstSensible: number; // C65
  worstMonth: number;
  monthlyPeaks: { month: number; value: number; hour: number | null }[];
}

export interface ReturnPlenum {
  gain: number; // C88, Btu/h: C6 row 8 at the worst block month's peak hour (workbook: design month)
  dTret: number; // C89, °F
  tReturn: number; // C90, °F
}

export type AssumedKind =
  | "surface-note"
  | "space-note"
  | "construction"
  | "glazing"
  | "shade"
  | "rts"
  | "pz-default-density"
  | "not-621-category"
  | "workbook-choice"
  | "north";

export interface AssumedItem {
  kind: AssumedKind;
  ref: string; // surface, space, library row ID or setting name
  rooms: string[]; // spaces the item touches; empty = project-wide
  text: string;
}

export interface ProjectResult {
  designMonth: number;
  monthsRun: number[];
  months: MonthResult[]; // "show working": the full C1–C6 chain per month run
  rooms: RoomResult[];
  block: BlockResult;
  ahu: AhuVent;
  returnPlenum: ReturnPlenum;
  assumed: AssumedItem[];
  errors: Issue[]; // all room errors plus project-level ones
}

// ---------------------------------------------------------------------------------------------
// Runner

const MONTHS = Array.from({ length: 12 }, (_, k) => k + 1);

/** INDEX(months, MATCH(MAX(values), values, 0)): first month at the max. */
function firstMax(xs: { month: number; value: number }[]): { month: number; value: number } {
  return xs.reduce((a, x) => (x.value > a.value ? x : a), xs[0]!);
}

export function runProject(p: ProjectInput, lib: EngineLibraries, opt: RunOptions = {}): ProjectResult {
  const sweep = opt.sweep ?? true;
  const dm = p.climate.designMonth;
  const prep = prepare(p, lib);
  const monthsRun = sweep ? MONTHS : [dm];
  const months = monthsRun.map((m) => runMonth(p, lib, m, prep));
  const design = months.find((r) => r.month === dm) ?? runMonth(p, lib, dm, prep);
  const cs = design.dc.cs;
  const { sf, dTsupply } = p.load;

  // Step 1: zone ventilation
  const zones = p.spaces.map((s) => zoneVentilation(s, p.air, lib.vent621));

  // C7 D–I per room
  const sized = p.spaces.map((s, i) => {
    const monthlyPeaks = months.map((r) => ({ month: r.month, ...peak(r.rooms[i]!.sensible) }));
    const dPeak = peak(design.rooms[i]!.sensible);
    const D = dPeak.value;
    const worst = sweep ? firstMax(monthlyPeaks) : null;
    const E = worst ? worst.value : null;
    const F = E !== null && E > D ? worst!.month : dm;
    const G = Math.max(D, n(E)) * (1 + sf);
    const H = dPeak.hour === null ? null : design.rooms[i]!.latent[dPeak.hour - 1]!;
    return { D, E, F, G, H, I: Math.max(0, G) / (cs * dTsupply), monthlyPeaks };
  });

  // C7 C63–C65: AHU block
  const blockPeaks = months.map((r) => ({ month: r.month, ...peak(r.block.sensible) }));
  const dBlock = peak(design.block.sensible);
  const sweepBlock = sweep ? firstMax(blockPeaks) : null;
  const block: BlockResult = {
    designSensible: dBlock.value,
    designHour: dBlock.hour,
    worstSensible: Math.max(dBlock.value, sweepBlock ? sweepBlock.value : 0),
    worstMonth: sweepBlock && sweepBlock.value > dBlock.value ? sweepBlock.month : dm,
    monthlyPeaks: blockPeaks,
  };

  // Step 3: air balance and AHU ventilation
  const bal = airBalance(p.spaces, zones, sized.map((r) => r.I), p.air, { sensibleWorst: block.worstSensible, sf, cs, dTsupply });

  // C88–C90. Plenum gain at the worst block month and its peak hour (Matteo, 2026-11-01), so it matches
  // the worst-month return cfm. The workbook takes the design month; same result with the sweep off.
  const worstRun = months.find((r) => r.month === block.worstMonth) ?? design;
  const worstHour = peak(worstRun.block.sensible).hour;
  const gain = n(worstHour) < 1 ? 0 : worstRun.block.toPlenum[worstHour! - 1]!;
  const dTret = bal.ahu.sumReturn > 0 ? gain / (cs * bal.ahu.sumReturn) : 0;
  const returnPlenum: ReturnPlenum = { gain, dTret, tReturn: p.indoor.tin + dTret };

  const roomErrors = collectErrors(p, zones, design, prep.internal);
  const rooms: RoomResult[] = p.spaces.map((s, i) => {
    const r = sized[i]!;
    return {
      id: s.id, name: s.name,
      designSensible: r.D, sweepMax: r.E, governingMonth: r.F, sizingSensible: r.G, latentAtPeak: r.H, loadCfm: r.I,
      monthlyPeaks: r.monthlyPeaks, zone: zones[i]!, air: bal.rooms[i]!,
      errors: roomErrors.filter((e) => e.room !== undefined && textEq(e.room, s.id)),
    };
  });

  return { designMonth: dm, monthsRun, months, rooms, block, ahu: bal.ahu, returnPlenum, assumed: collectAssumed(p, zones), errors: roomErrors };
}

// ---------------------------------------------------------------------------------------------
// Input errors: IDs the engine cannot find. Without these the room's numbers are NaN.

function collectErrors(p: ProjectInput, zones: ZoneVent[], design: MonthResult, internal: InternalBlock[]): Issue[] {
  const out: Issue[] = [];
  const ids = p.spaces.map((s) => s.id);
  const has = (id: string) => ids.some((x) => textEq(x, id));
  const err = (room: string | undefined, code: string, text: string) => out.push({ room, severity: "error", code, text });

  zones.forEach((z) => out.push(...z.issues.filter((i) => i.severity === "error")));

  // Surfaces whose space is not on this AHU (their gains go nowhere)
  for (const s of p.surfaces) {
    if (isBlank(s.id) || isBlank(s.type)) continue;
    if (!has(s.space)) err(undefined, "surface-space-missing", `Surface ${s.id}: space "${s.space}" not in 02_Spaces`);
    if (!isBlank(s.host) && !p.surfaces.some((o) => textEq(o.id, s.host!)))
      err(has(s.space) ? s.space : undefined, "host-missing", `Surface ${s.id}: host wall "${s.host}" not in 03_Surfaces`);
  }
  for (const b of design.conduction) for (const t of b.issues) err(has(b.space) ? b.space : undefined, "lookup-missing", `Surface ${b.surfaceId}: ${t}`);
  for (const b of design.fenestration) for (const t of b.issues) err(has(b.space) ? b.space : undefined, "lookup-missing", `Surface ${b.surfaceId}: ${t}`);
  design.rooms.forEach((r) => r.issues.forEach((t) => err(r.spaceId, "lookup-missing", t)));
  // C4 issues (people activity, lighting type, equipment class, schedules)
  internal.forEach((b) => b.issues.forEach((t) => err(b.spaceId, "lookup-missing", t)));

  // Transfer-to IDs
  for (const s of p.spaces) {
    if (isBlank(s.xferTo)) continue;
    for (const d of s.xferTo.replace(/ /g, "").split(","))
      if (d !== "" && !has(d)) err(s.id, "xfer-target-missing", `Transfer-to "${d}" not in 02_Spaces`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// ASSUMED list

const MARK = /ASSUMED/; // the workbook's marker, upper case; "assumed" in prose is not a marker

function collectAssumed(p: ProjectInput, zones: ZoneVent[]): AssumedItem[] {
  const out: AssumedItem[] = [];
  const marked = (...t: (string | null | undefined)[]) => t.some((x) => !isBlank(x) && MARK.test(x!));

  for (const s of p.surfaces)
    if (marked(s.notes)) out.push({ kind: "surface-note", ref: s.id, rooms: [s.space], text: s.notes! });
  for (const s of p.spaces)
    if (marked(s.notes)) out.push({ kind: "space-note", ref: s.id, rooms: [s.id], text: s.notes! });

  // Project library rows, listed when marked ASSUMED and used by a surface or space
  const usedBy = (pred: (s: Surface) => boolean) => [...new Set(p.surfaces.filter(pred).map((s) => s.space))];
  for (const c of p.constructions) {
    if (!marked(c.description, c.source)) continue;
    const rooms = usedBy((s) => !textEq(s.type, "Window") && textEq(s.con, c.id));
    if (rooms.length) out.push({ kind: "construction", ref: c.id, rooms, text: c.description ?? c.source ?? "" });
  }
  for (const g of p.glazing) {
    if (!marked(g.description, g.source)) continue;
    const rooms = usedBy((s) => textEq(s.type, "Window") && textEq(s.con, g.id));
    if (rooms.length) out.push({ kind: "glazing", ref: g.id, rooms, text: g.description ?? g.source ?? "" });
  }
  for (const sh of p.shades) {
    if (!marked(sh.source)) continue;
    const rooms = usedBy((s) => !isBlank(s.shade) && textEq(s.shade, sh.id));
    if (rooms.length) out.push({ kind: "shade", ref: sh.id, rooms, text: sh.source ?? "" });
  }
  for (const r of p.rts) {
    if (!marked(r.description, r.source)) continue;
    const rooms = p.spaces.filter((s) => !isBlank(s.rts) && textEq(s.rts, r.id)).map((s) => s.id);
    if (rooms.length) out.push({ kind: "rts", ref: r.id, rooms, text: r.description ?? r.source ?? "" });
  }

  // 62.1 flags from zone ventilation
  zones.forEach((z) =>
    z.issues
      .filter((i) => i.severity === "flag")
      .forEach((i) =>
        out.push({ kind: i.code === "pz-default-density" ? "pz-default-density" : "not-621-category", ref: z.id, rooms: [z.id], text: i.text }),
      ),
  );

  // Workbook choices: editable settings, not ASHRAE values
  const a = p.air;
  const choice = (ref: string, text: string) => out.push({ kind: "workbook-choice", ref, rooms: [], text: `${text} — workbook choice, not an ASHRAE value` });
  choice("zpzMax", `Maximum zone Zpz ${a.zpzMax}`);
  choice("vavMin", `VAV box minimum ${a.vavMin} of room supply`);
  choice("cfmRound", `Airflows rounded up to ${a.cfmRound} cfm`);
  choice("exhMakeup", `Exhaust makeup by direct supply ${a.exhMakeup} of exhaust`);

  if (p.north.deg === null || isBlank(p.north.source))
    out.push({
      kind: "north",
      ref: "north",
      rooms: [],
      text: p.north.deg === null ? "North not set" : `North ${p.north.deg}° (model azimuth of true north) — no source entered`,
    });
  return out;
}
