// Plan geometry and north (HANDOFF §8 "North orientation", decisions-web-app.md step 6). Pure: no DOM.
// Conventions kept from the prototype (reference/north-orientation-tool.html):
// - NORTH = model azimuth of true north, ° clockwise from model +Y;
// - true azimuth of a surface = model azimuth of its outward normal − NORTH, mod 360.
// Coordinates are model feet (Revit internal), +Y up. Rotation = the plan turned clockwise on screen.

import type { AhuEntry } from "./projectFile";

export type Pt = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface PlanRoom {
  space: string | null; // Space ID (02_Spaces) on any AHU of the file; null = not modelled
  label: string; // short label when the room is not a project space
  pts: Pt[];
}
export interface PlanOpening {
  type: "window" | "door";
  at: Pt; // centre
  along: "x" | "y"; // wall direction (nearest model axis)
  dirAz?: number; // exact wall direction, ° clockwise from model +Y (Revit import); overrides `along` when set
  w: number; // width, ft
  label: string;
}
export interface PlanLevel {
  id: string;
  name: string;
  rotation: Rotation;
  rooms: PlanRoom[];
  unconditioned: { label: string; pts: Pt[] }[]; // garage etc., hatched
  walls: { a: Pt; b: Pt }[]; // exterior wall lines
  openings: PlanOpening[];
  source: string | null; // where the geometry came from
}
export interface Plan {
  levels: PlanLevel[];
}

export const norm360 = (a: number) => {
  const r = ((a % 360) + 360) % 360;
  return Math.round(r * 1e9) / 1e9 === 360 ? 0 : Math.round(r * 1e9) / 1e9;
};

/** True azimuth from model azimuth; blank north counts as 0 (model +Y = north) and stays ASSUMED. */
export const trueAz = (modelAz: number, north: number | null) => norm360(modelAz - (north ?? 0));

const P8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const point8 = (b: number) => P8[Math.round(norm360(b) / 45) % 8]!;

/** Model → screen direction (unscaled, y down) for a plan rotated clockwise by r. */
export function rot(p: Pt, r: Rotation): Pt {
  const u = p[0], v = -p[1], a = (r * Math.PI) / 180, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  return [u * c - v * s, u * s + v * c];
}
/** Screen direction (y down) → model direction. */
export function unrot(d: Pt, r: Rotation): Pt {
  const a = (r * Math.PI) / 180, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  const u = d[0] * c + d[1] * s, v = -d[0] * s + d[1] * c;
  return [u, -v];
}
/** Model azimuth (° clockwise from +Y) of a model direction. */
export const azOf = (d: Pt) => norm360((Math.atan2(d[0], d[1]) * 180) / Math.PI);
/** Unit model direction of a model azimuth. */
export const dirOf = (az: number): Pt => [Math.sin((az * Math.PI) / 180), Math.cos((az * Math.PI) / 180)];

export interface WallGroup {
  modelAz: number;
  trueAz: number;
  surfaces: string[];
  rooms: string[];
}

/** This AHU's surfaces with a model azimuth, grouped by direction (0.1°). */
export function wallGroups(a: AhuEntry, north: number | null): WallGroup[] {
  const m = new Map<number, WallGroup>();
  for (const s of a.surfaces) {
    if (s.modelAz == null || !Number.isFinite(s.modelAz)) continue;
    const k = Math.round(norm360(s.modelAz) * 10) / 10;
    const g = m.get(k) ?? { modelAz: k, trueAz: trueAz(k, north), surfaces: [], rooms: [] };
    g.surfaces.push(s.id);
    if (!g.rooms.includes(s.space)) g.rooms.push(s.space);
    m.set(k, g);
  }
  return [...m.values()].sort((x, y) => x.modelAz - y.modelAz);
}

export function bbox(pts: Pt[]) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * Where to draw the arrow for walls facing modelAz: on the exterior wall line whose outward normal has that
 * azimuth (±1°), the one nearest `near`, at the point closest to `near`. Outward = away from the walls' centre.
 */
export function faceAnchor(level: PlanLevel, modelAz: number, near: Pt): { at: Pt; out: Pt } | null {
  if (!level.walls.length) return null;
  const b = bbox(level.walls.flatMap((w) => [w.a, w.b]));
  const c: Pt = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  let best: { at: Pt; out: Pt; d: number } | null = null;
  for (const w of level.walls) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    let n: Pt = [dy / L, -dx / L];
    const mid: Pt = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    if (n[0] * (mid[0] - c[0]) + n[1] * (mid[1] - c[1]) < 0) n = [-n[0], -n[1]];
    const diff = Math.abs(((azOf(n) - modelAz + 540) % 360) - 180);
    if (diff > 1) continue;
    const t = Math.max(0, Math.min(1, ((near[0] - w.a[0]) * dx + (near[1] - w.a[1]) * dy) / (L * L)));
    const at: Pt = [w.a[0] + t * dx, w.a[1] + t * dy];
    const d = Math.hypot(at[0] - near[0], at[1] - near[1]);
    if (!best || d < best.d) best = { at, out: n, d };
  }
  return best && { at: best.at, out: best.out };
}
