// RTS series per room for the Revit import (Matteo, 2026-11-02). Pure: no DOM.
// The library's series (LCAM Tables 7.11/7.12 = Fund. Ch. 18 Tables 19/20) vary by construction weight
// (L / M / H), carpet (C / N), % glass of the exterior wall (10 / 50 / 90) for exterior zones, and an interior
// set with no glass. The room's series is built from those four and must exist in the loaded RTS rows:
//   exterior: RTS-{weight}-{carpet}{glass}   interior: RTS-INT-{weight}-{carpet}
// Glass % comes from Revit (window W×H ÷ gross exterior wall), taken to the nearest tabulated column.
// Carpet comes from the Revit Floor Finish when it names a floor type, else the page's default.
// Weight is one choice per import. The result is listed ASSUMED until edited or kept.

export type Weight = "L" | "M" | "H";
export type Carpet = "C" | "N";
export const WEIGHT_LABEL: Record<Weight, string> = { L: "Light", M: "Medium", H: "Heavy" };
export const GLASS_COLUMNS = [10, 50, 90] as const;

/** Carpet / no carpet from a Floor Finish text, or null when the text does not say. */
export function carpetFrom(finish: string | null | undefined): Carpet | null {
  const t = (finish ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/carpet|cpt\b/.test(t)) return "C";
  if (/\b(tile|vct|vinyl|lvt|terrazzo|concrete|conc|ceramic|porcelain|epoxy|sealed|wood|hardwood|stone|marble|granite|linoleum|rubber|quarry|polished)\b/.test(t)) return "N";
  return null;
}

/** Nearest tabulated glass column; a tie goes to the larger. */
export function glassColumn(pct: number): number {
  let best: number = GLASS_COLUMNS[0];
  for (const c of GLASS_COLUMNS) if (Math.abs(pct - c) <= Math.abs(pct - best)) best = c;
  return best;
}

/** Weight and carpet of a library series ID, e.g. RTS-M-N10 → M, N; RTS-INT-L-C → L, C. */
export function parseSeries(id: string | null | undefined): { weight: Weight; carpet: Carpet } | null {
  const m = /^RTS-(?:INT-)?([LMH])-([CN])/i.exec(id ?? "");
  return m ? { weight: m[1]!.toUpperCase() as Weight, carpet: m[2]!.toUpperCase() as Carpet } : null;
}

export interface RtsInputs {
  exterior: boolean;
  weight: Weight;
  carpet: Carpet; // the page default
  floorFinish?: string | null;
  wallFt2: number; // gross exterior wall
  glassFt2: number;
}

/** The room's series ID (null if that series is not in the library) and why, for the ASSUMED note. */
export function pickSeries(p: RtsInputs, seriesIds: string[]): { id: string | null; how: string } {
  const fc = carpetFrom(p.floorFinish);
  const carpet = fc ?? p.carpet;
  const cWhy = fc ? `${carpet === "C" ? "carpet" : "no carpet"} (Floor Finish “${p.floorFinish}”)` : `${carpet === "C" ? "carpet" : "no carpet"} (import default${p.floorFinish ? `; Floor Finish “${p.floorFinish}” not recognised` : ", no Floor Finish in Revit"})`;
  const wWhy = `${WEIGHT_LABEL[p.weight]} construction (import choice)`;
  let want: string, gWhy: string;
  if (p.exterior) {
    const pct = p.wallFt2 > 0 ? (100 * p.glassFt2) / p.wallFt2 : 0;
    const col = glassColumn(pct);
    want = `RTS-${p.weight}-${carpet}${col}`;
    gWhy = `${Math.round(pct)}% glass (${Math.round(p.glassFt2)} of ${Math.round(p.wallFt2)} ft² exterior wall) → ${col}% column`;
  } else {
    want = `RTS-INT-${p.weight}-${carpet}`;
    gWhy = "interior zone (no exterior wall)";
  }
  const id = seriesIds.find((s) => s.toUpperCase() === want) ?? null;
  return { id, how: id ? `${wWhy}, ${cWhy}, ${gWhy} (Revit import)` : `series ${want} is not in the RTS library` };
}
