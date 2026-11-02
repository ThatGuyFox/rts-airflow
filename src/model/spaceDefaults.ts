// Space-type defaults (load-input catalogue per 62.1 category; Matteo, 2026-11-02). Pure: no DOM.
// Library: libraries/space_type_defaults.json, built by tools/build_space_defaults.py from 90.1-2022 (LPD) and
// the DOE prototype data (plug loads, weekday schedules); carried in the library file as `spaceDefaults`.
// People come from the 62.1-2022 Table 6-1 default density of the room's category (vent621_zone).
// Every value is ASSUMED: the room note lists what was filled and from which table.

import type { Schedule } from "../engine/internal";
import type { EngineLibraries, ProjectSpace } from "../engine/project";

export interface SpaceDefaultsRow {
  category: string; // 62.1 category, as in vent621_zone
  lpd: { max_ft2: number | null; w_m2: number; w_ft2: number; citation: string }[]; // area bins, ascending; null = no upper limit
  lpd_match: "direct" | "judgement";
  epd_w_ft2?: number;
  epd_citation?: string;
  doe?: { building_type: string; space_type: string; match: "direct" | "judgement" | null };
  schedules?: { occ?: string; ltg?: string; eqp?: string };
}
export interface SpaceDefaultsLib {
  library: "space_type_defaults";
  extracted: string;
  rows: SpaceDefaultsRow[];
  schedules: { id: string; frac: number[]; source: string }[];
}

export interface SpaceDefaultsFill {
  fields: Partial<Pick<ProjectSpace, "people" | "lpd" | "epd" | "occSch" | "ltgSch" | "eqpSch">>;
  schedules: SpaceDefaultsLib["schedules"]; // schedules the fields use
  note: string; // "ASSUMED: space-type defaults for …"
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The defaults for a category and room area, or null when the catalogue has no row for the category. */
export function spaceDefaultsFor(category: string, areaFt2: number, lib: SpaceDefaultsLib, vent: Pick<EngineLibraries, "vent621">): SpaceDefaultsFill | null {
  const row = lib.rows.find((r) => r.category === category);
  if (!row) return null;
  const fields: SpaceDefaultsFill["fields"] = {};
  const parts: string[] = [];

  const zone = vent.vent621.zone.rows.find((z) => z.category === category);
  const dens = zone?.default_density_per_1000ft2;
  if (typeof dens === "number" && Number.isFinite(dens)) {
    fields.people = r1((areaFt2 * dens) / 1000);
    parts.push(`people ${fields.people} = ${dens}/1000 ft² × ${r1(areaFt2)} ft² (62.1-2022 Table 6-1 default occupant density)`);
  }

  const bin = row.lpd.find((b) => b.max_ft2 == null || areaFt2 <= b.max_ft2) ?? row.lpd[row.lpd.length - 1];
  if (bin) {
    fields.lpd = bin.w_ft2;
    parts.push(`LPD ${bin.w_ft2} W/ft² (${bin.citation}${row.lpd_match === "judgement" ? "; nearest space type, judgement" : ""})`);
  }
  if (row.epd_w_ft2 != null) {
    fields.epd = row.epd_w_ft2;
    parts.push(`EPD ${row.epd_w_ft2} W/ft² (${row.epd_citation}${row.doe?.match === "judgement" ? "; nearest space type, judgement" : ""})`);
  }
  const used: SpaceDefaultsLib["schedules"] = [];
  const sch = row.schedules ?? {};
  const pick = (id: string | undefined) => {
    const s = id ? lib.schedules.find((x) => x.id === id) : undefined;
    if (s && !used.includes(s)) used.push(s);
    return s?.id;
  };
  const occ = pick(sch.occ), ltg = pick(sch.ltg), eqp = pick(sch.eqp);
  if (occ) fields.occSch = occ;
  if (ltg) fields.ltgSch = ltg;
  if (eqp) fields.eqpSch = eqp;
  if (used.length) parts.push(`schedules ${used.map((s) => s.id).join(", ")} (DOE prototypes, weekday)`);

  return {
    fields,
    schedules: used,
    note: `ASSUMED: space-type defaults for “${category}”: ${parts.join("; ")}. Code allowances and energy-model averages, not design peaks. Check them, then edit this note.`,
  };
}

/** Adds the catalogue schedules a fill uses to a project's schedule list (once each, new sheet rows). */
export function addSchedules(list: Schedule[], add: SpaceDefaultsLib["schedules"]): void {
  let row = Math.max(4, ...list.map((s) => s.row));
  for (const s of add) if (!list.some((x) => x.id === s.id)) list.push({ row: ++row, id: s.id, frac: [...s.frac] });
}
