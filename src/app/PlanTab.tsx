// "Plan and north": the level plan (or a wall compass when the file has no plan geometry), a draggable
// north arrow, the bearing each wall direction faces, and the north controls (HANDOFF §8, step 6).
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { azOf, bbox, dirOf, faceAnchor, norm360, point8, rot, unrot, wallGroups, type PlanLevel, type Pt, type Rotation, type WallGroup } from "../model/plan";
import type { AhuEntry, ProjectFile } from "../model/projectFile";
import { NumField, TextField } from "./ui";

interface Props {
  file: ProjectFile;
  ahuIndex: number;
  onFile: (fn: (f: ProjectFile) => void) => void;
  onRoom: (id: string) => void;
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function PlanTab({ file, ahuIndex, onFile, onRoom }: Props) {
  const ahu = file.ahus[ahuIndex]!;
  const levels = file.plan?.levels ?? [];
  const [liPick, setLi] = useState<number | null>(null);
  const [extent, setExtent] = useState<"ahu" | "level">("ahu");
  // Until a level is picked, show the level holding this AHU's rooms
  const auto = Math.max(0, levels.findIndex((l) => l.rooms.some((r) => r.space && ahu.spaces.some((s) => s.id === r.space))));
  const li = Math.min(liPick ?? auto, Math.max(0, levels.length - 1));
  const level = levels[li] ?? null;
  const north = file.north.deg;
  const groups = wallGroups(ahu, north);
  const [gSel, setGSel] = useState<number | null>(null);
  const g = groups.find((x) => x.modelAz === gSel) ?? groups[0] ?? null;
  const roomName = (id: string) => ahu.spaces.find((s) => s.id === id)?.name ?? id;

  const setNorth = (v: number | null) => onFile((f) => void (f.north.deg = v === null ? null : norm360(v)));

  return (
    <section className="plan-tab">
      <div className="panel plan-sheet">
        <div className="plan-bar" hidden={!level}>
          {levels.length > 1 && (
            <label>
              Level{" "}
              <select value={li} onChange={(e) => setLi(Number(e.target.value))}>
                {levels.map((l, i) => (
                  <option key={l.id} value={i}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {levels.length === 1 && <b>{level!.name}</b>}
          {level && (
            <>
              <span className="muted">Rotate view</span>
              <span className="seg" role="group" aria-label="Rotate view">
                {ROTATIONS.map((r) => (
                  <button key={r} aria-pressed={level.rotation === r} data-testid={`rotate-${r}`} onClick={() => onFile((f) => void (f.plan!.levels[li]!.rotation = r))}>
                    {r}°
                  </button>
                ))}
              </span>
              <span className="muted">Show</span>
              <span className="seg" role="group" aria-label="Plan extent">
                <button aria-pressed={extent === "ahu"} onClick={() => setExtent("ahu")}>
                  This AHU
                </button>
                <button aria-pressed={extent === "level"} onClick={() => setExtent("level")}>
                  Whole level
                </button>
              </span>
            </>
          )}
        </div>
        <PlanSvg level={level} ahu={ahu} extent={extent} north={north} groups={groups} onNorth={setNorth} onRoom={onRoom} />
        <p className="muted plan-note">
          {level
            ? `Drag anywhere on the plan toward north (Shift snaps to 5°). Teal = rooms on ${ahu.id}. Geometry: ${level.source ?? "no source recorded"}.`
            : "This project has no plan geometry yet (it comes with the Revit import), so walls are shown as a compass in model directions, +Y up. Drag toward north (Shift snaps to 5°)."}
        </p>
      </div>

      <div className="plan-controls">
        <div className="panel">
          <h3>North</h3>
          <div className="north-big">
            <span data-testid="north-deg">{north === null ? "—" : f1(north)}</span>°
          </div>
          <p className="muted small">Model azimuth of true north, clockwise from model +Y. True azimuth of a wall = model azimuth − north.</p>
          {north === null && <p className="muted small">Blank: model +Y is treated as north.</p>}
          {!file.north.source && <span className="badge assumed">ASSUMED · no source</span>}
          <TextField label="Source of north" value={file.north.source} onChange={(v) => onFile((f) => void (f.north.source = v))} testId="north-source" wide />
          <NumField label="Set exactly" unit="°" allowBlank value={north} onChange={setNorth} testId="north-input" />
          <div className="btnrow" role="group" aria-label="Nudge north">
            {[-5, -1, -0.1, 0.1, 1, 5].map((d) => (
              <button key={d} onClick={() => setNorth(r1((north ?? 0) + d))}>
                {d > 0 ? `+${d}` : `−${-d}`}°
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Set it from a wall</h3>
          {g ? (
            <>
              <p className="muted small">When the site plan says which way a wall faces.</p>
              <div className="field wide">
                <label htmlFor="wall-select">Wall direction</label>
                <select id="wall-select" data-testid="wall-select" value={g.modelAz} onChange={(e) => setGSel(Number(e.target.value))}>
                  {groups.map((x) => (
                    <option key={x.modelAz} value={x.modelAz}>
                      {x.rooms.map(roomName).join(", ")} (model {f1(x.modelAz)}°)
                    </option>
                  ))}
                </select>
              </div>
              <NumField label="Faces (true)" unit="°" value={g.trueAz} onChange={(v) => v !== null && setNorth(g.modelAz - v)} testId="wall-bearing" />
              <div className="btnrow" role="group" aria-label="Compass points">
                {["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((p, i) => (
                  <button key={p} className={Math.abs(norm360(g.trueAz - i * 45)) < 0.05 ? "on" : undefined} onClick={() => setNorth(g.modelAz - i * 45)}>
                    {p}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">No wall on {ahu.id} has a model azimuth yet. Enter “Faces (model)” for its walls in the room panel.</p>
          )}
        </div>

        <div className="panel">
          <h3>Walls by direction</h3>
          {groups.length === 0 ? (
            <p className="muted small">None yet.</p>
          ) : (
            <table className="results compact" data-testid="wall-table">
              <thead>
                <tr>
                  <th className="text">Model</th>
                  <th>Faces (true)</th>
                  <th>Surfaces</th>
                </tr>
              </thead>
              {groups.map((x) => (
                <tbody key={x.modelAz} className="wall-group">
                  <tr>
                    <td className="text">{f1(x.modelAz)}°</td>
                    <td className="strong">
                      {point8(x.trueAz)} {f1(x.trueAz)}°
                    </td>
                    <td>{x.surfaces.length}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="text small">
                      {x.rooms.map((r, i) => (
                        <span key={r}>
                          {i > 0 && ", "}
                          <button className="link" onClick={() => onRoom(r)}>
                            {roomName(r)}
                          </button>
                        </span>
                      ))}
                    </td>
                  </tr>
                </tbody>
              ))}
            </table>
          )}
          <p className="muted small">Step 2 uses these true azimuths. Walls with only a typed true azimuth (no model azimuth) are not listed and do not move with north.</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

interface SvgProps {
  level: PlanLevel | null;
  ahu: AhuEntry;
  extent: "ahu" | "level";
  north: number | null;
  groups: WallGroup[];
  onNorth: (v: number) => void;
  onRoom: (id: string) => void;
}

function PlanSvg({ level, ahu, extent, north, groups, onNorth, onRoom }: SvgProps) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  const r: Rotation = level?.rotation ?? 0;
  const ids = new Set(ahu.spaces.map((s) => s.id));
  const W = 800, pad = 120;

  // Fit: this AHU's rooms, or the whole level; a compass when there is no plan
  let fit: Pt[] = [];
  if (level) {
    const mine = level.rooms.filter((x) => x.space && ids.has(x.space)).flatMap((x) => x.pts);
    fit = extent === "ahu" && mine.length ? mine : [...level.rooms.flatMap((x) => x.pts), ...level.unconditioned.flatMap((x) => x.pts), ...level.walls.flatMap((w) => [w.a, w.b])];
  }
  const compass = !level || fit.length === 0;
  if (compass) fit = [[-1, -1], [1, 1]];
  const rb = bbox(fit.map((p) => rot(p, r)));
  // Fixed frame, so text keeps its size whatever the plan's shape or rotation
  const H = compass ? 440 : 680;
  const bw = Math.max(rb.x1 - rb.x0, 1e-9), bh = Math.max(rb.y1 - rb.y0, 1e-9);
  const sc = compass ? 150 : Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  const ox = (W - bw * sc) / 2, oy = (H - bh * sc) / 2;
  const S = (p: Pt): Pt => {
    const q = rot(p, r);
    return compass ? [W / 2 + q[0] * sc, H / 2 + q[1] * sc] : [(q[0] - rb.x0) * sc + ox, (q[1] - rb.y0) * sc + oy];
  };
  const pts = (ps: Pt[]) => ps.map((p) => S(p).map((v) => v.toFixed(1)).join(",")).join(" ");
  const pivot: Pt = [W / 2, H / 2];
  const sdir = (az: number): Pt => rot(dirOf(az), r); // unit screen direction of a model azimuth

  const onPointer = (e: RPointerEvent<SVGSVGElement>) => {
    const svg = ref.current, m = svg?.getScreenCTM();
    if (!svg || !m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const d: Pt = [p.x - pivot[0], p.y - pivot[1]];
    if (Math.hypot(d[0], d[1]) < 4) return;
    let t = azOf(unrot(d, r));
    t = e.shiftKey ? Math.round(t / 5) * 5 : Math.round(t * 10) / 10;
    onNorth(t);
  };

  // Wall-direction arrows, anchored on the matching exterior wall nearest this AHU's rooms
  const mineB = level ? level.rooms.filter((x) => x.space && ids.has(x.space)).flatMap((x) => x.pts) : [];
  const nb = mineB.length ? bbox(mineB) : null;
  const near: Pt = nb ? [(nb.x0 + nb.x1) / 2, (nb.y0 + nb.y1) / 2] : [0, 0];
  const reach = nb ? Math.hypot(nb.x1 - nb.x0, nb.y1 - nb.y0) / 2 : 1;
  const arrows = groups.map((g) => {
    const out = sdir(g.modelAz);
    let a: Pt;
    if (compass) a = [pivot[0] + out[0] * sc, pivot[1] + out[1] * sc];
    else {
      const hit = level ? faceAnchor(level, g.modelAz, near) : null;
      const md = dirOf(g.modelAz);
      a = S(hit ? hit.at : [near[0] + md[0] * reach, near[1] + md[1] * reach]);
    }
    const s0: Pt = [a[0] + out[0] * 6, a[1] + out[1] * 6], s1: Pt = [a[0] + out[0] * 44, a[1] + out[1] * 44];
    const lab: Pt = [s1[0] + out[0] * 12, s1[1] + out[1] * 12];
    const anchor: "start" | "end" | "middle" = out[0] > 0.35 ? "start" : out[0] < -0.35 ? "end" : "middle";
    const base: "hanging" | "auto" | "central" = out[1] > 0.35 ? "hanging" : out[1] < -0.35 ? "auto" : "central";
    return { g, s0, s1, out, lab, anchor, base };
  });

  const nd = sdir(north ?? 0);
  const L = Math.min(W, H) * (compass ? 0.22 : 0.16);
  const tip: Pt = [pivot[0] + nd[0] * L, pivot[1] + nd[1] * L];
  const head = (t: Pt, d: Pt, hl: number, hw: number) =>
    `${t[0]},${t[1]} ${t[0] - d[0] * hl - d[1] * hw},${t[1] - d[1] * hl + d[0] * hw} ${t[0] - d[0] * hl + d[1] * hw},${t[1] - d[1] * hl - d[0] * hw}`;

  return (
    <svg
      ref={ref}
      className="plan-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Plan with a north arrow at ${north ?? 0}° model azimuth`}
      data-testid="plan-svg"
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onPointer(e);
      }}
      onPointerMove={(e) => drag.current && onPointer(e)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
    >
      <defs>
        <pattern id="plan-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="p-hatch" />
        </pattern>
      </defs>
      {compass ? (
        <g>
          <circle cx={pivot[0]} cy={pivot[1]} r={sc} className="p-compass" />
          <text x={W / 2} y={H / 2 + sc + 26} className="p-t muted" textAnchor="middle">
            {groups.length ? "Wall directions in model axes" : "No walls with a model azimuth yet"}
          </text>
        </g>
      ) : (
        level && (
          <g>
            {level.unconditioned.map((u, i) => (
              <g key={i}>
                <polygon points={pts(u.pts)} className="p-uncond" />
                <polygon points={pts(u.pts)} fill="url(#plan-hatch)" />
              </g>
            ))}
            {level.rooms.map((x, i) => {
              const mine = !!x.space && ids.has(x.space);
              return (
                <polygon
                  key={i}
                  points={pts(x.pts)}
                  className={mine ? "p-room mine" : "p-room"}
                  data-testid={mine ? `plan-room-${x.space}` : undefined}
                  onPointerDown={mine ? (e) => (e.stopPropagation(), onRoom(x.space!)) : undefined}
                >
                  <title>{mine ? ahu.spaces.find((s) => s.id === x.space)?.name : x.space ?? x.label}</title>
                </polygon>
              );
            })}
            {level.walls.map((w, i) => {
              const a = S(w.a), b = S(w.b);
              return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="p-wall" />;
            })}
            {level.openings.map((o, i) => {
              const h = o.w / 2, d: Pt = o.dirAz != null ? dirOf(o.dirAz) : o.along === "x" ? [1, 0] : [0, 1];
              const a = S([o.at[0] - d[0] * h, o.at[1] - d[1] * h]), b = S([o.at[0] + d[0] * h, o.at[1] + d[1] * h]);
              return (
                <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={o.type === "window" ? "p-win" : "p-door"}>
                  <title>{o.label}</title>
                </line>
              );
            })}
            {level.rooms.map((x, i) => {
              const mine = !!x.space && ids.has(x.space);
              const sp = x.pts.map(S), sb = bbox(sp);
              const [cx, cy] = labelPoint(sp), w = sb.x1 - sb.x0;
              const name = mine ? (ahu.spaces.find((s) => s.id === x.space)?.name ?? x.space!).replace(/\s*\(Rm \d+\)$/, "") : x.label;
              if (w < 26 || sb.y1 - sb.y0 < 16) return null;
              const fits = name.length * 6.6 < w - 8; // ~6.6 px per character at 12 px
              return (
                <text key={i} x={cx} y={cy} className={mine ? "p-t" : "p-t muted"} textAnchor="middle" dominantBaseline="central" fontSize={fits ? 12 : 11}>
                  {fits || !mine ? name : x.space}
                  {!fits && mine && <title>{name}</title>}
                </text>
              );
            })}
          </g>
        )
      )}

      {/* model axes */}
      <g transform={`translate(56 ${H - 56})`}>
        {(
          [
            [rot([1, 0], r), "+X"],
            [rot([0, 1], r), "+Y"],
          ] as [Pt, string][]
        ).map(([d, t]) => (
          <g key={t}>
            <line x1={0} y1={0} x2={d[0] * 26} y2={d[1] * 26} className="p-axis" />
            <text x={d[0] * 38} y={d[1] * 38} className="p-t muted" textAnchor="middle" dominantBaseline="central" fontSize={11}>
              {t}
            </text>
          </g>
        ))}
      </g>

      {arrows.map(({ g, s0, s1, out, lab, anchor, base }) => (
        <g key={g.modelAz} className="p-face">
          <line x1={s0[0]} y1={s0[1]} x2={s1[0] - out[0] * 8} y2={s1[1] - out[1] * 8} />
          <polygon points={head(s1, out, 10, 5)} />
          <text x={lab[0]} y={lab[1]} textAnchor={anchor} dominantBaseline={base} data-testid={`face-${g.modelAz}`}>
            {point8(g.trueAz)} {Math.round(g.trueAz)}°
          </text>
        </g>
      ))}

      {/* compass cross and north arrow */}
      {[
        [[-nd[1], nd[0]], "E"],
        [[-nd[0], -nd[1]], "S"],
        [[nd[1], -nd[0]], "W"],
      ].map(([v, t]) => {
        const d = v as Pt, e: Pt = [pivot[0] + d[0] * L * 0.45, pivot[1] + d[1] * L * 0.45];
        return (
          <g key={t as string}>
            <line x1={pivot[0]} y1={pivot[1]} x2={e[0]} y2={e[1]} className="p-cross" />
            <text x={e[0] + d[0] * 12} y={e[1] + d[1] * 12} className="p-t muted" textAnchor="middle" dominantBaseline="central" fontSize={12}>
              {t as string}
            </text>
          </g>
        );
      })}
      <g className="p-north">
        <line x1={pivot[0]} y1={pivot[1]} x2={tip[0] - nd[0] * 16} y2={tip[1] - nd[1] * 16} />
        <polygon points={head(tip, nd, 20, 8)} />
        <circle cx={tip[0]} cy={tip[1]} r={14} className="p-handle" />
        <circle cx={pivot[0]} cy={pivot[1]} r={4} />
        <text x={tip[0] + nd[0] * 28} y={tip[1] + nd[1] * 28} textAnchor="middle" dominantBaseline="central">
          N
        </text>
      </g>
      {north === null && (
        <text x={W - 16} y={24} className="p-t muted" textAnchor="end" fontSize={12}>
          North blank: model +Y taken as north
        </text>
      )}
    </svg>
  );
}

/** A label point well inside a polygon (screen coords): the grid point farthest from the edges. */
function labelPoint(p: Pt[]): Pt {
  const b = bbox(p);
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i]!, [xj, yj] = p[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const edge = (x: number, y: number) => {
    let d = Infinity;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [ax, ay] = p[j]!, [bx, by] = p[i]!, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return d;
  };
  let best: Pt = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], bd = -1;
  for (let i = 1; i < 16; i++)
    for (let j = 1; j < 16; j++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / 16, y = b.y0 + ((b.y1 - b.y0) * j) / 16;
      if (!inside(x, y)) continue;
      const d = edge(x, y);
      if (d > bd) (bd = d), (best = [x, y]);
    }
  return best;
}
