// Design conditions (01_Project B20:B34) and solar geometry / clear-sky irradiance (C1_Solar).
// LCAM App. D Eqs. D.2–D.20 and Eq. 4.1; design day = 21st. These equation choices reproduce LCAM
// Table 8.6 and are decided (HANDOFF §5): do not "improve" them.

export type ClimSrc = "Nassau" | "Override";
export type AirBasis = "Site" | "Standard";

/** L1_Climate library file (libraries/climate_nassau.json). */
export interface ClimateLibrary {
  library: string;
  table_source: string;
  site: Record<string, { value: number | string; note: string | null; cell: string }>;
  monthly_IP_by_formula: { cells: string; rows: Record<string, number[]> };
}

/** LCAM Eq. 4.1 coefficients, Table 4.3 (libraries/daily_temperature_profile.json). */
export interface DailyProfileLibrary {
  library: string;
  table_source: string;
  eq_4_1_coefficients: { rows: { i: number; a: number; b: number }[] };
}

/** L1 A78:B91 manual climate block (project data; used by the LCAM8 validation copy). */
export interface ClimateOverride {
  location: string;
  lat: number; // °N
  long: number; // °W, positive west
  tz: number; // h from GMT
  elevFt: number;
  dbPeak: number; // °F
  mcwb: number; // °F
  dbRange: number; // °F
  wbRange: number; // °F
  taub: number;
  taud: number;
  month: number; // C1 uses this month, not the project month
}

export interface DesignInputs {
  climSrc: ClimSrc; // in_ClimSrc B8
  designPct: string; // in_DesignPct B9, e.g. "2%"
  month: number; // calc_Month B27 (in_Month, or the swept month)
  dst: boolean; // in_DST B11
  airBasis: AirBasis; // in_AirBasis B44
  rhoG: number; // in_RhoG B18
  override?: ClimateOverride;
}

export interface DesignConditions {
  lat: number;
  long: number;
  lsm: number; // standard meridian, °W
  elevFt: number; // B20
  patm: number; // B21 psia, Fund. 2017 Ch. 1 Eq. 3
  rho: number; // B22 lb/ft³
  cs: number; // B23 sensible air factor
  cl: number; // B24 latent air factor
  ct: number; // B25 total air factor
  dstShift: number; // B26 clock → LST, h
  month: number; // B27
  dbPeak: number; // B29 °F
  mcwb: number; // B30 °F
  dbRange: number; // B31 °F
  wbRange: number; // B32 °F
  taub: number; // B33
  taud: number; // B34
  solarMonth: number; // C1 B10
}

function site(lib: ClimateLibrary, label: string): number {
  const v = lib.site[label]?.value;
  if (typeof v !== "number") throw new Error(`climate library: site value "${label}" missing`);
  return v;
}

function monthly(lib: ClimateLibrary, label: string, month: number): number {
  const row = lib.monthly_IP_by_formula.rows[label];
  const v = row?.[month - 1];
  if (typeof v !== "number") throw new Error(`climate library: "${label}" month ${month} missing`);
  return v;
}

export function designConditions(d: DesignInputs, lib: ClimateLibrary): DesignConditions {
  const o = d.climSrc === "Override" ? d.override : undefined;
  if (d.climSrc === "Override" && !o) throw new Error("climate source is Override but no override block given");

  const elevFt = o ? o.elevFt : site(lib, "Elevation, ft");
  const patm = 14.696 * (1 - 0.0000068754 * elevFt) ** 5.2559;
  const rho = (0.075 * patm) / 14.696;
  const std = d.airBasis === "Standard";

  return {
    lat: o ? o.lat : site(lib, "Latitude, °N"),
    long: o ? o.long : site(lib, "Longitude, °W (positive west)"),
    lsm: o ? -o.tz * 15 : site(lib, "Std. longitude of time zone, °W"),
    elevFt,
    patm,
    rho,
    cs: std ? 1.1 : 60 * rho * 0.244,
    cl: std ? 4840 : 60 * rho * 1076,
    ct: std ? 4.5 : 60 * rho,
    dstShift: d.dst ? -1 : 0,
    month: d.month,
    dbPeak: o ? o.dbPeak : monthly(lib, `DB ${d.designPct} (°F)`, d.month),
    mcwb: o ? o.mcwb : monthly(lib, `MCWB ${d.designPct} (°F)`, d.month),
    dbRange: o ? o.dbRange : monthly(lib, "DB range coinc. w/ 5% DB (°F)", d.month),
    wbRange: o ? o.wbRange : monthly(lib, "WB range coinc. w/ 5% DB (°F)", d.month),
    taub: o ? o.taub : monthly(lib, "taub", d.month),
    taud: o ? o.taud : monthly(lib, "taud", d.month),
    solarMonth: o ? o.month : d.month,
  };
}

// ---------------------------------------------------------------------------------------------
// C1_Solar

export interface SolarDayParams {
  n: number; // B11 day of year (21st), LCAM Table D.1
  B: number; // B13 Eq. D.4, °
  ET: number; // B14 equation of time, min, Eq. D.3
  gamma: number; // B15 Eq. D.2, °
  decl: number; // B16 declination, °, Eq. D.7
  Eo: number; // B17 extraterrestrial, Btu/h·ft², Eq. D.15
  ab: number; // B20 Eq. D.17
  ad: number; // B21 Eq. D.18
}

export interface SolarHour {
  hour: number; // A, local clock time 1–24
  lst: number; // B
  ast: number; // C, Eq. D.5
  H: number; // D hour angle, °, Eq. D.6
  sinBeta: number; // E, Eq. D.9
  beta: number; // F solar altitude, °
  phi: number; // G solar azimuth, ° from N clockwise (0 when sun down), Eq. D.11/D.12
  m: number; // H air mass, Eq. D.16
  Eb: number; // I beam normal, Btu/h·ft², Eq. D.19
  Ed: number; // J diffuse horizontal, Btu/h·ft², Eq. D.20
  f: number; // K daily-range fraction, Eq. 4.1 at AST
  db: number; // L outdoor DB, °F
  wb: number; // M outdoor WB, °F
}

export interface SolarDay {
  params: SolarDayParams;
  hours: SolarHour[];
}

const DAY_OF_YEAR = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function solarDay(dc: DesignConditions, profile: DailyProfileLibrary): SolarDay {
  const n = DAY_OF_YEAR[dc.solarMonth - 1];
  if (n === undefined) throw new Error(`solar month ${dc.solarMonth} out of range`);
  const B = (360 * (n - 81)) / 364;
  const ET = 9.87 * Math.sin(2 * rad(B)) - 7.53 * Math.cos(rad(B)) - 1.5 * Math.sin(rad(B));
  const g = (360 * (n - 1)) / 365;
  const decl =
    0.3963723 -
    22.9132745 * Math.cos(rad(g)) +
    4.0254304 * Math.sin(rad(g)) -
    0.387205 * Math.cos(rad(2 * g)) +
    0.05196728 * Math.sin(rad(2 * g)) -
    0.1545267 * Math.cos(rad(3 * g)) +
    0.08479777 * Math.sin(rad(3 * g));
  const Eo = 433.3 * (1 + 0.033 * Math.cos(rad((360 * (n - 3)) / 365)));
  const tb = dc.taub;
  const td = dc.taud;
  const ab = 1.454 - 0.406 * tb - 0.268 * td + 0.021 * tb * td;
  const ad = 0.507 + 0.205 * tb - 0.08 * td - 0.19 * tb * td;
  const coef = profile.eq_4_1_coefficients.rows;

  const hours: SolarHour[] = [];
  for (let hour = 1; hour <= 24; hour++) {
    const lst = hour + dc.dstShift;
    const ast = lst + ET / 60 + (dc.lsm - dc.long) / 15;
    const H = 15 * (ast - 12);
    const sinBeta = Math.cos(rad(dc.lat)) * Math.cos(rad(decl)) * Math.cos(rad(H)) + Math.sin(rad(dc.lat)) * Math.sin(rad(decl));
    const beta = deg(Math.asin(sinBeta));
    const up = beta > 0;
    let phi = 0;
    if (up) {
      const c = (Math.sin(rad(decl)) * Math.cos(rad(dc.lat)) - Math.cos(rad(decl)) * Math.sin(rad(dc.lat)) * Math.cos(rad(H))) / Math.cos(rad(beta));
      const a = deg(Math.acos(Math.max(-1, Math.min(1, c))));
      phi = H > 0 ? 360 - a : a;
    }
    const m = up ? 1 / (sinBeta + 0.50572 * (6.07995 + beta) ** -1.6364) : 0;
    const Eb = up ? Eo * Math.exp(-tb * m ** ab) : 0;
    const Ed = up ? Eo * Math.exp(-td * m ** ad) : 0;
    let f = 0;
    for (const { i, a, b } of coef) f += a * Math.cos((2 * Math.PI * i * ast) / 24) + b * Math.sin((2 * Math.PI * i * ast) / 24);
    hours.push({ hour, lst, ast, H, sinBeta, beta, phi, m, Eb, Ed, f, db: dc.dbPeak - dc.dbRange * f, wb: dc.mcwb - dc.wbRange * f });
  }
  return { params: { n, B, ET, gamma: g, decl, Eo, ab, ad }, hours };
}
