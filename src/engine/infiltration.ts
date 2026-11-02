// Psychrometrics and infiltration: port of C5_Infiltration.
// LCAM Eqs. 5.4 (qs = Cs·Q·Δt) and 5.5 (ql = Cl·Q·ΔW). Humidity ratio: Fund. 2017 Ch. 1 Eqs. 5–6 (pws,
// Hyland–Wexler, over water) and Eq. 35 (W from DB/WB), at site pressure. Negative hours are kept
// (LCAM Tables 8.14/8.16). Hour = local clock time.

import { isBlank, n } from "./excel";
import type { DesignConditions, SolarDay } from "./climate";

/** Saturation pressure over water, psia, T in °F (Fund. 2017 Ch. 1 Eq. 6, I-P). */
export function pws(tF: number): number {
  const T = tF + 459.67;
  return Math.exp(-10440.397 / T - 11.29465 - 0.027022355 * T + 0.00001289036 * T ** 2 - 0.0000000024780681 * T ** 3 + 6.5459673 * Math.log(T));
}

/** Humidity ratio at saturation for partial pressure p, psia. */
export const wFromP = (p: number, patm: number) => (0.621945 * p) / (patm - p);

/** Humidity ratio from DB and WB, °F (Fund. 2017 Ch. 1 Eq. 35, WB above freezing). */
export function wFromDbWb(db: number, wb: number, patm: number): number {
  const wsStar = wFromP(pws(wb), patm);
  return ((1093 - 0.556 * wb) * wsStar - 0.24 * (db - wb)) / (1093 + 0.444 * db - wb);
}

export interface Psychro {
  pwsTi: number; // AG6
  Wi: number; // AG7, calc_Wi
  db: number[]; // row 6
  wb: number[]; // row 7
  pwsWb: number[]; // row 8
  wsStar: number[]; // row 9
  Wo: number[]; // row 10
  dt: number[]; // row 11
  dW: number[]; // row 12
}

export function psychro(dc: DesignConditions, solar: SolarDay, tin: number, rhIn: number): Psychro {
  const pwsTi = pws(tin);
  const Wi = (0.621945 * rhIn * pwsTi) / (dc.patm - rhIn * pwsTi);
  const db = solar.hours.map((h) => h.db);
  const wb = solar.hours.map((h) => h.wb);
  const pwsWb = wb.map(pws);
  const wsStar = pwsWb.map((p) => wFromP(p, dc.patm));
  const Wo = db.map((d, i) => ((1093 - 0.556 * wb[i]!) * wsStar[i]! - 0.24 * (d - wb[i]!)) / (1093 + 0.444 * d - wb[i]!));
  return { pwsTi, Wi, db, wb, pwsWb, wsStar, Wo, dt: db.map((d) => d - tin), dW: Wo.map((w) => w - Wi) };
}

/** 02_Spaces columns used by C5. */
export interface InfSpace {
  id: string;
  area: number; // C
  height: number | null; // D
  ach: number | null; // N
  infCfm: number | null; // U, override
}

export interface InfiltrationBlock {
  n: number; // AF
  spaceId: string;
  cfm: number; // AG
  fromOverride: boolean;
  sensible: number[];
  latent: number[];
}

export function infiltration(spaces: readonly InfSpace[], ps: Psychro, cs: number, cl: number): InfiltrationBlock[] {
  return spaces.map((s, i) => {
    const fromOverride = !isBlank(s.infCfm);
    const cfm = fromOverride ? s.infCfm! : (n(s.ach) * s.area * n(s.height)) / 60;
    return {
      n: i + 1,
      spaceId: s.id,
      cfm,
      fromOverride,
      sensible: ps.dt.map((d) => cs * cfm * d),
      latent: ps.dW.map((w) => cl * cfm * w),
    };
  });
}
