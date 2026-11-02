// Revit import (HANDOFF §8, §13 step 7; schema in docs/revit-import-schema.md). Pure: no DOM.
// The exporter (tools/revit/) writes raw facts: rooms with boundary segments and what lies beyond each one,
// walls, windows, doors. This module turns them into spaces, surfaces (with modelAz) and a plan level, using
// the pilot project's geometry rules. The result is ordinary project data, editable afterwards.

import type { ProjectSpace } from "../engine/project";
import { azOf, norm360, type PlanLevel, type PlanOpening, type PlanRoom, type Pt } from "./plan";
import type { FileSurface } from "./projectFile";

export const REVIT_FORMAT = "rts-airflow-revit";
export const REVIT_VERSION = 1;

/** What bounds a segment: the element's category, and for walls the type name and function. */
export interface RevitBy {
  cat: string; // "Walls", "Structural Columns", "Columns", "Room Separation Lines", …
  type?: string | null;
  function?: string | null; // wall function: "Exterior", "Interior", …
}
export interface RevitSeg {
  a: Pt;
  b: Pt;
  wall: string | null; // bounding wall id (null for columns, separation lines)
  by: RevitBy;
  other: { kind: "exterior" } | { kind: "room"; uid: string } | { kind: "none" };
}
export interface RevitRoom {
  uid: string;
  level: string;
  number: string;
  name: string;
  area: number; // ft²
  height: number | null; // ft, Revit room height
  floorFinish?: string | null; // Revit room Floor Finish parameter (picks carpet / no carpet for RTS)
  above?: RevitAbove | null; // what a ray straight up from the room meets first (null = not checked)
  loops: RevitSeg[][]; // first = outer
}
/** Nearest roof or floor above a room. tilt / az of the roof's upper surface (model azimuth, ° from +Y). */
export interface RevitAbove {
  kind: "roof" | "floor" | "none";
  type?: string | null;
  tilt?: number | null;
  az?: number | null;
  rise?: number | null; // ft from 1 ft above the level to the hit
}
/** A Revit type's thermal data (analytical properties), U in Btu/h·ft²·°F; null where Revit has none. */
export interface RevitType {
  cat: "wall" | "roof" | "window" | "door";
  name: string; // walls / roofs: type name; windows / doors: "Family: Type"
  u: number | null;
  shgc: number | null;
}
export interface RevitWall {
  id: string;
  level: string;
  type: string;
  function: string | null;
  a: Pt;
  b: Pt;
  width: number;
}
export interface RevitOpening {
  id: string;
  level: string;
  kind: "window" | "door";
  family: string;
  type: string;
  w: number | null; // ft
  h: number | null; // ft
  wall: string | null; // host wall id
  at: Pt;
  rooms: (string | null)[]; // room uid each side (null = none / outside)
  cased: boolean; // opening with no panel
}
export interface RevitExport {
  format: typeof REVIT_FORMAT;
  version: typeof REVIT_VERSION;
  exported: string;
  exporter: string;
  model: { host: string; roomsFrom: string; revitTrueNorthDeg?: number | null };
  levels: { id: string; name: string; elevation: number }[];
  rooms: RevitRoom[];
  walls: RevitWall[];
  openings: RevitOpening[];
  types?: RevitType[]; // exporter 1.1+
  notes?: string[];
}

export function parseRevitExport(text: string): RevitExport {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (j?.format !== REVIT_FORMAT) throw new Error("This is not a Revit export for this app (format rts-airflow-revit).");
  if (j.version !== REVIT_VERSION) throw new Error(`Revit export version ${j.version} is not supported (this app reads version ${REVIT_VERSION}).`);
  if (!Array.isArray(j.levels) || !Array.isArray(j.rooms)) throw new Error("The Revit export has no levels or rooms.");
  j.walls ??= [];
  j.openings ??= [];
  return j as RevitExport;
}

// ---------------------------------------------------------------- options

/** How a room is treated: on the AHU being imported; conditioned, no gain; unconditioned (Tadj). */
export type RoomClass = "ahu" | "conditioned" | "unconditioned";
/** Key for "no room beyond" segments (not exterior, not a room) in the class map. */
export const NO_ROOM = "(no room)";

export type TypeKind = "wall" | "partition" | "roof" | "window" | "door";
export const typeKey = (kind: TypeKind, name: string) => `${kind}:${name}`;

export interface ImportOptions {
  level: string; // level id
  prefix: string; // Space ID prefix, e.g. "L1" → "L1-14"
  classes: Record<string, RoomClass>; // room uid → class; NO_ROOM → class for "no room beyond" segments
  types: Record<string, string>; // typeKey → construction / glazing ID ("" or missing = blank, an input error)
  tadj: number; // °F, adjacent temperature of unconditioned rooms (outdoor design DB)
  tadjNote: string; // where tadj came from, for the surface note
  /** New space with this ID / name / area / height: the load fields come from the caller (template or last room). */
  room: (id: string, name: string, area: number, height: number | null) => ProjectSpace;
  /** Space IDs already used on other AHUs: plan rooms with these IDs stay linked. */
  existingIds?: string[];
}

export interface ImportResult {
  spaces: ProjectSpace[];
  surfaces: FileSurface[];
  surfaceTypes: Record<string, string>; // surface ID → typeKey of the Revit type behind its construction / glazing
  level: PlanLevel;
  warnings: string[];
}

/** Level name → Space ID prefix: "Level 1" → "L1", "LEVEL 02" → "L02"; otherwise the name without spaces. */
export function defaultPrefix(levelName: string): string {
  const m = /^\s*(?:level|lvl|l)\s*[-_ ]?\s*(\w+)\s*$/i.exec(levelName);
  return m ? `L${m[1]}` : levelName.replace(/\s+/g, "");
}

export const spaceId = (prefix: string, number: string) => (prefix ? `${prefix}-${number}` : number);

/** Room types the import needs mapped, in a stable order: the Revit types bounding or hosted in the AHU rooms. */
export function neededTypes(x: RevitExport, opt: Pick<ImportOptions, "level" | "classes">): { kind: TypeKind; name: string; key: string }[] {
  const out = new Map<string, { kind: TypeKind; name: string; key: string }>();
  const add = (kind: TypeKind, name: string) => out.set(typeKey(kind, name), { kind, name, key: typeKey(kind, name) });
  const rooms = x.rooms.filter((r) => r.level === opt.level && opt.classes[r.uid] === "ahu");
  for (const r of rooms) {
    for (const s of classify(r, opt.classes)) {
      if (s.use === "exterior" && s.seg.by.cat === "Walls") add("wall", s.seg.by.type ?? "(untyped wall)");
      if (s.use === "partition") add("partition", s.seg.by.type ?? s.seg.by.cat);
    }
    for (const o of roomOpenings(x, r, opt.classes)) add(o.kind === "window" ? "window" : "door", openingType(o.o));
    if (r.above?.kind === "roof") add("roof", r.above.type ?? "(untyped roof)");
  }
  return [...out.values()];
}

const openingType = (o: RevitOpening) => `${o.family}: ${o.type}`;

/** True when the room has a boundary segment facing outside (picks the exterior or interior RTS series). */
export function hasExterior(r: RevitRoom, classes: Record<string, RoomClass>): boolean {
  return classify(r, classes).some((c) => c.use === "exterior");
}

/** Gross exterior wall area (boundary length × room height) and window area (W × H) of a room, ft². */
export function roomGlazing(x: RevitExport, r: RevitRoom, classes: Record<string, RoomClass>): { wall: number; glass: number } {
  const wall = classify(r, classes)
    .filter((c) => c.use === "exterior")
    .reduce((a, c) => a + len(c.seg), 0) * (r.height ?? 0);
  const glass = roomOpenings(x, r, classes)
    .filter((p) => p.c.use === "exterior" && p.kind === "window" && !p.o.cased)
    .reduce((a, p) => a + (p.o.w ?? 0) * (p.o.h ?? 0), 0);
  return { wall, glass };
}

// ---------------------------------------------------------------- geometry

const len = (s: { a: Pt; b: Pt }) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function inPoly(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const loopPts = (loop: RevitSeg[]): Pt[] => loop.map((s) => s.a);
/** Point inside the room: inside the outer loop and outside every inner loop. */
function inRoom(p: Pt, r: RevitRoom): boolean {
  const [outer, ...holes] = r.loops;
  return !!outer && inPoly(p, loopPts(outer)) && !holes.some((h) => inPoly(p, loopPts(h)));
}
/** Outward normal of a boundary segment (pointing away from the room), as a model azimuth. */
function outwardAz(s: RevitSeg, r: RevitRoom): number {
  const L = len(s);
  let n: Pt = [(s.b[1] - s.a[1]) / L, -(s.b[0] - s.a[0]) / L];
  const m: Pt = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  if (inRoom([m[0] + n[0] * 0.05, m[1] + n[1] * 0.05], r)) n = [-n[0], -n[1]];
  return norm360(azOf(n));
}
const dirKey = (az: number) => Math.round(az * 10) / 10;

const isColumn = (s: RevitSeg) => /column/i.test(s.by.cat);

type Use = "exterior" | "column" | "partition" | "none";
interface Classified {
  seg: RevitSeg;
  az: number;
  use: Use;
  loop: number;
  i: number;
}

/**
 * Each boundary segment of a room: exterior (outside), column (a column face next to an exterior segment, the
 * pilot's "corner" pieces), partition (beyond is an unconditioned room, or no room and NO_ROOM is unconditioned),
 * or none (conditioned beyond: no gain).
 */
function classify(r: RevitRoom, classes: Record<string, RoomClass>): Classified[] {
  const out: Classified[] = [];
  r.loops.forEach((loop, li) => {
    const base: Classified[] = loop.map((seg, i) => {
      const az = len(seg) > 1e-9 ? outwardAz(seg, r) : 0;
      let use: Use = "none";
      if (len(seg) <= 1e-9) use = "none";
      else if (seg.other.kind === "exterior" || (seg.other.kind === "none" && seg.by.cat === "Walls" && /exterior/i.test(seg.by.function ?? ""))) use = "exterior";
      else if (seg.other.kind === "room") use = seg.other.uid !== r.uid && classes[seg.other.uid] === "unconditioned" ? "partition" : "none";
      else if (isColumn(seg)) use = "column"; // decided below
      else use = classes[NO_ROOM] === "unconditioned" ? "partition" : "none";
      return { seg, az, use, loop: li, i };
    });
    // A column face counts only if a chain of column faces joins it to an exterior segment
    const n = base.length;
    for (const c of base) {
      if (c.use !== "column") continue;
      let ok = false;
      for (const step of [1, -1]) {
        for (let k = 1; k < n; k++) {
          const o = base[(((c.i + step * k) % n) + n) % n]!;
          if (o.use === "exterior") ok = true;
          if (o.use !== "column") break;
        }
      }
      if (!ok) c.use = "none";
    }
    out.push(...base);
  });
  return out;
}

/** Openings belonging to a room: listed with it by Revit, else on one of its boundary segments (geometry). */
function roomOpenings(x: RevitExport, r: RevitRoom, classes: Record<string, RoomClass>): { o: RevitOpening; c: Classified; kind: "window" | "door" }[] {
  const segs = classify(r, classes);
  const out: { o: RevitOpening; c: Classified; kind: "window" | "door" }[] = [];
  for (const o of x.openings) {
    if (o.level !== r.level) continue;
    let best: { c: Classified; d: number } | null = null;
    for (const c of segs) {
      const s = c.seg, L = len(s);
      if (L < 1e-9) continue;
      if (o.wall && s.wall && o.wall !== s.wall) continue;
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
      const t = ((o.at[0] - s.a[0]) * dx + (o.at[1] - s.a[1]) * dy) / (L * L);
      if (t < -0.01 || t > 1.01) continue;
      const d = Math.abs(((o.at[0] - s.a[0]) * dy - (o.at[1] - s.a[1]) * dx) / L);
      const wall = o.wall ? x.walls.find((w) => w.id === o.wall) : undefined;
      if (d > (wall?.width ?? 1) + 0.5) continue;
      if (!best || d < best.d) best = { c, d };
    }
    if (!best) continue;
    // Revit names the rooms each side; when it does, trust it (geometry only decides for unnamed openings)
    if (o.rooms.some((u) => u) && !o.rooms.includes(r.uid)) continue;
    if (best.c.use === "exterior" || best.c.use === "partition") out.push({ o, c: best.c, kind: o.kind });
  }
  return out;
}

// ---------------------------------------------------------------- import

/** One AHU's spaces and surfaces, plus the plan level, from a Revit export. */
export function importRevit(x: RevitExport, opt: ImportOptions): ImportResult {
  const warnings: string[] = [];
  const lvl = x.levels.find((l) => l.id === opt.level);
  if (!lvl) throw new Error(`Level ${opt.level} is not in the export.`);
  const rooms = x.rooms.filter((r) => r.level === opt.level);
  const ahuRooms = rooms.filter((r) => opt.classes[r.uid] === "ahu");
  const idOf = (r: RevitRoom) => spaceId(opt.prefix, r.number);
  const surfaceTypes: Record<string, string> = {};
  /** Construction / glazing ID for a Revit type, recording which type the surface came from. */
  const tid = (surfaceId: string, kind: TypeKind, name: string) => {
    surfaceTypes[surfaceId] = typeKey(kind, name);
    return opt.types[typeKey(kind, name)] ?? "";
  };
  const spaces: ProjectSpace[] = [];
  const surfaces: FileSurface[] = [];

  const ids = new Set<string>();
  for (const r of ahuRooms) {
    const id = idOf(r);
    if (ids.has(id)) warnings.push(`Two rooms have the number ${r.number}: Space ID ${id} is used twice. Rename one.`);
    ids.add(id);
  }

  for (const r of ahuRooms) {
    const id = idOf(r);
    const h = r.height;
    const H = h ?? 0;
    const sp = opt.room(id, `${r.name} (Rm ${r.number})`, r1(r.area), h);
    const hNote = h == null ? "ASSUMED: Revit gave no room height; enter the ceiling height." : `ASSUMED: height ${r2(h)} ft from the Revit room (check the ceiling height).`;
    sp.notes = sp.notes ? `${hNote} ${sp.notes}` : hNote;
    spaces.push(sp);
    if (h == null) warnings.push(`${id}: no room height in the export; wall areas are 0 until you enter it and re-import, or edit them.`);

    const segs = classify(r, opt.classes);
    const ops = roomOpenings(x, r, opt.classes);

    // Exterior walls: by outward direction, then wall type. Column faces join the wall facing the same way.
    type G = { az: number; type: string; len: number; parts: number; folded: number };
    const ext = new Map<string, G>();
    for (const c of segs.filter((c) => c.use === "exterior")) {
      const type = c.seg.by.cat === "Walls" ? (c.seg.by.type ?? "(untyped wall)") : c.seg.by.cat;
      const k = `${dirKey(c.az)}|${type}`;
      const g = ext.get(k) ?? { az: dirKey(c.az), type, len: 0, parts: 0, folded: 0 };
      g.len += len(c.seg);
      g.parts++;
      ext.set(k, g);
    }
    let dropped = 0;
    for (const c of segs.filter((c) => c.use === "column")) {
      const gs = [...ext.values()].filter((g) => g.az === dirKey(c.az)).sort((p, q) => q.len - p.len);
      if (gs[0]) (gs[0].len += len(c.seg)), (gs[0].folded += len(c.seg));
      else dropped += len(c.seg);
    }
    const groups = [...ext.values()].sort((p, q) => p.az - q.az || q.len - p.len);
    const wallIdOf = new Map<G, string>();
    groups.forEach((g, i) => {
      const sid = `${id}-W${i + 1}`;
      wallIdOf.set(g, sid);
      const notes = [`Revit: exterior, ${r2(g.len)} ft boundary × ${r2(H)} ft, type ${g.type}.`];
      if (g.folded) notes.push(`Includes ${r2(g.folded)} ft of column faces at the corners.`);
      if (i === 0 && dropped) notes.push(`${r2(dropped)} ft of column faces facing no exterior wall of this room left out.`);
      surfaces.push(surf({ id: sid, space: id, type: "Wall", con: tid(sid, "wall", g.type), modelAz: g.az, tilt: 90, area: r1(g.len * H), notes: notes.join(" ") }));
    });
    if (!groups.length && dropped) warnings.push(`${id}: ${r2(dropped)} ft of column faces at exterior corners, but no exterior wall in this room; left out.`);

    // Windows and exterior doors on those walls
    const groupOf = (c: Classified) => groups.find((g) => g.az === dirKey(c.az) && (c.seg.by.cat !== "Walls" || g.type === (c.seg.by.type ?? "(untyped wall)"))) ?? groups.find((g) => g.az === dirKey(c.az));
    const win = new Map<string, { g: G; o: RevitOpening; qty: number }>();
    let nd = 0;
    for (const { o, c } of ops.filter((p) => p.c.use === "exterior")) {
      const g = groupOf(c);
      if (!g) continue;
      if (o.w == null || o.h == null) warnings.push(`${id}: ${o.kind} ${openingType(o)} has no width or height in the export; entered as 0.`);
      if (o.kind === "window" && !o.cased) {
        const k = `${wallIdOf.get(g)}|${o.w}|${o.h}|${openingType(o)}`;
        const e = win.get(k) ?? { g, o, qty: 0 };
        e.qty++;
        win.set(k, e);
      } else {
        nd++;
        const t = openingType(o);
        const note = o.cased
          ? `ASSUMED: cased opening (${t}) modelled as a closed door — confirm with the architect.`
          : `Revit: ${t}, ${r2(o.w ?? 0)} × ${r2(o.h ?? 0)} ft.`;
        surfaces.push(surf({ id: `${id}-D${nd}`, space: id, type: "Door", con: tid(`${id}-D${nd}`, "door", t), modelAz: g.az, tilt: 90, area: r1((o.w ?? 0) * (o.h ?? 0)), host: wallIdOf.get(g)!, notes: note }));
      }
    }
    [...win.values()].forEach((e, i) => {
      const t = openingType(e.o);
      surfaces.push(
        surf({ id: `${id}-G${i + 1}`, space: id, type: "Window", con: tid(`${id}-G${i + 1}`, "window", t), modelAz: e.g.az, tilt: 90, w: e.o.w ?? 0, h: e.o.h ?? 0, qty: e.qty, host: wallIdOf.get(e.g)!, notes: `Revit: ${t}.` }),
      );
    });

    // Partitions to unconditioned rooms (and "no room beyond" when that is unconditioned), by wall type.
    // A door in one becomes its own Partition row with the door construction, netted out of the wall.
    const part = new Map<string, { type: string; len: number; beyond: Set<string>; doors: number }>();
    const beyondName = (c: Classified) => (c.seg.other.kind === "room" ? (x.rooms.find((q) => q.uid === (c.seg.other as { uid: string }).uid)?.name ?? "room") : "no room");
    for (const c of segs.filter((c) => c.use === "partition")) {
      const type = c.seg.by.type ?? c.seg.by.cat;
      const p = part.get(type) ?? { type, len: 0, beyond: new Set<string>(), doors: 0 };
      p.len += len(c.seg);
      p.beyond.add(beyondName(c));
      part.set(type, p);
    }
    const pdoors = ops.filter((p) => p.c.use === "partition");
    let np = 0;
    const partRows: FileSurface[] = [];
    for (const p of part.values()) {
      const doorsHere = pdoors.filter((d) => (d.c.seg.by.type ?? d.c.seg.by.cat) === p.type);
      const doorArea = doorsHere.reduce((a, d) => a + (d.o.w ?? 0) * (d.o.h ?? 0), 0);
      const gross = p.len * H;
      const notes = [`Revit: to ${[...p.beyond].join(", ")} (unconditioned), ${r2(p.len)} ft boundary × ${r2(H)} ft, type ${p.type}. Tadj ${opt.tadjNote}.`];
      if (p.beyond.has("no room")) notes.push("ASSUMED: wall with no room beyond treated as unconditioned.");
      if (doorArea) notes.push(`Net of ${r1(doorArea)} ft² of doors (own rows).`);
      partRows.push(surf({ id: `${id}-P${++np}`, space: id, type: "Partition", con: tid(`${id}-P${np}`, "partition", p.type), area: r1(Math.max(0, gross - doorArea)), tadj: opt.tadj, notes: notes.join(" ") }));
      for (const d of doorsHere) {
        const t = openingType(d.o);
        const note = d.o.cased
          ? `ASSUMED: cased opening (${t}) to unconditioned space modelled as a closed door — confirm with the architect. Tadj ${opt.tadjNote}.`
          : `Revit: ${t} to unconditioned space, ${r2(d.o.w ?? 0)} × ${r2(d.o.h ?? 0)} ft. Tadj ${opt.tadjNote}.`;
        partRows.push(surf({ id: `${id}-P${++np}`, space: id, type: "Partition", con: tid(`${id}-P${np}`, "door", t), area: r1((d.o.w ?? 0) * (d.o.h ?? 0)), tadj: opt.tadj, notes: note }));
      }
    }
    surfaces.push(...partRows);

    // Roof: a Revit roof straight above the room. Area = room area ÷ cos(tilt). A floor above = no gain.
    const ab = r.above;
    if (ab?.kind === "roof") {
      const t = ab.type ?? "(untyped roof)";
      const tilt = ab.tilt ?? 0;
      const sid = `${id}-R1`;
      const notes = [`Revit: roof ${t} above, tilt ${r1(tilt)}°, area = room area ${r1(r.area)} ft²${tilt > 0.5 ? ` ÷ cos ${r1(tilt)}°` : ""}.`];
      if (ab.tilt == null) notes.push("ASSUMED: roof slope not read from Revit, taken as flat.");
      surfaces.push(surf({ id: sid, space: id, type: "Roof", con: tid(sid, "roof", t), modelAz: tilt > 0.5 ? (ab.az ?? 0) : 0, tilt, area: r1(r.area / Math.cos((tilt * Math.PI) / 180)), notes: notes.join(" ") }));
    }
  }
  if (x.notes?.length) warnings.push(...x.notes);

  // Unmapped types: the surface keeps a blank ID, which the app shows as an input error on the room
  const blanks = surfaces.filter((s) => !s.con).length;
  if (blanks) warnings.push(`${blanks} surface(s) have no construction or glazing ID (Revit type not mapped). They show as input errors until entered.`);

  return { spaces, surfaces, surfaceTypes, level: planLevel(x, opt, rooms), warnings };
}

function surf(p: Partial<FileSurface> & Pick<FileSurface, "id" | "space" | "type" | "con">): FileSurface {
  return {
    az: null,
    tilt: null,
    area: null,
    w: null,
    h: null,
    qty: null,
    host: null,
    ohDepth: null,
    ohGap: null,
    shade: null,
    tadj: null,
    notes: null,
    ...p,
  } as FileSurface;
}

function planLevel(x: RevitExport, opt: ImportOptions, rooms: RevitRoom[]): PlanLevel {
  const lvl = x.levels.find((l) => l.id === opt.level)!;
  const known = new Set(opt.existingIds ?? []);
  const planRooms: PlanRoom[] = [];
  const uncond: PlanLevel["unconditioned"] = [];
  for (const r of rooms) {
    const pts = r.loops[0] ? loopPts(r.loops[0]) : [];
    if (pts.length < 3) continue;
    const id = spaceId(opt.prefix, r.number);
    if (opt.classes[r.uid] === "unconditioned") uncond.push({ label: `${r.name}, unconditioned`, pts });
    else planRooms.push({ space: opt.classes[r.uid] === "ahu" || known.has(id) ? id : null, label: `Rm ${r.number}`, pts });
  }
  const exterior = x.walls.filter((w) => w.level === opt.level && /exterior/i.test(w.function ?? ""));
  const extIds = new Set(exterior.map((w) => w.id));
  const openings: PlanOpening[] = x.openings
    .filter((o) => o.level === opt.level && o.wall && extIds.has(o.wall))
    .map((o) => {
      const w = exterior.find((q) => q.id === o.wall)!;
      const dirAz = norm360(azOf([w.b[0] - w.a[0], w.b[1] - w.a[1]]));
      const along: "x" | "y" = Math.abs(Math.sin((dirAz * Math.PI) / 180)) >= Math.abs(Math.cos((dirAz * Math.PI) / 180)) ? "x" : "y";
      return { type: o.kind, at: o.at, along, dirAz, w: o.w ?? 0, label: `${o.family}: ${o.type}` };
    });
  return {
    id: lvl.id,
    name: lvl.name,
    rotation: 0,
    rooms: planRooms,
    unconditioned: uncond,
    walls: exterior.map((w) => ({ a: w.a, b: w.b })),
    openings,
    source: `${x.model.host}${x.model.roomsFrom ? `, rooms from ${x.model.roomsFrom}` : ""}, Revit export ${x.exported} (${x.exporter})`,
  };
}
