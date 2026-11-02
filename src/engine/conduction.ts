// Opaque surface conduction: port of C2_Conduction (one 9-row block per opaque surface).
// LCAM Eqs. D.21–D.27 (incident Et), D.34 (sol-air), 7.1 (CTS). Wall/Roof/Door: sol-air + CTS.
// Partition/Floor: steady U·A·(Tadj − ti); blank Tadj = conditioned, no gain. Hour = local clock time.

import { isBlank, n, textEq } from "./excel";
import type { SolarDay } from "./climate";

export type SurfaceType = "Wall" | "Roof" | "Door" | "Partition" | "Floor" | "Window";

/** 03_Surfaces row. */
export interface Surface {
  id: string; // A
  space: string; // B
  type: SurfaceType; // C
  con: string; // D construction (L2) or glazing (L3) ID
  az: number | null; // E azimuth, ° from N clockwise (true, after NORTH)
  tilt: number | null; // F, 90 = wall
  area: number | null; // G gross area (opaque, door), ft²
  w: number | null; // H window width, ft
  h: number | null; // I window height, ft
  qty: number | null; // J window qty
  host: string | null; // K host wall Surface ID
  ohDepth: number | null; // L
  ohGap: number | null; // M
  shade: string | null; // N interior shade ID
  tadj: number | null; // O adjacent temp, partitions/floors
  notes: string | null; // P (ASSUMED markers live here)
}

/** L2 construction row: library (libraries/constructions.json) or project row (L2 row 63+). */
export interface Construction {
  row: number; // L2 sheet row
  id: string;
  description: string | null;
  type: string | null;
  U_btuh_ft2F: number;
  alpha: number | null;
  ho_btuh_ft2F: number | null;
  CTS: (number | null)[]; // CTS hour 0..23, fractions
  source: string | null;
}

export interface EnvelopeOptions {
  tin: number; // in_Tin, °F
  roofPlenum: number; // in_RoofPlenum
  frWall: number; // in_FRwall (walls, doors, partitions, floors)
  frRoof: number; // in_FRroof
  lwHoriz: number; // in_LWhoriz, °F
}

export interface SpacePlenum {
  id: string;
  plenum: string | null; // "Y" = plenum return
}

export interface ConductionBlock {
  seq: number; // opaque sequence (block n)
  srfRow: number; // AF, 1-based position in 03_Surfaces
  surfaceId: string;
  space: string;
  type: SurfaceType; // AG, also AE (C6 category key)
  conRow: number; // AH, MATCH index in lib_ConTbl (L2 row − 4)
  construction?: Construction;
  U: number; // AI
  netArea: number; // AJ
  alpha: number; // AK
  ho: number; // AL
  az: number; // AM
  tilt: number; // AN
  lw: number; // AO, εΔR/hₒ
  radiantFrac: number; // AP
  plenumFrac: number; // AQ
  tadj: number | null; // AR
  cosTheta: (number | null)[]; // row 1
  Et: number[]; // row 2
  te: (number | null)[]; // row 3
  q: number[]; // row 4, U·A·(te − ti)
  gain: number[]; // row 5, conduction heat gain (CTS)
  toPlenum: number[]; // row 6
  radiant: number[]; // row 7, → nonsolar RTS
  convective: number[]; // row 8
  issues: string[];
}

const rad = (d: number) => (d * Math.PI) / 180;
const steady = (t: string) => textEq(t, "Partition") || textEq(t, "Floor");

/** AC and AD: max of the 24 hours and its first hour, "" (null) when the max is ≤ 0. */
export function peak(xs: readonly number[]): { value: number; hour: number | null } {
  const value = Math.max(...xs);
  return { value, hour: value <= 0 ? null : xs.indexOf(value) + 1 };
}

/** Constructions as lib_ConTbl sees them: library rows first, then project rows (L2 A5:A80). MATCH takes the first. */
export function findConstruction(cons: readonly Construction[], id: string): Construction | undefined {
  return cons.find((c) => textEq(c.id, id));
}

export function conduction(
  surfaces: readonly Surface[],
  spaces: readonly SpacePlenum[],
  constructions: readonly Construction[],
  opt: EnvelopeOptions,
  solar: SolarDay,
  rhoG: number,
): ConductionBlock[] {
  const blocks: ConductionBlock[] = [];
  const H = solar.hours;

  surfaces.forEach((s, idx) => {
    if (isBlank(s.id) || isBlank(s.type) || textEq(s.type, "Window")) return;
    const issues: string[] = [];
    const isSteady = steady(s.type);
    const con = findConstruction(constructions, s.con);
    if (!con) issues.push(`construction "${s.con}" not in L2`);

    const U = con ? con.U_btuh_ft2F : NaN;
    const alpha = con ? n(con.alpha) : NaN;
    const ho = con ? n(con.ho_btuh_ft2F) : NaN;
    const az = n(s.az);
    const tilt = n(s.tilt);

    // AJ: gross − hosted windows (W·H·qty) − hosted doors (their gross area)
    const hosted = surfaces.filter((o) => !isBlank(o.host) && textEq(o.host, s.id));
    const netArea =
      n(s.area) -
      hosted.filter((o) => textEq(o.type, "Window")).reduce((a, o) => a + n(o.w) * n(o.h) * n(o.qty), 0) -
      hosted.filter((o) => textEq(o.type, "Door")).reduce((a, o) => a + n(o.area), 0);

    const lw = opt.lwHoriz * Math.max(0, Math.cos(rad(tilt)));
    const isRoof = textEq(s.type, "Roof");
    const radiantFrac = isRoof ? opt.frRoof : opt.frWall;
    let plenumFrac = 0;
    if (isRoof) {
      const sp = spaces.find((x) => textEq(x.id, s.space));
      if (!sp) {
        issues.push(`space "${s.space}" not in 02_Spaces`);
        plenumFrac = NaN;
      } else if (sp.plenum === "Y") plenumFrac = opt.roofPlenum;
    }
    const tadj = isSteady ? s.tadj : null;

    const cosTheta: (number | null)[] = [];
    const Et: number[] = [];
    const te: (number | null)[] = [];
    const q: number[] = [];
    for (const h of H) {
      if (isSteady) {
        cosTheta.push(null);
        Et.push(0);
        te.push(tadj);
      } else {
        const c = Math.cos(rad(h.beta)) * Math.cos(rad(h.phi - az)) * Math.sin(rad(tilt)) + Math.sin(rad(h.beta)) * Math.cos(rad(tilt));
        const Y = c > -0.2 ? 0.55 + 0.437 * c + 0.313 * c * c : 0.45;
        const e =
          h.Eb * Math.max(0, c) +
          h.Ed * (Y * Math.sin(rad(tilt)) + (tilt <= 90 ? Math.cos(rad(tilt)) : 0)) +
          ((h.Eb * Math.sin(rad(h.beta)) + h.Ed) * rhoG * (1 - Math.cos(rad(tilt)))) / 2;
        cosTheta.push(c);
        Et.push(e);
        te.push(h.db + (alpha * e) / ho - lw);
      }
      const t = te[te.length - 1];
      q.push(t === null || t === undefined ? 0 : U * netArea * (t - opt.tin));
    }

    // Row 5: CTS convolution q_out(h) = Σ_j CTS_j · q(h − j), cyclic over 24 h
    const cts = con ? con.CTS.map(n) : [];
    const gain = isSteady
      ? q.slice()
      : q.map((_, h) => {
          let acc = 0;
          for (let j = 0; j < 24; j++) acc += (cts[j] ?? NaN) * q[(h - j + 24) % 24]!;
          return acc;
        });
    const toPlenum = gain.map((g) => g * plenumFrac);
    const radiant = gain.map((g, i) => (g - toPlenum[i]!) * radiantFrac);
    const convective = gain.map((g, i) => (g - toPlenum[i]!) * (1 - radiantFrac));

    blocks.push({
      seq: blocks.length + 1,
      srfRow: idx + 1,
      surfaceId: s.id,
      space: s.space,
      type: s.type,
      conRow: con ? con.row - 4 : NaN,
      construction: con,
      U,
      netArea,
      alpha,
      ho,
      az,
      tilt,
      lw,
      radiantFrac,
      plenumFrac,
      tadj,
      cosTheta,
      Et,
      te,
      q,
      gain,
      toPlenum,
      radiant,
      convective,
      issues,
    });
  });
  return blocks;
}
