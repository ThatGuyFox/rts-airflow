// New project: default values taken from the clean template workbook (RTS_Template_v0.8.xlsx), carried
// in the user's library file (bundle.newProject, built by tools/build_library_bundle.ts). No values are
// typed into the app (Matteo, 2026-11-01). Each default stays in the ASSUMED list until the user edits
// or keeps it. Pure: no DOM, no file access.

import type { ProjectInput, ProjectSpace } from "../engine/project";
import { FILE_FORMAT, FILE_VERSION, type AhuEntry, type AutoField, type ProjectFile } from "./projectFile";

/** Load fields a first room copies from the template room (02_Spaces SP-01). */
export const ROOM_LOAD_FIELDS = ["height", "ach", "infCfm", "lpd", "epd", "occSch", "ltgSch", "eqpSch", "ltgType", "plenum", "activity", "eqpClass", "rts", "ez"] as const;
export type RoomDefaults = Pick<ProjectSpace, (typeof ROOM_LOAD_FIELDS)[number]>;

export interface NewProjectDefaults {
  source: string; // where every value came from
  roomSource: string; // the template room they copy
  climate: Omit<ProjectInput["climate"], "override">;
  indoor: ProjectInput["indoor"];
  envelope: ProjectInput["envelope"];
  load: ProjectInput["load"];
  air: ProjectInput["air"];
  constructions: ProjectInput["constructions"];
  glazing: ProjectInput["glazing"];
  shades: ProjectInput["shades"];
  rts: ProjectInput["rts"];
  schedules: ProjectInput["schedules"];
  room: RoomDefaults;
}

/** Settings tracked as "template default" until edited. Workbook choices are left out: they are always listed. */
export const PROJECT_DEFAULTS: Record<string, string> = {
  "climate.climSrc": "Climate",
  "climate.designPct": "Design percentile",
  "climate.designMonth": "Design month",
  "climate.dst": "Daylight saving",
  "climate.airBasis": "Air factors",
  "climate.rhoG": "Ground reflectance ρg",
  "indoor.tin": "Indoor dry bulb (°F)",
  "indoor.rhIn": "Indoor RH (fraction)",
  "envelope.roofPlenum": "Roof heat to plenum",
  "envelope.frWall": "Radiant fraction, walls",
  "envelope.frRoof": "Radiant fraction, roofs",
  "envelope.frWin": "Radiant fraction, window conduction",
  "envelope.lwHoriz": "Long-wave term, horizontal (°F)",
};
export const AHU_DEFAULTS: Record<string, string> = {
  "load.dTsupply": "Supply ΔT (°F)",
  "load.sf": "Safety factor on sensible",
  "air.sysType": "Airflow basis",
  "air.ventSys": "Ventilation system",
  "air.evMethod": "Ev method",
  "air.ezDefault": "Default Ez configuration",
  "air.pressurization": "Pressurization (cfm)",
};

const get = (o: unknown, path: string): unknown => path.split(".").reduce<any>((x, k) => (x == null ? x : x[k]), o);

/** A new file: project-wide defaults, one AHU with no rooms and no surfaces. */
export function newProjectFile(d: NewProjectDefaults, name: string | null, ahuId: string): ProjectFile {
  const c = structuredClone;
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name,
    climate: c(d.climate),
    indoor: c(d.indoor),
    envelope: c(d.envelope),
    north: { deg: null, source: null },
    constructions: c(d.constructions),
    glazing: c(d.glazing),
    shades: c(d.shades),
    rts: c(d.rts),
    schedules: c(d.schedules),
    templateDefaults: Object.keys(PROJECT_DEFAULTS),
    defaultsSource: d.source,
    ahus: [{ id: ahuId, load: c(d.load), air: c(d.air), spaces: [], surfaces: [], templateDefaults: Object.keys(AHU_DEFAULTS) }],
  };
}

/** First room on an AHU with no rooms: the template room's load fields, marked ASSUMED in its notes. */
export function firstRoom(d: NewProjectDefaults, id: string): ProjectSpace {
  return {
    id,
    name: "New room",
    area: 0,
    ventCat: "",
    people: null,
    exhType: null,
    exhCfm: null,
    xferTo: null,
    exhUnits: null,
    xferCfm: null,
    ...structuredClone(d.room),
    notes: `ASSUMED: load fields copied from ${d.roomSource} (height, ACH, LPD, lighting type, plenum return, EPD, equipment class, people activity, schedules, RTS series). Check them, then edit this note.`,
  };
}

/** Drops from the tracked lists every setting whose value changed between two versions of the file. */
export function pruneDefaults(before: ProjectFile, after: ProjectFile): void {
  if (after.templateDefaults) after.templateDefaults = after.templateDefaults.filter((p) => get(before, p) === get(after, p));
  after.ahus.forEach((a, i) => {
    const b = before.ahus[i];
    if (a.templateDefaults) a.templateDefaults = b && b.id === a.id ? a.templateDefaults.filter((p) => get(b, p) === get(a, p)) : a.templateDefaults;
    // An auto-matched room value stops being ASSUMED once it is edited (or the room is gone)
    if (a.autoMatched && b && b.id === a.id) {
      a.autoMatched = a.autoMatched.filter((m) => {
        if (m.field === "con") {
          const x = a.surfaces.find((s) => s.id === m.surface), y = b.surfaces.find((s) => s.id === m.surface);
          return !!x && !!y && x.con === y.con;
        }
        const x = a.spaces.find((s) => s.id === m.space), y = b.spaces.find((s) => s.id === m.space);
        return !!x && !!y && x[m.field] === y[m.field];
      });
    }
  });
}

export interface DefaultItem {
  scope: "project" | "ahu" | "room";
  path: string;
  ref: string; // label
  text: string;
  room?: string; // scope "room": the Space ID
}

export const AUTO_LABEL: Record<AutoField, string> = { ventCat: "62.1 category", exhType: "Exhaust type", exhUnits: "Exhaust units", rts: "RTS series" };

/** The ASSUMED items for template defaults still untouched, for the project and the AHU on screen. */
export function defaultItems(f: ProjectFile, ahuIndex: number): DefaultItem[] {
  const src = f.defaultsSource ?? "the template workbook";
  const fmt = (v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));
  const out: DefaultItem[] = [];
  for (const p of f.templateDefaults ?? []) out.push({ scope: "project", path: p, ref: PROJECT_DEFAULTS[p] ?? p, text: `${fmt(get(f, p))}: template default (${src}).` });
  const a: AhuEntry | undefined = f.ahus[ahuIndex];
  for (const p of a?.templateDefaults ?? []) out.push({ scope: "ahu", path: p, ref: `${a!.id} ${AHU_DEFAULTS[p] ?? p}`, text: `${fmt(get(a, p))}: template default (${src}).` });
  for (const m of a?.autoMatched ?? []) {
    const s = a!.spaces.find((x) => x.id === m.space);
    if (!s) continue;
    if (m.field === "con") {
      const sf = a!.surfaces.find((x) => x.id === m.surface);
      if (sf) out.push({ scope: "room", path: `${m.space}|con|${m.surface}`, room: m.space, ref: `${m.surface} construction`, text: `${sf.con}: ${m.how}.` });
    } else out.push({ scope: "room", path: `${m.space}|${m.field}`, room: m.space, ref: `${s.name} ${AUTO_LABEL[m.field]}`, text: `${fmt(s[m.field])}: ${m.how}.` });
  }
  return out;
}

/** Keeps a default as entered: removes it from the tracked list without changing the value. */
export function keepDefault(f: ProjectFile, ahuIndex: number, item: DefaultItem): void {
  if (item.scope === "project") f.templateDefaults = (f.templateDefaults ?? []).filter((p) => p !== item.path);
  else if (item.scope === "room") {
    const a = f.ahus[ahuIndex];
    if (a) a.autoMatched = (a.autoMatched ?? []).filter((m) => (m.field === "con" ? `${m.space}|con|${m.surface}` : `${m.space}|${m.field}`) !== item.path);
  } else {
    const a = f.ahus[ahuIndex];
    if (a) a.templateDefaults = (a.templateDefaults ?? []).filter((p) => p !== item.path);
  }
}
