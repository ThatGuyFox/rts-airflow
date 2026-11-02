// Pick lists for the input fields, read from the loaded libraries and the project's own rows.
import type { EngineLibraries } from "../engine/project";
import { buildCatalog, type Catalog } from "../model/idInfo";
import type { ProjectFile } from "../model/projectFile";

export interface Options {
  /** What each construction / glazing / shade / RTS ID means (pick-list labels, detail lines, library browser). */
  catalog: Catalog;
  ventCat: string[];
  ez: string[];
  exhType: string[];
  activity: string[];
  ltgType: string[];
  eqpClass: string[];
  schedules: string[];
  rts: string[];
  constructions: string[];
  glazing: string[];
  shades: string[];
  designPct: string[];
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export function buildOptions(lib: EngineLibraries | null, f: ProjectFile | null): Options {
  const pct = lib
    ? Object.keys(lib.climate.monthly_IP_by_formula.rows)
        .map((k) => /^DB (.+) \(°F\)$/.exec(k)?.[1])
        .filter((x): x is string => !!x)
    : [];
  return {
    catalog: buildCatalog(lib, f),
    ventCat: uniq(lib?.vent621.zone.rows.map((r) => r.category) ?? []),
    ez: uniq(lib?.vent621.ez.rows.map((r) => r.id) ?? []),
    exhType: uniq(lib?.vent621.exhaust.rows.map((r) => r.type) ?? []),
    activity: uniq(lib?.gains.people.map((r) => r.activity) ?? []),
    ltgType: uniq(lib?.gains.lighting.map((r) => r.fixture) ?? []),
    eqpClass: uniq(lib?.gains.equipment.map((r) => r.class) ?? []),
    schedules: uniq(f?.schedules.map((s) => s.id) ?? []),
    rts: uniq([...(lib?.rts.map((r) => r.id) ?? []), ...(f?.rts.map((r) => r.id) ?? [])]),
    constructions: uniq([...(lib?.constructions.map((r) => r.id) ?? []), ...(f?.constructions.map((r) => r.id) ?? [])]),
    glazing: uniq(f?.glazing.map((g) => g.id) ?? []),
    shades: uniq([...(lib?.shades.map((r) => r.id) ?? []), ...(f?.shades.map((r) => r.id) ?? [])]),
    designPct: uniq(pct),
  };
}
