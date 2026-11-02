// Fenestration heat gain: port of C3_Fenestration (one 14-row block per Window row, all panes of the row).
// LCAM Eqs. D.21–D.33, 7.3 (conduction), 7.4a–b (beam/diffuse SHG), 3.6 (IAC). NFRC whole-unit U and SHGC
// with the nearest Table 3.8 type for angle correction (LCAM §7.5). ACF linear in θ, ACF(90°) = 0.
// Overhang assumed infinite width. Unshaded beam → solar RTS; with an interior shade all radiant → nonsolar RTS.

import { isBlank, n, textEq } from "./excel";
import type { SolarDay } from "./climate";
import type { Surface } from "./conduction";

/** L3 Table 3.8 row (libraries/glazing_angle_correction.json). */
export interface AcfRow {
  row: number;
  type_id: string;
  diffuse_factor: number;
  ACF_0_40_50_60_70_80: number[];
  source: string;
}

/** L3 project glazing input (rows 6–25, columns A–E and N). */
export interface GlazingInput {
  row: number; // L3 sheet row
  id: string;
  description: string | null;
  U: number; // whole-unit U, Btu/h·ft²·°F
  SHGC0: number; // normal, whole unit
  acfType: string | null; // Table 3.8 type ID
  source: string | null;
}

/** Project glazing row with the columns L3 looks up (F–M). */
export interface Glazing extends GlazingInput {
  acfRow?: AcfRow;
  diffuseFactor: number; // F
  SHGCdiff: number; // G
  ACF: [number, number, number, number, number, number]; // H–M at 0, 40, 50, 60, 70, 80°
}

/** L3 interior shade row (libraries/interior_shades.json, or a project row 108–127). */
export interface InteriorShade {
  row: number;
  id: string;
  IAC0: number;
  IAC60: number;
  IACdiff: number;
  FR: number;
  source: string | null;
}

export function resolveGlazing(g: GlazingInput, acf: readonly AcfRow[]): Glazing {
  const a = isBlank(g.acfType) ? undefined : acf.find((r) => textEq(r.type_id, g.acfType!));
  const angles = (a?.ACF_0_40_50_60_70_80 ?? [NaN, NaN, NaN, NaN, NaN, NaN]) as Glazing["ACF"];
  const diffuseFactor = a ? a.diffuse_factor : NaN;
  return { ...g, acfRow: a, diffuseFactor, SHGCdiff: g.SHGC0 * diffuseFactor, ACF: angles };
}

export interface FenestrationBlock {
  seq: number;
  srfRow: number; // AF
  surfaceId: string;
  space: string;
  glzRow: number; // AG, MATCH index in lib_GlzTbl (L3 row − 5)
  glazing?: Glazing;
  U: number; // AH
  SHGC0: number; // AI
  SHGCdiff: number; // AJ
  ACF40: number; ACF50: number; ACF60: number; ACF70: number; ACF80: number; // AK–AO
  w: number; h: number; qty: number; area: number; // AP–AS
  az: number; tilt: number; // AT, AU
  ohDepth: number; ohGap: number; // AV, AW
  shadeRow: number | null; // AX
  shade?: InteriorShade;
  IAC0: number; IAC60: number; IACdiff: number; frSolar: number; frCond: number; // AY–BC
  theta: (number | null)[]; // row 1, incidence angle
  Etb: number[]; // row 2
  Etd: number[]; // row 3, diffuse + ground reflected
  omega: (number | null)[]; // row 4, profile angle
  sunlit: number[]; // row 5, ft²
  shgcBeam: (number | null)[]; // row 6
  iacBeam: number[]; // row 7
  beam: number[]; // row 8, Btu/h
  diffuse: number[]; // row 9
  cond: number[]; // row 10
  radSolar: number[]; // row 11, → solar RTS
  radNonsolar: number[]; // row 12, → nonsolar RTS
  convective: number[]; // row 13
  issues: string[];
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** C3 E11: SHGC₀ × ACF(θ), linear between Table 3.8 angles, 1 at 0°, 0 at 90°. */
function shgcAt(theta: number, shgc0: number, a: Glazing["ACF"] | number[]): number {
  const [, a40, a50, a60, a70, a80] = a as number[];
  let f: number;
  if (theta >= 90) f = 0;
  else if (theta >= 80) f = (a80! * (90 - theta)) / 10;
  else if (theta >= 70) f = a70! + ((a80! - a70!) * (theta - 70)) / 10;
  else if (theta >= 60) f = a60! + ((a70! - a60!) * (theta - 60)) / 10;
  else if (theta >= 50) f = a50! + ((a60! - a50!) * (theta - 50)) / 10;
  else if (theta >= 40) f = a40! + ((a50! - a40!) * (theta - 40)) / 10;
  else f = 1 + ((a40! - 1) * theta) / 40;
  return shgc0 * f;
}

export function fenestration(
  surfaces: readonly Surface[],
  glazing: readonly Glazing[],
  shades: readonly InteriorShade[],
  opt: { tin: number; frWin: number },
  solar: SolarDay,
  rhoG: number,
): FenestrationBlock[] {
  const blocks: FenestrationBlock[] = [];

  surfaces.forEach((s, idx) => {
    if (isBlank(s.id) || !textEq(s.type ?? "", "Window")) return;
    const issues: string[] = [];
    const g = glazing.find((x) => textEq(x.id, s.con));
    if (!g) issues.push(`glazing "${s.con}" not in L3 project glazing`);
    const nanA = [NaN, NaN, NaN, NaN, NaN, NaN];
    const acf = g ? g.ACF : nanA;
    const U = g ? g.U : NaN;
    const SHGC0 = g ? g.SHGC0 : NaN;
    const SHGCdiff = g ? g.SHGCdiff : NaN;

    const w = n(s.w);
    const h = n(s.h);
    const qty = s.qty === null ? 1 : n(s.qty);
    const area = w * h * qty;
    const az = n(s.az);
    const tilt = n(s.tilt);
    const ohDepth = n(s.ohDepth);
    const ohGap = n(s.ohGap);

    let shade: InteriorShade | undefined;
    let shadeRow: number | null = null;
    if (!isBlank(s.shade)) {
      shade = shades.find((x) => textEq(x.id, s.shade!));
      if (!shade) {
        issues.push(`interior shade "${s.shade}" not in L3 shade table`);
        shadeRow = NaN;
      } else shadeRow = shade.row - 107;
    }
    const hasShade = shadeRow !== null;
    const IAC0 = !hasShade ? 1 : shade ? shade.IAC0 : NaN;
    const IAC60 = !hasShade ? 1 : shade ? shade.IAC60 : NaN;
    const IACdiff = !hasShade ? 1 : shade ? shade.IACdiff : NaN;
    const frSolar = !hasShade ? 1 : shade ? shade.FR : NaN;
    const frCond = opt.frWin;

    const b: FenestrationBlock = {
      seq: blocks.length + 1, srfRow: idx + 1, surfaceId: s.id, space: s.space,
      glzRow: g ? g.row - 5 : NaN, glazing: g, U, SHGC0, SHGCdiff,
      ACF40: acf[1]!, ACF50: acf[2]!, ACF60: acf[3]!, ACF70: acf[4]!, ACF80: acf[5]!,
      w, h, qty, area, az, tilt, ohDepth, ohGap, shadeRow, shade, IAC0, IAC60, IACdiff, frSolar, frCond,
      theta: [], Etb: [], Etd: [], omega: [], sunlit: [], shgcBeam: [], iacBeam: [], beam: [], diffuse: [], cond: [],
      radSolar: [], radNonsolar: [], convective: [], issues,
    };

    for (const hr of solar.hours) {
      const up = hr.beta > 0;
      const theta = up
        ? deg(Math.acos(Math.max(-1, Math.min(1, Math.cos(rad(hr.beta)) * Math.cos(rad(hr.phi - az)) * Math.sin(rad(tilt)) + Math.sin(rad(hr.beta)) * Math.cos(rad(tilt))))))
        : null;
      const Etb = theta === null ? 0 : hr.Eb * Math.max(0, Math.cos(rad(theta)));
      let Etd = 0;
      if (theta !== null) {
        const c = Math.cos(rad(theta));
        const Y = c > -0.2 ? 0.55 + 0.437 * c + 0.313 * c * c : 0.45;
        Etd = hr.Ed * (Y * Math.sin(rad(tilt)) + (tilt <= 90 ? Math.cos(rad(tilt)) : 0)) + ((hr.Eb * Math.sin(rad(hr.beta)) + hr.Ed) * rhoG * (1 - Math.cos(rad(tilt)))) / 2;
      }
      const cg = Math.cos(rad(hr.phi - az));
      const omega = theta === null || cg <= 0 ? null : deg(Math.atan(Math.tan(rad(hr.beta)) / cg));
      const sunlit =
        Etb <= 0 ? 0 : ohDepth === 0 || omega === null ? area : w * Math.max(0, Math.min(h, h - Math.max(0, ohDepth * Math.tan(rad(omega)) - ohGap))) * qty;
      const shgc = theta === null ? null : shgcAt(theta, SHGC0, acf);
      const iac = !hasShade ? 1 : IAC0 + (IAC60 - IAC0) * Math.min(1, 0.02 * (omega ?? 0));
      const beam = theta === null ? 0 : Etb * sunlit * (shgc as number) * iac;
      const diffuse = Etd * area * SHGCdiff * IACdiff;
      const cond = U * area * (hr.db - opt.tin);
      b.theta.push(theta);
      b.Etb.push(Etb);
      b.Etd.push(Etd);
      b.omega.push(omega);
      b.sunlit.push(sunlit);
      b.shgcBeam.push(shgc);
      b.iacBeam.push(iac);
      b.beam.push(beam);
      b.diffuse.push(diffuse);
      b.cond.push(cond);
      b.radSolar.push(!hasShade ? beam * frSolar : 0);
      b.radNonsolar.push((hasShade ? beam * frSolar : 0) + diffuse * frSolar + cond * frCond);
      b.convective.push((beam + diffuse) * (1 - frSolar) + cond * (1 - frCond));
    }
    blocks.push(b);
  });
  return blocks;
}
