// Saved project file: several AHUs per file (decisions-web-app.md, "before step 5").
// Project-wide items are stored once; each AHU holds its own spaces, surfaces and air-side settings.
// toProjectInput turns one AHU into the engine's ProjectInput (one workbook's scope) for runProject.
// Pure: no DOM, no file access.

import type { Surface } from "../engine/conduction";
import type { ProjectInput } from "../engine/project";
import { trueAz, type Plan } from "./plan";

/** A 03_Surfaces row as saved. With modelAz set, the engine's true azimuth is modelAz − north (az is not used). */
export type FileSurface = Surface & { modelAz?: number | null };

export const FILE_FORMAT = "rts-airflow-file";
export const FILE_VERSION = 1;

/** One AHU system: its rooms, surfaces, load and air-side settings. */
export interface AhuEntry {
  id: string; // AHU tag, e.g. "AHU-L1-1" (01_Project B6)
  load: ProjectInput["load"]; // supply ΔT, safety factor
  air: ProjectInput["air"]; // B7, B47:B56
  spaces: ProjectInput["spaces"];
  surfaces: FileSurface[];
  /** Settings still at their new-project template value ("load.dTsupply", …); listed ASSUMED until edited. */
  templateDefaults?: string[];
  /** Room fields filled automatically at Revit import; listed ASSUMED until the value is edited or kept. */
  autoMatched?: AutoMatch[];
}

export type AutoField = "ventCat" | "exhType" | "exhUnits" | "rts";
export interface AutoMatch {
  space: string; // Space ID
  field: AutoField | "con"; // "con": the construction / glazing ID of surface `surface`
  surface?: string;
  how: string; // why this value, for the ASSUMED list
}

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  name: string | null; // project name (01_Project B5)
  climate: ProjectInput["climate"];
  indoor: ProjectInput["indoor"];
  envelope: ProjectInput["envelope"];
  north: ProjectInput["north"];
  constructions: ProjectInput["constructions"];
  glazing: ProjectInput["glazing"];
  shades: ProjectInput["shades"];
  rts: ProjectInput["rts"];
  schedules: ProjectInput["schedules"];
  ahus: AhuEntry[];
  /** Floor plan geometry (step 6); absent = no plan, the Plan tab shows a wall compass. */
  plan?: Plan;
  /** Project-wide settings still at their new-project template value ("indoor.tin", …); see newProject.ts. */
  templateDefaults?: string[];
  /** Where the new-project defaults came from (library file's newProject.source). */
  defaultsSource?: string;
  /** Revit type → construction / glazing ID, as mapped on Revit imports ("wall:Exterior - CMU 8in" → "F-W24"). */
  revitTypeMap?: Record<string, string>;
}

/** The engine input for one AHU of the file. */
export function toProjectInput(f: ProjectFile, ahuIndex: number): ProjectInput {
  const a = f.ahus[ahuIndex];
  if (!a) throw new Error(`AHU ${ahuIndex + 1} not in the file`);
  return {
    format: "rts-airflow-project",
    version: 1,
    name: f.name,
    ahu: a.id,
    climate: f.climate,
    indoor: f.indoor,
    load: a.load,
    envelope: f.envelope,
    air: a.air,
    north: f.north,
    spaces: a.spaces,
    surfaces: a.surfaces.map(({ modelAz, ...s }) => (modelAz != null && Number.isFinite(modelAz) ? { ...s, az: trueAz(modelAz, f.north.deg) } : s)),
    constructions: f.constructions,
    glazing: f.glazing,
    shades: f.shades,
    rts: f.rts,
    schedules: f.schedules,
  };
}

/** Wraps a single-AHU engine input as a file with one AHU. */
export function fromProjectInput(p: ProjectInput, ahuId?: string): ProjectFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: p.name,
    climate: p.climate,
    indoor: p.indoor,
    envelope: p.envelope,
    north: p.north,
    constructions: p.constructions,
    glazing: p.glazing,
    shades: p.shades,
    rts: p.rts,
    schedules: p.schedules,
    ahus: [{ id: ahuId ?? p.ahu ?? "AHU-1", load: p.load, air: p.air, spaces: p.spaces, surfaces: p.surfaces }],
  };
}

/** Parses a loaded file. Accepts this format, or a bare single-AHU ProjectInput. Throws with a plain message. */
export function parseProjectFile(text: string): ProjectFile {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (j?.format === FILE_FORMAT) {
    if (j.version !== FILE_VERSION) throw new Error(`Project file version ${j.version} is not supported (this app reads version ${FILE_VERSION}).`);
    if (!Array.isArray(j.ahus) || j.ahus.length === 0) throw new Error("The project file has no AHUs.");
    return j as ProjectFile;
  }
  if (j?.format === "rts-airflow-project" && j.version === 1) return fromProjectInput(j as ProjectInput);
  if (j?.format === "rts-airflow-libraries") throw new Error("This is the library file. Load it with “Load libraries”.");
  throw new Error("This is not a project file for this app.");
}

/** A new, empty AHU that copies the load and air-side settings of an existing one (no values typed in here). */
export function newAhu(id: string, like: AhuEntry): AhuEntry {
  const a: AhuEntry = { id, load: { ...like.load }, air: { ...like.air }, spaces: [], surfaces: [] };
  if (like.templateDefaults) a.templateDefaults = [...like.templateDefaults]; // copied values are still defaults
  return a;
}
