// Display formatting. I-P units throughout.
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const F = new Map<number, Intl.NumberFormat>();
const fmt = (d: number) => {
  let f = F.get(d);
  if (!f) F.set(d, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })));
  return f;
};

/** Number with thousands separators; NaN / null shows as a dash. */
export function num(v: number | null | undefined, d = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return fmt(d).format(Object.is(r, -0) ? 0 : v);
}

export const month = (m: number | null | undefined) => (m ? (MONTHS[m - 1] ?? String(m)) : "—");
export const hour = (h: number | null | undefined) => (h ? `${String(h).padStart(2, "0")}:00` : "—");
export const bad = (v: number | null | undefined) => v === null || v === undefined || !Number.isFinite(v);
