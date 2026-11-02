// "Import from Revit": reads an rts-airflow-revit export (tools/revit/ exporter), lets the user classify the
// rooms of one level and map Revit types to construction / glazing IDs, then makes a new project or a new AHU.
// The result is ordinary project data, edited as usual afterwards. Rules: src/model/revitImport.ts.
import { useMemo, useState } from "react";
import { designConditions } from "../engine/climate";
import type { EngineLibraries, ProjectInput, ProjectSpace } from "../engine/project";
import { firstRoom, newProjectFile, type NewProjectDefaults } from "../model/newProject";
import { newAhu, type AhuEntry, type AutoMatch, type ProjectFile } from "../model/projectFile";
import { parseSeries, pickSeries, WEIGHT_LABEL, type Carpet, type Weight } from "../model/rtsPick";
import { defaultPrefix, hasExterior, roomGlazing, importRevit, neededTypes, NO_ROOM, spaceId, type RevitExport, type RevitRoom, type RoomClass, type TypeKind } from "../model/revitImport";
import { matchRoom, type RoomMatch } from "../model/roomMatch";
import { resolveTypes, type TypeSource } from "../model/typeResolve";
import { addSchedules, spaceDefaultsFor, type SpaceDefaultsLib } from "../model/spaceDefaults";
import type { Options } from "./options";

interface Props {
  exp: RevitExport;
  fileName: string;
  file: ProjectFile | null;
  ahu: AhuEntry | null; // AHU on screen (a new AHU copies its settings)
  defaults: NewProjectDefaults | null;
  spaceLib: SpaceDefaultsLib | null; // space-type defaults per 62.1 category (library file)
  libs: EngineLibraries | null;
  options: Options;
  onCancel: () => void;
  onDone: (file: ProjectFile, ahuIndex: number, isNew: boolean, summary: string) => void;
}

const CLASS_LABEL: Record<RoomClass, string> = { ahu: "On this AHU", conditioned: "Conditioned, no gain", unconditioned: "Unconditioned (Tadj)" };
const KIND_LABEL: Record<TypeKind, string> = { wall: "Exterior wall", partition: "Wall to unconditioned", roof: "Roof", window: "Window", door: "Door" };
const SRC_LABEL: Record<TypeSource, string> = { page: "entered", remembered: "your map", "revit-u": "from Revit U", "new-row": "new row", none: "" };
const LS_TYPEMAP = "rts-airflow.revitTypeMap";
function recallMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_TYPEMAP) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function storeMap(m: Record<string, string>) {
  try {
    localStorage.setItem(LS_TYPEMAP, JSON.stringify(m));
  } catch {
    /* storage blocked: the map is still saved in the project file */
  }
}

/** Outdoor design DB, highest month at the project's design percentile (HANDOFF §8: garage Tadj = 92.7 °F at Nassau 2%). */
function designDb(c: Omit<ProjectInput["climate"], "override"> & { override?: ProjectInput["climate"]["override"] }, libs: EngineLibraries | null) {
  if (!libs) return null;
  try {
    let best = { db: -Infinity, m: 0 };
    for (let m = 1; m <= 12; m++) {
      const d = designConditions({ climSrc: c.climSrc, designPct: c.designPct, month: m, dst: c.dst, airBasis: c.airBasis, rhoG: c.rhoG, override: c.override }, libs.climate);
      if (d.dbPeak > best.db) best = { db: d.dbPeak, m: c.climSrc === "Override" ? d.month : m };
    }
    return { db: Math.round(best.db * 10) / 10, month: best.m, pct: c.designPct };
  } catch {
    return null;
  }
}
/** Most used construction weight and carpet in a file's RTS series (to prefill the page), with where they came from. */
function seriesInUse(f: ProjectFile | null, templateRts: string | null | undefined): { weight: Weight; carpet: Carpet; src: string } {
  const tally = <T extends string>(xs: T[]) => {
    const m = new Map<T, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const parsed = (f?.ahus ?? []).flatMap((a) => a.spaces.map((s) => parseSeries(s.rts))).filter((p) => !!p);
  if (parsed.length) return { weight: tally(parsed.map((p) => p.weight))!, carpet: tally(parsed.map((p) => p.carpet))!, src: "most used in this project" };
  const t = parseSeries(templateRts);
  if (t) return { ...t, src: `template room series ${templateRts}` };
  return { weight: "M", carpet: "N", src: "Medium, no carpet as in the pilot project" };
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function RevitImport({ exp, fileName, file, ahu, defaults, spaceLib, libs, options, onCancel, onDone }: Props) {
  const levelsWithRooms = exp.levels.filter((l) => exp.rooms.some((r) => r.level === l.id));
  const [levelId, setLevelId] = useState(levelsWithRooms[0]?.id ?? exp.levels[0]?.id ?? "");
  const level = exp.levels.find((l) => l.id === levelId);
  const [prefix, setPrefix] = useState(defaultPrefix(level?.name ?? ""));
  const canNew = !!defaults;
  const [mode, setMode] = useState<"new" | "ahu">(file ? "ahu" : "new");
  const [projName, setProjName] = useState(exp.model.host.replace(/\.rvt$/i, ""));
  const [tag, setTag] = useState(file ? `AHU-${file.ahus.length + 1}` : "AHU-1");
  const [classes, setClasses] = useState<Record<string, RoomClass>>({ [NO_ROOM]: "unconditioned" });
  const [types, setTypes] = useState<Record<string, string>>({});
  const climate = mode === "new" ? defaults?.climate : file?.climate;
  const dDb = useMemo(() => (climate ? designDb(climate, libs) : null), [climate, libs]);
  const [tadj, setTadj] = useState<number | null>(null);
  const tadjVal = tadj ?? dDb?.db ?? null;
  const tadjNote =
    tadj === null && dDb ? `${dDb.db} °F = outdoor design DB, ${dDb.pct} ${MONTH[dDb.month - 1]} (highest month)` : `${tadjVal} °F, entered at import`;

  const rooms = exp.rooms.filter((r) => r.level === levelId).sort((p, q) => p.number.localeCompare(q.number, undefined, { numeric: true }));
  const cls = (uid: string): RoomClass => classes[uid] ?? "conditioned";
  const fullClasses = useMemo(() => Object.fromEntries([...rooms.map((r) => [r.uid, cls(r.uid)]), [NO_ROOM, classes[NO_ROOM] ?? "unconditioned"]]), [rooms, classes]);
  const need = neededTypes(exp, { level: levelId, classes: fullClasses });

  // Revit type → construction / glazing ID: typed here, else your remembered map, else from Revit's U / SHGC
  const remembered = useMemo(() => ({ ...recallMap(), ...(file?.revitTypeMap ?? {}) }), [file]);
  const target = mode === "new" ? defaults : file;
  const resolved = useMemo(
    () =>
      resolveTypes({
        need,
        revitTypes: exp.types ?? [],
        picks: types,
        remembered,
        library: libs?.constructions ?? [],
        project: target?.constructions ?? [],
        glazing: target?.glazing ?? [],
        acf: (libs?.acf ?? []) as never,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(need), exp, types, remembered, libs, target],
  );
  const idMap = useMemo(() => Object.fromEntries(need.map((t) => [t.key, resolved.choice[t.key]?.id ?? ""])), [resolved]);
  const ahuRooms = rooms.filter((r) => fullClasses[r.uid] === "ahu");

  // 62.1 category and exhaust type: matched from the room name (src/model/roomMatch.ts), changeable per room.
  // RTS series per room (src/model/rtsPick.ts): weight chosen once here, carpet from Floor Finish (else the
  // default here), glass % from the room's windows and exterior walls; changeable per room.
  const [catPick, setCatPick] = useState<Record<string, string>>({});
  const [exhPick, setExhPick] = useState<Record<string, string>>({});
  const [rtsPick, setRtsPick] = useState<Record<string, string>>({});
  const inUse = useMemo(() => seriesInUse(mode === "ahu" ? file : null, defaults?.room.rts), [mode, file, defaults]);
  const [weightPick, setWeight] = useState<Weight | null>(null);
  const [carpetPick, setCarpet] = useState<Carpet | null>(null);
  const weight = weightPick ?? inUse.weight;
  const carpet = carpetPick ?? inUse.carpet;
  const NONE: RoomMatch = { ventCat: null, exhType: null, how: "" };
  const match = (r: RevitRoom) => (libs ? matchRoom(r.name, libs) : NONE);
  const catOf = (r: RevitRoom) => catPick[r.uid] ?? match(r).ventCat ?? "";
  const exhOf = (r: RevitRoom) => exhPick[r.uid] ?? match(r).exhType ?? "";
  const autoRts = (r: RevitRoom) => {
    const g = roomGlazing(exp, r, fullClasses);
    return pickSeries({ exterior: hasExterior(r, fullClasses), weight, carpet, floorFinish: r.floorFinish, wallFt2: g.wall, glassFt2: g.glass }, options.rts);
  };
  const rtsOf = (r: RevitRoom) => rtsPick[r.uid] ?? autoRts(r).id ?? "";

  // Load inputs Revit does not have (people, LPD, EPD, schedules, lighting type, activity, equipment class,
  // plenum, infiltration, Ez): copied from a room already in the project with the same room number, else one
  // with the same 62.1 category, else the template room (Matteo, 2026-11-02). Listed ASSUMED in the room note.
  const existing = mode === "ahu" ? (file?.ahus.flatMap((a) => a.spaces) ?? []) : [];
  const num = (s: string) => s.replace(/^0+(?=\d)/, "").toLowerCase();
  const roomNumberOf = (s: ProjectSpace) => /\(rm\s*([\w.-]+)\)\s*$/i.exec(s.name ?? "")?.[1] ?? /-([\w.]+)$/.exec(s.id)?.[1] ?? null;
  const sourceOf = (r: RevitRoom): { s: ProjectSpace; why: string } | null => {
    const byNum = existing.find((s) => roomNumberOf(s) != null && num(roomNumberOf(s)!) === num(r.number));
    if (byNum) return { s: byNum, why: "same room number" };
    const cat = catOf(r);
    const byCat = cat ? existing.find((s) => s.ventCat === cat) : undefined;
    return byCat ? { s: byCat, why: "same 62.1 category" } : null;
  };
  /** Category shown and used: typed, else from the name, else from a same-number room already in the project. */
  const effCat = (r: RevitRoom) => {
    if (catPick[r.uid] !== undefined || catOf(r)) return catOf(r);
    const src = sourceOf(r);
    return src?.why === "same room number" ? src.s.ventCat : "";
  };
  const LOAD_COPY =["people", "ach", "infCfm", "lpd", "epd", "occSch", "ltgSch", "eqpSch", "ltgType", "plenum", "activity", "eqpClass", "ez"] as const;

  /** Space-type defaults for a room (people, LPD, EPD, schedules) from its category, if the catalogue has it. */
  const defaultsFill = (r: RevitRoom) => {
    const cat = effCat(r);
    return spaceLib && libs && cat ? spaceDefaultsFor(cat, r.area, spaceLib, libs) : null;
  };

  // A new room: the template room's load fields (library file), else a copy of this AHU's last room
  const like = ahu?.spaces[ahu.spaces.length - 1];
  const makeRoom = (id: string, name: string, area: number, height: number | null): ProjectSpace => {
    const base: ProjectSpace = defaults
      ? firstRoom(defaults, id)
      : like
        ? { ...structuredClone(like), people: null, ventCat: "", exhType: null, exhCfm: null, exhUnits: null, xferTo: null, xferCfm: null, notes: `ASSUMED: load fields copied from ${like.id}.` }
        : ({ id, name, area, ventCat: "", people: null } as ProjectSpace);
    const r = ahuRooms.find((q) => spaceId(prefix, q.number) === id);
    if (!r) return { ...base, id, name, area, height, people: null, ventCat: "" };
    const exh = exhOf(r);
    const src = sourceOf(r);
    // A category the name did not give (and not typed here) comes from a same-number room too
    const cat = effCat(r);
    // No matching room in the project: the space-type defaults of the category, else the template room
    const sd = !src ? defaultsFill(r) : null;
    const copied = src ? Object.fromEntries(LOAD_COPY.map((k) => [k, structuredClone(src.s[k])])) : sd ? sd.fields : { people: null };
    const notes = src
      ? `ASSUMED: load inputs copied from ${src.s.id} ${src.s.name} (${src.why}): people, LPD, EPD, schedules, lighting type, activity, equipment class, plenum, infiltration, Ez${cat && !catOf(r) ? ", 62.1 category" : ""}. Check them, then edit this note.`
      : [sd?.note, base.notes?.replace(", RTS series)", ")")].filter(Boolean).join(" ") || null; // RTS is set per room from the Revit data
    return {
      ...base,
      ...copied,
      id,
      name,
      area,
      height,
      ventCat: cat,
      exhType: exh || null,
      exhUnits: exh ? 1 : null,
      exhCfm: null,
      rts: rtsOf(r) || null,
      notes,
    } as ProjectSpace;
  };

  /** The fields set automatically, listed ASSUMED in the app until edited or kept. */
  const autoList = (): AutoMatch[] => {
    const out: AutoMatch[] = [];
    for (const r of ahuRooms) {
      const space = spaceId(prefix, r.number), m = match(r);
      if (catPick[r.uid] === undefined && m.ventCat) out.push({ space, field: "ventCat", how: m.how });
      if (exhPick[r.uid] === undefined && m.exhType) out.push({ space, field: "exhType", how: m.how });
      if (exhOf(r)) out.push({ space, field: "exhUnits", how: "1 unit set at Revit import (fixture count is not in the Revit export)" });
      const a = autoRts(r);
      if (rtsPick[r.uid] === undefined && a.id) out.push({ space, field: "rts", how: a.how });
    }
    return out;
  };

  const otherIds = mode === "ahu" && file ? file.ahus.flatMap((a) => a.spaces.map((s) => s.id)) : [];
  const clash = ahuRooms.map((r) => spaceId(prefix, r.number)).filter((id) => otherIds.includes(id));
  const tagClash = mode === "ahu" && !!file?.ahus.some((a) => a.id === tag);

  const preview = useMemo(() => {
    if (!level || tadjVal === null) return null;
    try {
      return importRevit(exp, { level: levelId, prefix, classes: fullClasses, types: idMap, tadj: tadjVal, tadjNote, room: makeRoom, existingIds: otherIds });
    } catch (e) {
      return { error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp, levelId, prefix, fullClasses, idMap, tadjVal, tadjNote, mode, file, catPick, exhPick, rtsPick, weight, carpet, libs, spaceLib]);

  const problem = !ahuRooms.length
    ? "Mark at least one room “On this AHU”."
    : !tag.trim()
      ? "Enter the AHU tag."
      : tagClash
        ? `${tag} is already in this project.`
        : clash.length
          ? `Space IDs already used on another AHU: ${clash.join(", ")}. Change the prefix.`
          : tadjVal === null
            ? "Enter the adjacent temperature for unconditioned rooms."
            : mode === "new" && !canNew
              ? "A new project needs the new-project defaults in the library file (load libraries, rebuilt with npm run build:libraries)."
              : mode === "ahu" && (!file || !ahu)
                ? "Open a project first, or make a new project."
                : preview && "error" in preview
                  ? preview.error
                  : null;

  const doImport = () => {
    if (problem || !preview || "error" in preview) return;
    let f: ProjectFile;
    if (mode === "new") f = newProjectFile(defaults!, projName || null, tag);
    else {
      f = structuredClone(file!);
      f.ahus.push(newAhu(tag, ahu!));
    }
    const i = f.ahus.length - 1;
    f.ahus[i]!.spaces = preview.spaces;
    f.ahus[i]!.surfaces = preview.surfaces;
    // New project rows made from Revit U / SHGC, only those a surface uses
    const used = new Set(preview.surfaces.map((s) => s.con));
    f.constructions = [...f.constructions, ...resolved.newConstructions.filter((c) => used.has(c.id))];
    // Catalogue schedules the rooms now use
    if (spaceLib) {
      const ids = new Set(preview.spaces.flatMap((s) => [s.occSch, s.ltgSch, s.eqpSch]));
      addSchedules(f.schedules, spaceLib.schedules.filter((s) => ids.has(s.id)));
    }
    f.glazing = [...f.glazing, ...resolved.newGlazing.filter((g) => used.has(g.id))];
    // Constructions matched by Revit U are ASSUMED until edited or kept
    const auto = autoList();
    for (const s of preview.surfaces) {
      const c = resolved.choice[preview.surfaceTypes[s.id] ?? ""];
      if (c?.src === "revit-u" && s.con) auto.push({ space: s.space, surface: s.id, field: "con", how: c.how });
    }
    if (auto.length) f.ahus[i]!.autoMatched = auto;
    // Remember what was typed here, for the next import (this browser and this project file)
    const typed = Object.fromEntries(Object.entries(types).filter(([, v]) => v.trim()));
    f.revitTypeMap = { ...(f.revitTypeMap ?? {}), ...typed };
    storeMap({ ...recallMap(), ...typed });
    f.plan ??= { levels: [] };
    const old = f.plan.levels.findIndex((l) => l.id === preview.level.id);
    if (old >= 0) f.plan.levels[old] = { ...preview.level, rotation: f.plan.levels[old]!.rotation };
    else f.plan.levels.push(preview.level);
    const assumed = preview.surfaces.filter((s) => /ASSUMED/.test(s.notes ?? "")).length;
    onDone(
      f,
      i,
      mode === "new",
      `Imported ${preview.spaces.length} rooms and ${preview.surfaces.length} surfaces from ${fileName} into ${tag}. Room heights and the ${auto.length} values filled automatically (62.1 category, exhaust, RTS series) are listed ASSUMED until you edit them or click Keep${assumed ? `, plus ${assumed} surface note(s)` : ""}. Check each room's people and loads (copied or from the 62.1 category defaults, see the room note), then check north.`,
    );
  };

  const set = (uid: string, c: RoomClass) => setClasses((x) => ({ ...x, [uid]: c }));
  const typeOptions = (k: TypeKind) =>
    k === "window" ? [...options.glazing, ...resolved.newGlazing.map((g) => g.id)] : [...options.constructions, ...resolved.newConstructions.map((c) => c.id)];
  const counts = preview && !("error" in preview) ? preview : null;

  return (
    <section className="revit-import" data-testid="revit-import">
      <div className="panel">
        <h2>Import from Revit</h2>
        <p className="muted small">
          {fileName} · {exp.model.host}
          {exp.model.roomsFrom ? `, rooms from ${exp.model.roomsFrom}` : ""} · exported {exp.exported} · {exp.exporter}
        </p>
        <p className="small">
          Walls are room boundary length × room height. Wall areas, windows and doors become ordinary rows you can edit afterwards. Nothing is linked back to Revit.
        </p>
        <div className="grid">
          <div className="field">
            <label htmlFor="ri-mode">Import into</label>
            <select id="ri-mode" data-testid="ri-mode" value={mode} onChange={(e) => setMode(e.target.value as "new" | "ahu")}>
              <option value="new" disabled={!canNew}>
                A new project
              </option>
              <option value="ahu" disabled={!file}>
                A new AHU in {file?.name ?? "this project"}
              </option>
            </select>
          </div>
          {mode === "new" && (
            <div className="field">
              <label htmlFor="ri-name">Project name</label>
              <input id="ri-name" value={projName} onChange={(e) => setProjName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="ri-tag">AHU tag</label>
            <input id="ri-tag" data-testid="ri-tag" value={tag} onChange={(e) => setTag(e.target.value.trim())} />
          </div>
          <div className="field">
            <label htmlFor="ri-level">Level</label>
            <select
              id="ri-level"
              value={levelId}
              onChange={(e) => {
                setLevelId(e.target.value);
                setPrefix(defaultPrefix(exp.levels.find((l) => l.id === e.target.value)?.name ?? ""));
              }}
            >
              {exp.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({exp.rooms.filter((r) => r.level === l.id).length} rooms)
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ri-prefix">Space ID prefix</label>
            <input id="ri-prefix" data-testid="ri-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.trim())} />
            <div className="hint">Room 14 → {spaceId(prefix, "14")}</div>
          </div>
          <div className="field">
            <label htmlFor="ri-tadj">Tadj, unconditioned rooms</label>
            <div className="with-unit">
              <input
                id="ri-tadj"
                data-testid="ri-tadj"
                inputMode="decimal"
                value={tadjVal ?? ""}
                onChange={(e) => setTadj(e.target.value.trim() === "" || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value))}
              />
              <span className="unit">°F</span>
            </div>
            <div className="hint">{dDb && tadj === null ? `Outdoor design DB, ${dDb.pct}, ${MONTH[dDb.month - 1]} (highest month)` : dDb ? `Design DB is ${dDb.db} °F` : "Load libraries to fill this from the climate."}</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Rooms on {level?.name}</h3>
        <p className="muted small">
          Mark the rooms this AHU serves. Walls to conditioned rooms give no gain; walls to unconditioned rooms are partitions at Tadj (pilot rules). The 62.1 category and exhaust are
          matched from the room name where the name is clear (“auto”); change any of them here or later in the room panel. Matched values stay in the ASSUMED list until you edit or keep
          them. A blank category is an input error until entered.
        </p>
        <div className="grid">
          <div className="field">
            <label htmlFor="ri-weight">RTS construction weight</label>
            <select id="ri-weight" data-testid="ri-weight" value={weight} onChange={(e) => setWeight(e.target.value as Weight)}>
              {(Object.keys(WEIGHT_LABEL) as Weight[]).map((w) => (
                <option key={w} value={w}>
                  {WEIGHT_LABEL[w]}
                </option>
              ))}
            </select>
            <div className="hint">{weightPick ? "Your choice" : `Default: ${inUse.src}`}</div>
          </div>
          <div className="field">
            <label htmlFor="ri-carpet">Carpet, when Floor Finish doesn’t say</label>
            <select id="ri-carpet" data-testid="ri-carpet" value={carpet} onChange={(e) => setCarpet(e.target.value as Carpet)}>
              <option value="N">No carpet</option>
              <option value="C">Carpet</option>
            </select>
            <div className="hint">{carpetPick ? "Your choice" : `Default: ${inUse.src}`}</div>
          </div>
        </div>
        <p className="muted small">
          RTS series per room: exterior rooms take the glass column nearest to their window area ÷ exterior wall area (10 / 50 / 90%), interior rooms the interior series. Hover a
          series to see why.
        </p>
        <datalist id="ri-list-cat">
          {options.ventCat.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="ri-list-exh">
          {options.exhType.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="ri-list-rts">
          {options.rts.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <div className="table-wrap">
          <table className="results compact">
            <thead>
              <tr>
                <th className="text">Number</th>
                <th className="text">Name</th>
                <th>Area ft²</th>
                <th>Height ft</th>
                <th className="text">Treat as</th>
                <th className="text">Space ID</th>
                <th className="text">62.1 category</th>
                <th className="text">Exhaust (Table 6-2)</th>
                <th className="text">RTS</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.uid} data-testid={`ri-room-${r.number}`}>
                  <td className="text">{r.number}</td>
                  <td className="text">{r.name}</td>
                  <td>{r.area.toFixed(1)}</td>
                  <td>{r.height == null ? "—" : r.height.toFixed(2)}</td>
                  <td className="text">
                    <select aria-label={`Treat room ${r.number} as`} value={cls(r.uid)} onChange={(e) => set(r.uid, e.target.value as RoomClass)}>
                      {(Object.keys(CLASS_LABEL) as RoomClass[]).map((c) => (
                        <option key={c} value={c}>
                          {CLASS_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text">
                    {cls(r.uid) === "ahu" ? spaceId(prefix, r.number) : ""}
                    {cls(r.uid) === "ahu" && (
                      <div className="muted small" data-testid={`ri-loads-${r.number}`}>
                        loads: {sourceOf(r) ? `${sourceOf(r)!.s.id} (${sourceOf(r)!.why === "same room number" ? "same no." : "same category"})` : defaultsFill(r) ? "62.1 category defaults" : "template"}
                      </div>
                    )}
                  </td>
                  {cls(r.uid) === "ahu" ? (
                    <>
                      <td className="text">
                        <input
                          aria-label={`62.1 category for room ${r.number}`}
                          list="ri-list-cat"
                          value={effCat(r)}
                          className={effCat(r) ? undefined : "invalid"}
                          onChange={(e) => setCatPick((x) => ({ ...x, [r.uid]: e.target.value }))}
                        />
                        {catPick[r.uid] === undefined && match(r).ventCat && <span className="badge assumed">auto</span>}
                      </td>
                      <td className="text">
                        <input aria-label={`Exhaust for room ${r.number}`} list="ri-list-exh" value={exhOf(r)} onChange={(e) => setExhPick((x) => ({ ...x, [r.uid]: e.target.value }))} />
                        {exhPick[r.uid] === undefined && match(r).exhType && <span className="badge assumed">auto</span>}
                      </td>
                      <td className="text" title={rtsPick[r.uid] === undefined ? autoRts(r).how : "Entered here"}>
                        <input
                          aria-label={`RTS series for room ${r.number}`}
                          data-testid={`ri-rts-${r.number}`}
                          list="ri-list-rts"
                          size={12}
                          value={rtsOf(r)}
                          className={rtsOf(r) ? undefined : "invalid"}
                          onChange={(e) => setRtsPick((x) => ({ ...x, [r.uid]: e.target.value }))}
                        />
                        {rtsPick[r.uid] === undefined && autoRts(r).id && <span className="badge assumed">auto</span>}
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} />
                  )}
                </tr>
              ))}
              <tr>
                <td className="text" colSpan={4}>
                  Walls with no room beyond them (not exterior), e.g. an open alcove
                </td>
                <td className="text">
                  <select aria-label="Treat walls with no room beyond as" data-testid="ri-noroom" value={classes[NO_ROOM] ?? "unconditioned"} onChange={(e) => set(NO_ROOM, e.target.value as RoomClass)}>
                    <option value="unconditioned">Unconditioned (Tadj), ASSUMED</option>
                    <option value="conditioned">Conditioned, no gain</option>
                  </select>
                </td>
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Revit types → constructions and glazing</h3>
        <p className="muted small">
          Only the types on this AHU's rooms. Each ID comes from what you type here, else your map from earlier imports, else the Revit type's own U / SHGC: walls and roofs take the
          library row with the nearest U (ASSUMED until you edit or keep it); partitions, doors and windows get a project row with Revit's values (marked ASSUMED). What you type here
          is remembered for the next import. A blank ID shows as an input error on the room until entered.
        </p>
        {need.length === 0 ? (
          <p className="muted">Mark rooms on this AHU first.</p>
        ) : (
          <div className="table-wrap">
            <table className="results compact">
              <thead>
                <tr>
                  <th className="text">Used as</th>
                  <th className="text">Revit type</th>
                  <th>Revit U</th>
                  <th className="text">Construction / glazing ID</th>
                  <th className="text">From</th>
                </tr>
              </thead>
              <tbody>
                {need.map((t) => {
                  const c = resolved.choice[t.key];
                  const rt = (exp.types ?? []).find((x) => x.cat === (t.kind === "partition" ? "wall" : t.kind) && x.name === t.name);
                  return (
                    <tr key={t.key} data-testid={`ri-type-${t.key}`}>
                      <td className="text">{KIND_LABEL[t.kind]}</td>
                      <td className="text">{t.name}</td>
                      <td>{rt?.u != null ? `${rt.u}${rt.shgc != null ? ` · SHGC ${rt.shgc}` : ""}` : "—"}</td>
                      <td className="text">
                        <input
                          aria-label={`ID for ${t.name}`}
                          list={`ri-list-${t.kind === "window" ? "g" : "c"}`}
                          value={idMap[t.key] ?? ""}
                          className={idMap[t.key] ? undefined : "invalid"}
                          onChange={(e) => setTypes((x) => ({ ...x, [t.key]: e.target.value }))}
                        />
                      </td>
                      <td className="text small" data-testid={`ri-src-${t.key}`}>
                        {c && c.src !== "none" && <span className={c.src === "revit-u" || c.src === "new-row" ? "badge assumed" : "badge"}>{SRC_LABEL[c.src]}</span>} <span className="muted">{c?.how}</span>
                        {t.key in types && (
                          <>
                            {" "}
                            <button className="link" onClick={() => setTypes((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== t.key)))}>
                              Undo
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <datalist id="ri-list-c">
          {typeOptions("wall").map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="ri-list-g">
          {typeOptions("window").map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </div>

      <div className="panel">
        {counts && (
          <p data-testid="ri-summary">
            {counts.spaces.length} rooms, {counts.surfaces.filter((s) => s.type === "Wall").length} walls, {counts.surfaces.filter((s) => s.type === "Window").length} window rows,{" "}
            {counts.surfaces.filter((s) => s.type === "Door").length} doors, {counts.surfaces.filter((s) => s.type === "Partition").length} partitions.
          </p>
        )}
        {counts?.warnings.map((w, i) => (
          <div key={i} className="notice assumed">
            {w}
          </div>
        ))}
        {problem && <div className="notice error">{problem}</div>}
        <div className="row-actions">
          <button className="primary" disabled={!!problem} onClick={doImport} data-testid="ri-import">
            Import
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </section>
  );
}
