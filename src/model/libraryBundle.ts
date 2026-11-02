// Library file: the libraries/*.json exports combined into one JSON the user keeps on their own computer
// and loads into the app (ASHRAE tables are not bundled or published; decisions-web-app.md).
// Built by tools/build_library_bundle.ts. Pure: no DOM, no file access.

import type { EngineLibraries } from "../engine/project";
import type { NewProjectDefaults } from "./newProject";
import type { SpaceDefaultsLib } from "./spaceDefaults";

export const LIBRARY_FORMAT = "rts-airflow-libraries";
export const LIBRARY_VERSION = 1;

/** libraries/<name>.json → files[name]. */
export const LIBRARY_FILES = [
  "climate_nassau",
  "daily_temperature_profile",
  "constructions",
  "glazing_angle_correction",
  "interior_shades",
  "rts",
  "people",
  "lighting",
  "equipment",
  "vent621_zone",
  "vent621_ez",
  "vent621_exhaust",
] as const;

export type LibraryName = (typeof LIBRARY_FILES)[number];

export interface LibraryBundle {
  format: typeof LIBRARY_FORMAT;
  version: typeof LIBRARY_VERSION;
  built: string; // ISO date the bundle was built
  source: string; // where the rows came from (workbook export)
  files: Record<LibraryName, any>;
  /** New-project defaults from the template workbook (absent in library files built before 2026-11-01). */
  newProject?: NewProjectDefaults;
  /** Space-type defaults per 62.1 category (libraries/space_type_defaults.json; absent before 2026-11-02). */
  spaceDefaults?: SpaceDefaultsLib;
}

/** The engine's library object from a bundle. */
export function librariesFromBundle(b: LibraryBundle): EngineLibraries {
  const f = b.files;
  return {
    climate: f.climate_nassau,
    profile: f.daily_temperature_profile,
    constructions: f.constructions.rows,
    acf: f.glazing_angle_correction.rows,
    shades: f.interior_shades.rows,
    rts: f.rts.rows,
    gains: { people: f.people.rows, lighting: f.lighting.rows, equipment: f.equipment.rows },
    vent621: { zone: f.vent621_zone, ez: f.vent621_ez, exhaust: f.vent621_exhaust },
  };
}

/** Parses a loaded library file. Throws with a plain message. */
export function parseLibraryBundle(text: string): LibraryBundle {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (j?.format !== LIBRARY_FORMAT) {
    if (j?.format === "rts-airflow-file") throw new Error("This is a project file. Open it with “Open project”.");
    throw new Error("This is not the library file. Build it with tools/build_library_bundle.ts.");
  }
  if (j.version !== LIBRARY_VERSION) throw new Error(`Library file version ${j.version} is not supported (this app reads version ${LIBRARY_VERSION}).`);
  const missing = LIBRARY_FILES.filter((k) => !j.files?.[k]);
  if (missing.length) throw new Error(`The library file is missing: ${missing.join(", ")}.`);
  return j as LibraryBundle;
}
