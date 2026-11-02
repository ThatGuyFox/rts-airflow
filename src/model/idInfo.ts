// What a construction / glazing / shade / RTS ID means: description, the numbers behind it, where it comes
// from. Built from the loaded library file and the project's own rows, nothing typed here. Used by the pick
// lists, the Revit import page and the library browser. Pure: no DOM.
import type { Construction } from "../engine/conduction";
import type { AcfRow, GlazingInput, InteriorShade } from "../engine/fenestration";
import type { EngineLibraries } from "../engine/project";
import type { RtsSeries } from "../engine/rts";
import type { ProjectFile } from "./projectFile";

export type IdKind = "construction" | "glazing" | "shade" | "rts";
/** library = standard library row; validation = LCAM Ch. 8 test row; workbook = a row from Matteo's workbook; project = in the project file. */
export type Origin = "library" | "validation" | "workbook" | "project";

export interface IdInfo {
  kind: IdKind;
  id: string;
  origin: Origin;
  /** Wall / Roof / Door / Partition / Floor; glazing: Table 3.8 type; RTS: Exterior / Interior. */
  type: string | null;
  description: string | null;
  /** Numbers for the tables, by short key (u, alpha, ho, lag, shgc, iac0, iac60, iacd, fr). */
  v: Record<string, number | null>;
  /** The same numbers as short labels for one line ("U 0.1"). */
  facts: string[];
  source: string | null;
  /** The row says ASSUMED in its description or source. */
  assumed: boolean;
  /** Example / placeholder row: values are not from a submittal or table. */
  placeholder: boolean;
  /** 24 CTS fractions (constructions only), for the browser's bar chart. */
  cts?: number[];
  /** Hour by which half of the conducted heat has reached the room (derived from CTS, not a tabulated value). */
  lag?: number | null;
}

export interface AcfInfo {
  typeId: string;
  description: string | null;
  layers: number | null;
  tv: number | null;
  shgcRef: number | null;
  source: string | null;
}

export interface Catalog {
  construction: IdInfo[];
  glazing: IdInfo[];
  shade: IdInfo[];
  rts: IdInfo[];
  /** Table 3.8 glazing types (the "angle type" of a glazing row). */
  acf: AcfInfo[];
  find: (kind: IdKind, id: string | null | undefined) => IdInfo | null;
}

const ASSUMED = /ASSUMED/;
const PLACEHOLDER = /EXAMPLE ONLY|placeholder/i;

/** Compact number: no trailing zeros, at most 3 decimals. */
export const short = (x: number): string => String(Number(x.toFixed(3)));

type Extra = { scope?: string; description?: string | null };

function originOf(row: unknown, project: boolean): Origin {
  if (project) return "project";
  const s = (row as Extra).scope;
  return s === "validation" ? "validation" : s === "workbook" ? "workbook" : "library";
}

/** Index j (hours after the gain) at which the running sum of CTS first reaches half of the total. */
export function ctsHalfLag(cts: readonly (number | null)[]): number | null {
  const f = cts.map((x) => x ?? 0);
  const total = f.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let acc = 0;
  for (let j = 0; j < f.length; j++) {
    acc += f[j]!;
    if (acc >= total / 2) return j;
  }
  return null;
}

function flags(description: string | null, source: string | null) {
  return { assumed: ASSUMED.test(`${description ?? ""} ${source ?? ""}`), placeholder: PLACEHOLDER.test(`${description ?? ""} ${source ?? ""}`) };
}

export function describeConstruction(c: Construction, project: boolean): IdInfo {
  const lag = ctsHalfLag(c.CTS);
  const facts = [
    `U ${short(c.U_btuh_ft2F)}`,
    c.alpha != null ? `α ${short(c.alpha)}` : null,
    c.ho_btuh_ft2F != null ? `hₒ ${short(c.ho_btuh_ft2F)}` : null,
    lag != null ? `CTS half by hour ${lag}` : null,
  ].filter((x): x is string => !!x);
  return {
    kind: "construction",
    id: c.id,
    origin: originOf(c, project),
    type: c.type,
    description: c.description,
    v: { u: c.U_btuh_ft2F, alpha: c.alpha, ho: c.ho_btuh_ft2F, lag },
    facts,
    source: c.source,
    ...flags(c.description, c.source),
    cts: c.CTS.map((x) => x ?? 0),
    lag,
  };
}

export function describeGlazing(g: GlazingInput, acf: readonly AcfRow[], project = true): IdInfo {
  const a = g.acfType ? acf.find((r) => r.type_id.toLowerCase() === g.acfType!.toLowerCase()) : undefined;
  const ad = (a as (AcfRow & Extra) | undefined)?.description ?? null;
  const facts = [`U ${short(g.U)}`, `SHGC ${short(g.SHGC0)}`, g.acfType ? `Table 3.8 type ${g.acfType}${ad ? ` (${ad})` : ""}` : "no Table 3.8 type"];
  return {
    kind: "glazing",
    id: g.id,
    origin: project ? "project" : "library",
    type: g.acfType,
    description: g.description,
    v: { u: g.U, shgc: g.SHGC0 },
    facts,
    source: g.source,
    ...flags(g.description, g.source),
  };
}

export function describeShade(s: InteriorShade, project: boolean): IdInfo {
  const d = (s as InteriorShade & Extra).description ?? null;
  return {
    kind: "shade",
    id: s.id,
    origin: originOf(s, project),
    type: null,
    description: d,
    v: { iac0: s.IAC0, iac60: s.IAC60, iacd: s.IACdiff, fr: s.FR },
    facts: [`IAC ${short(s.IAC0)} at 0°, ${short(s.IAC60)} at 60°`, `diffuse ${short(s.IACdiff)}`, `FR ${short(s.FR)}`],
    source: s.source,
    ...flags(d, s.source),
  };
}

export function describeRts(r: RtsSeries, project: boolean): IdInfo {
  const interior = !r.S;
  return {
    kind: "rts",
    id: r.id,
    origin: originOf(r, project),
    type: interior ? "Interior" : "Exterior",
    description: r.description,
    v: {},
    facts: [interior ? "no solar RTS (interior zone)" : "solar and non-solar RTS"],
    source: r.source,
    ...flags(r.description, r.source),
  };
}

function acfInfo(r: AcfRow): AcfInfo {
  const x = r as AcfRow & { description?: string | null; layers?: number | null; Tv?: number | null; SHGC0_reference?: number | null };
  return { typeId: r.type_id, description: x.description ?? null, layers: x.layers ?? null, tv: x.Tv ?? null, shgcRef: x.SHGC0_reference ?? null, source: r.source ?? null };
}

/** Rows from the library file followed by the project's own rows (the engine's first-ID-match order). */
export function buildCatalog(lib: EngineLibraries | null, file: Pick<ProjectFile, "constructions" | "glazing" | "shades" | "rts"> | null, more?: { constructions?: Construction[]; glazing?: GlazingInput[] }): Catalog {
  const acf = lib?.acf ?? [];
  const construction = [
    ...(lib?.constructions ?? []).map((c) => describeConstruction(c, false)),
    ...[...(file?.constructions ?? []), ...(more?.constructions ?? [])].map((c) => describeConstruction(c, true)),
  ];
  const glazing = [...(file?.glazing ?? []), ...(more?.glazing ?? [])].map((g) => describeGlazing(g, acf));
  const shade = [...(lib?.shades ?? []).map((s) => describeShade(s, false)), ...(file?.shades ?? []).map((s) => describeShade(s, true))];
  const rts = [...(lib?.rts ?? []).map((r) => describeRts(r, false)), ...(file?.rts ?? []).map((r) => describeRts(r, true))];
  const index: Record<IdKind, Map<string, IdInfo>> = { construction: new Map(), glazing: new Map(), shade: new Map(), rts: new Map() };
  const lists: Record<IdKind, IdInfo[]> = { construction, glazing, shade, rts };
  for (const k of Object.keys(lists) as IdKind[]) for (const i of lists[k]) if (!index[k].has(i.id.toLowerCase())) index[k].set(i.id.toLowerCase(), i);
  return { construction, glazing, shade, rts, acf: acf.map(acfInfo), find: (kind, id) => (id ? (index[kind].get(id.trim().toLowerCase()) ?? null) : null) };
}

/** One line for a pick list or a note: "Wall · <description> · U 0.1 · α 0.9". */
export function summaryLine(i: IdInfo): string {
  // A glazing row's "type" is its Table 3.8 code, already spelled out in the facts
  return [i.kind === "glazing" ? null : i.type, i.description, ...i.facts].filter((x) => !!x).join(" · ");
}

/** Where each ID is used: kind → lower-case ID → AHU tag → number of rows (rooms for RTS). */
export type Usage = Record<IdKind, Map<string, Map<string, number>>>;

export function usage(file: Pick<ProjectFile, "ahus"> | null): Usage {
  const u: Usage = { construction: new Map(), glazing: new Map(), shade: new Map(), rts: new Map() };
  const add = (k: IdKind, id: string | null | undefined, ahu: string) => {
    if (!id) return;
    const m = u[k].get(id.toLowerCase()) ?? new Map<string, number>();
    m.set(ahu, (m.get(ahu) ?? 0) + 1);
    u[k].set(id.toLowerCase(), m);
  };
  for (const a of file?.ahus ?? []) {
    for (const s of a.surfaces) {
      add(s.type === "Window" ? "glazing" : "construction", s.con, a.id);
      add("shade", s.shade, a.id);
    }
    for (const s of a.spaces) add("rts", s.rts, a.id);
  }
  return u;
}

/** "AHU-1: 6, AHU-2: 2" or "" when unused. */
export function usageText(m: Map<string, number> | undefined): string {
  return m ? [...m.entries()].map(([a, n]) => `${a}: ${n}`).join(", ") : "";
}
