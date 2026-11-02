// App shell: project file and library file loading, AHU picker, the three steps, ASSUMED / errors list,
// room panel. All state lives in this browser; nothing is sent anywhere.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSpace } from "../engine/project";
import { librariesFromBundle, parseLibraryBundle, type LibraryBundle } from "../model/libraryBundle";
import { defaultItems, firstRoom, keepDefault, newProjectFile, pruneDefaults, type DefaultItem } from "../model/newProject";
import { newAhu, parseProjectFile, toProjectInput, type AhuEntry, type ProjectFile } from "../model/projectFile";
import { num } from "./fmt";
import type { IdKind } from "../model/idInfo";
import { LibraryBrowser } from "./LibraryBrowser";
import { buildOptions } from "./options";
import { PlanTab } from "./PlanTab";
import { RevitImport } from "./RevitImport";
import { parseRevitExport, type RevitExport } from "../model/revitImport";
import { addSchedules, spaceDefaultsFor } from "../model/spaceDefaults";
import { ProjectTab } from "./ProjectTab";
import { RoomPanel } from "./RoomPanel";
import { SidePanel } from "./SidePanel";
import { Step1, Step2, Step3 } from "./Steps";
import { useRunner } from "./useRunner";

type Tab = "inputs" | "plan" | "1" | "2" | "3";
const TABS: { id: Tab; label: string }[] = [
  { id: "inputs", label: "Project and inputs" },
  { id: "plan", label: "Plan and north" },
  { id: "1", label: "1  Outdoor air" },
  { id: "2", label: "2  Cooling loads" },
  { id: "3", label: "3  Airflows" },
];

const LS_LIBS = "rts-airflow.libraries";
const LS_DRAFT = "rts-airflow.draft";

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked: the app still works, it just won't remember */
  }
}
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface Draft {
  file: ProjectFile;
  fileName: string;
  dirty: boolean;
  ahuIndex: number;
}

export function App() {
  const [bundle, setBundle] = useState<LibraryBundle | null>(null);
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [fileName, setFileName] = useState("project.json");
  const [dirty, setDirty] = useState(false);
  const [ahuIndex, setAhuIndex] = useState(0);
  const [tab, setTab] = useState<Tab>("1");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const openRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const revitRef = useRef<HTMLInputElement>(null);
  const [revit, setRevit] = useState<{ exp: RevitExport; name: string } | null>(null);
  const [browse, setBrowse] = useState<{ kind?: IdKind; q?: string } | null>(null);
  // Opens the library browser; with no kind it keeps showing the kind it was last on.
  const openBrowser = (kind?: IdKind, q?: string) => setBrowse((b) => ({ kind: kind ?? b?.kind, q }));

  // Restore the library file and any unsaved work kept in this browser
  useEffect(() => {
    const l = recall(LS_LIBS);
    if (l) {
      try {
        setBundle(parseLibraryBundle(l));
      } catch {
        store(LS_LIBS, null);
      }
    }
    const d = recall(LS_DRAFT);
    if (d) {
      try {
        const draft = JSON.parse(d) as Draft;
        setFile(parseProjectFile(JSON.stringify(draft.file)));
        setFileName(draft.fileName);
        setDirty(draft.dirty);
        setAhuIndex(Math.min(draft.ahuIndex, draft.file.ahus.length - 1));
        if (draft.dirty) setNotice({ kind: "info", text: "Restored your unsaved changes from this browser. Save to keep them in a file." });
      } catch {
        store(LS_DRAFT, null);
      }
    }
  }, []);

  useEffect(() => {
    if (file) store(LS_DRAFT, JSON.stringify({ file, fileName, dirty, ahuIndex } satisfies Draft));
  }, [file, fileName, dirty, ahuIndex]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const libs = useMemo(() => (bundle ? librariesFromBundle(bundle) : null), [bundle]);
  const options = useMemo(() => buildOptions(libs, file), [libs, file]);
  const ahu = file?.ahus[ahuIndex] ?? null;
  const project = useMemo(() => (file && ahu ? toProjectInput(file, ahuIndex) : null), [file, ahu, ahuIndex]);
  const run = useRunner(libs, project);
  // A result belongs to the inputs on screen only if it has the same rooms (else it is from another AHU)
  const result =
    run.result && project && run.result.rooms.length === project.spaces.length && run.result.rooms.every((r, i) => r.id === project.spaces[i]!.id) ? run.result : null;

  // ---- edits
  const editFile = (fn: (f: ProjectFile) => void) => {
    setFile((f) => {
      if (!f) return f;
      const c = structuredClone(f);
      fn(c);
      pruneDefaults(f, c); // an edited template default is no longer ASSUMED
      return c;
    });
    setDirty(true);
  };
  const editAhu = (fn: (a: AhuEntry) => void) => editFile((f) => fn(f.ahus[ahuIndex]!));

  const renameRoom = (oldId: string, newId: string) => {
    if (!ahu || newId === oldId || ahu.spaces.some((s) => s.id === newId)) return;
    editAhu((a) => {
      a.spaces.find((s) => s.id === oldId)!.id = newId;
      a.surfaces.forEach((s) => {
        if (s.space === oldId) s.space = newId;
      });
      a.autoMatched?.forEach((m) => {
        if (m.space === oldId) m.space = newId;
      });
    });
    setRoomId(newId);
  };
  const deleteRoom = (id: string) => {
    editAhu((a) => {
      a.spaces = a.spaces.filter((s) => s.id !== id);
      a.surfaces = a.surfaces.filter((s) => s.space !== id);
    });
    setRoomId(null);
  };
  const addRoom = () => {
    if (!ahu) return;
    let n = ahu.spaces.length + 1;
    while (ahu.spaces.some((s) => s.id === `NEW-${n}`)) n++;
    const like = ahu.spaces[ahu.spaces.length - 1];
    const defaults = bundle?.newProject;
    // Copies the last room's load settings so the new room computes; ventilation and exhaust start blank.
    // With no room to copy: the template room's load fields (library file), marked ASSUMED in the notes.
    const s: ProjectSpace = like
      ? { ...structuredClone(like), id: `NEW-${n}`, name: "New room", people: null, exhType: null, exhCfm: null, exhUnits: null, xferTo: null, xferCfm: null, notes: null }
      : defaults
        ? firstRoom(defaults, `NEW-${n}`)
        : ({ id: `NEW-${n}`, name: "New room", area: 0, ventCat: "", people: null } as ProjectSpace);
    editAhu((a) => a.spaces.push(s));
    setRoomId(s.id);
  };

  // ---- files
  const readFile = (input: HTMLInputElement, then: (text: string, name: string) => void) => {
    const f = input.files?.[0];
    if (!f) return;
    f.text().then((t) => then(t, f.name));
    input.value = "";
  };

  const onOpenProject = (text: string, name: string) => {
    try {
      const f = parseProjectFile(text);
      if (dirty && !confirm("You have unsaved changes. Open another project and lose them?")) return;
      setFile(f);
      setFileName(name);
      setDirty(false);
      setAhuIndex(0);
      setRoomId(null);
      setNotice(null);
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  };
  const onLoadLibraries = (text: string) => {
    try {
      const b = parseLibraryBundle(text);
      setBundle(b);
      store(LS_LIBS, text);
      setNotice(null);
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  };
  const newProject = () => {
    const d = bundle?.newProject;
    if (!d) {
      return setNotice({
        kind: "error",
        text: bundle
          ? "This library file has no new-project defaults. Rebuild it with npm run build:libraries, then load it again."
          : "Load the library file first: the new-project defaults come from it.",
      });
    }
    if (dirty && !confirm("You have unsaved changes. Start a new project and lose them?")) return;
    const name = prompt("Project name:", "New project");
    if (name === null) return;
    const id = prompt("Tag for the first AHU:", "AHU-1");
    if (!id) return;
    setFile(newProjectFile(d, name || null, id));
    setFileName(`${(name || "project").replace(/[^\w.-]+/g, "_")}.json`);
    setDirty(true);
    setAhuIndex(0);
    setRoomId(null);
    setTab("inputs");
    setNotice({ kind: "info", text: `New project from the template defaults (${d.source}). Each default is listed ASSUMED until you edit it or click Keep.` });
  };
  const onRevitFile = (text: string, name: string) => {
    try {
      setRevit({ exp: parseRevitExport(text), name });
      setRoomId(null);
      setNotice(null);
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  };
  const onRevitDone = (f: ProjectFile, i: number, isNew: boolean, summary: string) => {
    if (isNew && dirty && !confirm("You have unsaved changes. Replace them with the imported project?")) return;
    setFile(f);
    if (isNew) setFileName(`${(f.name || "project").replace(/[^\w.-]+/g, "_")}.json`);
    setAhuIndex(i);
    setDirty(true);
    setRevit(null);
    setRoomId(null);
    setTab("plan");
    setNotice({ kind: "info", text: summary });
  };
  // Space-type defaults (62.1 people, 90.1-2022 LPD, DOE plug loads and schedules) for one room, on request
  const spaceLib = bundle?.spaceDefaults ?? null;
  const canFill = (id: string) => {
    const s = ahu?.spaces.find((x) => x.id === id);
    return !!(s && spaceLib && libs && spaceLib.rows.some((r) => r.category === s.ventCat));
  };
  const fillSpaceDefaults = (id: string) => {
    const s = ahu?.spaces.find((x) => x.id === id);
    if (!s || !spaceLib || !libs) return;
    const fill = spaceDefaultsFor(s.ventCat, s.area, spaceLib, libs);
    if (!fill) return;
    const list = Object.entries(fill.fields).map(([k, v]) => `${k} ${v}`).join(", ");
    if (!confirm(`Replace this room's ${Object.keys(fill.fields).join(", ")} with the “${s.ventCat}” defaults?\n\n${list}`)) return;
    editFile((f) => {
      const sp = f.ahus[ahuIndex]!.spaces.find((x) => x.id === id)!;
      Object.assign(sp, fill.fields);
      const keepNote = (sp.notes ?? "").replace(/ASSUMED: space-type defaults for “[^”]*”:.*?then edit this note\.\s*/s, "").trim();
      sp.notes = [fill.note, keepNote].filter(Boolean).join(" ");
      addSchedules(f.schedules, fill.schedules);
    });
  };
  const keep = (item: DefaultItem) => editFile((f) => keepDefault(f, ahuIndex, item));

  const save = () => {
    if (!file) return;
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.endsWith(".json") ? fileName : `${fileName}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDirty(false);
  };

  const addAhu = () => {
    if (!file || !ahu) return;
    const id = prompt("Tag for the new AHU (it copies this AHU's settings, with no rooms):", "AHU-2");
    if (!id) return;
    if (file.ahus.some((a) => a.id === id)) return setNotice({ kind: "error", text: `${id} is already in this project.` });
    editFile((f) => f.ahus.push(newAhu(id, ahu)));
    setAhuIndex(file.ahus.length);
    setRoomId(null);
    setTab("inputs");
  };
  const deleteAhu = () => {
    if (!file || !ahu || file.ahus.length < 2) return;
    if (!confirm(`Delete ${ahu.id} with its ${ahu.spaces.length} rooms and ${ahu.surfaces.length} surfaces?`)) return;
    editFile((f) => f.ahus.splice(ahuIndex, 1));
    setAhuIndex(0);
    setRoomId(null);
  };

  const openRoom = (id: string) => setRoomId(id);
  const step = tab === "1" || tab === "2" || tab === "3";
  const roomName = (id: string) => ahu?.spaces.find((s) => s.id === id)?.name ?? id;

  // ---- render
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <b>{file?.name ?? "Cooling loads and airflows"}</b>
          {file && (
            <span className="file-name">
              {fileName}
              {dirty && <span className="dirty"> · unsaved</span>}
            </span>
          )}
        </div>
        {file && ahu && (
          <div className="ahu-picker">
            <label htmlFor="ahu">AHU</label>
            <select id="ahu" data-testid="ahu-picker" value={ahuIndex} onChange={(e) => (setAhuIndex(Number(e.target.value)), setRoomId(null))}>
              {file.ahus.map((a, i) => (
                <option key={i} value={i}>
                  {a.id} ({a.spaces.length} rooms)
                </option>
              ))}
            </select>
            <button onClick={addAhu}>Add AHU</button>
            {file.ahus.length > 1 && (
              <button className="danger" onClick={deleteAhu}>
                Delete AHU
              </button>
            )}
          </div>
        )}
        <span className="spacer" />
        <span className={bundle ? "lib ok" : "lib missing"} data-testid="library-status" title={bundle ? `Built ${bundle.built} from ${bundle.source}` : undefined}>
          {bundle ? `Libraries loaded (${bundle.built})` : "Libraries missing"}
        </span>
        <button onClick={() => libRef.current?.click()}>{bundle ? "Reload libraries" : "Load libraries"}</button>
        <button onClick={() => openBrowser()} disabled={!bundle} data-testid="browse-libraries" title="What each construction, glazing, shade and RTS ID means">
          Browse libraries
        </button>
        <button onClick={newProject} data-testid="new-project">
          New project
        </button>
        <button onClick={() => openRef.current?.click()}>Open project</button>
        <button onClick={() => revitRef.current?.click()} data-testid="import-revit">
          Import from Revit
        </button>
        <button onClick={save} disabled={!file} className={dirty ? "primary" : undefined}>
          Save
        </button>
        <input ref={openRef} type="file" accept=".json,application/json" hidden data-testid="open-project" onChange={(e) => readFile(e.target, onOpenProject)} />
        <input ref={revitRef} type="file" accept=".json,application/json" hidden data-testid="revit-file" onChange={(e) => readFile(e.target, onRevitFile)} />
        <input ref={libRef} type="file" accept=".json,application/json" hidden data-testid="load-libraries" onChange={(e) => readFile(e.target, onLoadLibraries)} />
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
          <button className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {!bundle && (
        <div className="empty" data-testid="libraries-missing">
          <h2>Libraries missing</h2>
          <p>
            The ASHRAE tables (62.1, LCAM, Fundamentals) are copyrighted, so they are not part of this app. Load your library file, <code>rts-airflow-libraries.json</code>, from your own
            computer. This browser remembers it after that.
          </p>
          <p className="muted">
            Build it with <code>npx tsx tools/build_library_bundle.ts</code> in the project folder.
          </p>
          <button className="primary" onClick={() => libRef.current?.click()}>
            Load libraries
          </button>
        </div>
      )}

      {revit && (
        <RevitImport
          exp={revit.exp}
          fileName={revit.name}
          file={file}
          ahu={ahu}
          defaults={bundle?.newProject ?? null}
          spaceLib={bundle?.spaceDefaults ?? null}
          libs={libs}
          options={options}
          onCancel={() => setRevit(null)}
          onDone={onRevitDone}
          onBrowse={openBrowser}
        />
      )}

      {!file && !revit && (
        <div className="empty">
          <h2>Open or start a project</h2>
          <p>
            Open a project file (<code>.json</code>), or start a new one from the template defaults in your library file.
          </p>
          <div className="row-actions">
            <button className={bundle ? "primary" : undefined} onClick={() => openRef.current?.click()}>
              Open project
            </button>
            <button onClick={newProject} disabled={!bundle}>
              New project
            </button>
            <button onClick={() => revitRef.current?.click()} disabled={!bundle}>
              Import from Revit
            </button>
          </div>
        </div>
      )}

      {file && ahu && project && !revit && (
        <>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
                {t.label}
              </button>
            ))}
            <span className="spacer" />
            <span className="run-status" data-testid="run-status">
              {!bundle ? "" : run.running ? "Calculating 12 months…" : run.error ? "Calculation stopped" : result ? `Up to date · 12 months in ${num(run.ms ?? 0)} ms` : ""}
            </span>
          </nav>

          <div className="main">
            <div className={run.running && result ? "content stale" : "content"}>
              {run.error && (
                <div className="notice error" role="alert">
                  The calculation stopped: {run.error}
                </div>
              )}
              {tab === "inputs" && (
                <ProjectTab file={file} ahuIndex={ahuIndex} result={result} options={options} onFile={editFile} onAhu={editAhu} onRoom={openRoom} onAddRoom={addRoom} />
              )}
              {tab === "plan" && <PlanTab file={file} ahuIndex={ahuIndex} onFile={editFile} onRoom={openRoom} />}
              {step && !bundle && <p className="muted">Load the libraries to see results.</p>}
              {step && bundle && !result && !run.error && <p className="muted">Calculating 12 months…</p>}
              {step && project.spaces.length === 0 && <p className="muted">This AHU has no rooms yet. Add them on the Project and inputs tab.</p>}
              {tab === "1" && result && <Step1 project={project} result={result} onRoom={openRoom} />}
              {tab === "2" && result && <Step2 project={project} result={result} onRoom={openRoom} />}
              {tab === "3" && result && <Step3 project={project} result={result} onRoom={openRoom} />}
            </div>
            {result && <SidePanel result={result} defaults={defaultItems(file, ahuIndex)} onKeep={keep} roomName={roomName} onRoom={openRoom} onProject={(kind) => setTab(kind === "north" ? "plan" : "inputs")} />}
          </div>

          {roomId && <RoomPanel north={file.north.deg} ahu={ahu} roomId={roomId} result={result} options={options} onEdit={editAhu} onRename={renameRoom} onDelete={deleteRoom} onClose={() => setRoomId(null)} onSpaceDefaults={canFill(roomId) ? fillSpaceDefaults : null} onBrowse={openBrowser} />}
        </>
      )}

      {browse && bundle && <LibraryBrowser catalog={options.catalog} file={file} initial={browse} onClose={() => setBrowse(null)} />}
    </div>
  );
}
