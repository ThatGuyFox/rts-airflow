// Small helpers that reproduce the spreadsheet functions the workbook relies on.
// The oracle engine is LibreOffice, so edge behaviour follows LibreOffice (HANDOFF §10.8).

/** Round to 15 significant digits, as LibreOffice does before CEILING/FLOOR (rtl::math::approxValue). */
function approx(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  return Number(x.toPrecision(15));
}

/** CEILING(x, step) for step > 0: smallest multiple of step that is >= x.
 *  45.000000000001 from float noise stays 45, as in the workbook. */
export function ceiling(x: number, step: number): number {
  if (step <= 0) throw new Error(`ceiling: step must be > 0, got ${step}`);
  return Math.ceil(approx(x / step)) * step;
}

/** ROUND(x, digits): half away from zero. */
export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  const v = approx(Math.abs(x) * f);
  return (Math.sign(x) * Math.round(v)) / f;
}

/** Excel MATCH(...,0) and SEARCH compare text case-insensitively. */
export function textEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Blank cell test: null, undefined or "" (the workbook's ="" checks). */
export function isBlank(v: unknown): v is null | undefined | "" {
  return v === null || v === undefined || v === "";
}

/** N(): numbers pass, everything else is 0. */
export function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
