// Library browser: every construction, glazing, interior shade and RTS ID with what it is, its numbers and its
// source, searchable, and where this project uses it. Read-only; the rows come from the loaded library file and
// the project's own rows (src/model/idInfo.ts).
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { short, usage, usageText, type Catalog, type IdInfo, type IdKind } from "../model/idInfo";
import type { ProjectFile } from "../model/projectFile";
import { IdBadges } from "./IdDetail";

const KINDS: { id: IdKind; label: string }[] = [
  { id: "construction", label: "Walls, roofs, doors" },
  { id: "glazing", label: "Glazing" },
  { id: "shade", label: "Interior shades" },
  { id: "rts", label: "RTS series" },
];

const INTRO: Record<IdKind, string> = {
  construction:
    "Used in the Construction column of Wall, Roof, Door, Partition and Floor rows. U in Btu/h·ft²·°F; α = solar absorptance of the outer surface; hₒ = outside film coefficient. The CTS is the share of the conducted heat that reaches the room each hour after it arrives at the outside; \"half by hour\" is where that share first passes 50% (a quick measure of how heavy the construction is, derived from the CTS).",
  glazing:
    "Project rows only: glazing is entered per project (NFRC whole-unit U and SHGC), so the library file has none. The \"Table 3.8 type\" column picks the angle-correction row (listed below the table).",
  shade: "Interior shading devices. IAC = interior attenuation coefficient at 0° and 60° profile angle and for diffuse light; FR = fraction of the absorbed heat that is radiant.",
  rts: "Radiant time series used by the room's RTS field. The code reads: weight (L light, M medium, H heavy), C = with carpet or N = no carpet, then the % of glass on the exterior wall (10, 50, 90). INT = interior zone (no solar RTS).",
};

interface Props {
  catalog: Catalog;
  file: ProjectFile | null;
  initial?: { kind?: IdKind; q?: string };
  onClose: () => void;
}

export function LibraryBrowser({ catalog, file, initial, onClose }: Props) {
  const [kind, setKind] = useState<IdKind>(initial?.kind ?? "construction");
  const [q, setQ] = useState(initial?.q ?? "");
  const [type, setType] = useState("");
  const [validation, setValidation] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const use = useMemo(() => usage(file), [file]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    if (initial?.kind) setKind(initial.kind);
    if (initial?.q !== undefined) setQ(initial.q);
  }, [initial]);

  const all = catalog[kind];
  const types = useMemo(() => [...new Set(all.map((i) => i.type).filter((t): t is string => !!t))], [all]);
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (i) =>
      (validation || i.origin !== "validation") &&
      (!type || i.type === type) &&
      (!needle || [i.id, i.description, i.type, i.source].some((s) => s?.toLowerCase().includes(needle))),
  );
  const hiddenValidation = all.filter((i) => i.origin === "validation").length;
  const used = (i: IdInfo) => usageText(use[kind].get(i.id.toLowerCase()));

  const head: Record<IdKind, string[]> = {
    construction: ["ID", "Type", "Description", "U", "α", "hₒ", "CTS half by hour", "Used in"],
    glazing: ["ID", "Description", "U", "SHGC", "Table 3.8 type", "Used in"],
    shade: ["ID", "Description", "IAC 0°", "IAC 60°", "IAC diffuse", "FR", "Used in"],
    rts: ["ID", "Description", "Type", "Used in"],
  };
  const cells = (i: IdInfo): ReactNode[] => {
    const n = (k: string) => (i.v[k] == null ? "—" : short(i.v[k]!));
    const idCell = (
      <span>
        <b>{i.id}</b> <IdBadges info={i} />
      </span>
    );
    switch (kind) {
      case "construction":
        return [idCell, i.type ?? "—", i.description ?? "—", n("u"), n("alpha"), n("ho"), n("lag"), used(i)];
      case "glazing":
        return [idCell, i.description ?? "—", n("u"), n("shgc"), i.type ?? "—", used(i)];
      case "shade":
        return [idCell, i.description ?? "—", n("iac0"), n("iac60"), n("iacd"), n("fr"), used(i)];
      case "rts":
        return [idCell, i.description ?? "—", i.type ?? "—", used(i)];
    }
  };
  const numCols = new Set(kind === "construction" ? [3, 4, 5, 6] : kind === "glazing" ? [2, 3] : kind === "shade" ? [2, 3, 4, 5] : []);

  return (
    <aside className="lib-browser" role="dialog" aria-label="Library browser" data-testid="library-browser">
      <header>
        <div>
          <h2>Libraries</h2>
          <div className="muted small">What each ID means. Read-only: rows come from your library file and this project.</div>
        </div>
        <button onClick={onClose}>Close</button>
      </header>

      <div className="lib-tabs" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.id}
            role="tab"
            aria-selected={kind === k.id}
            className={kind === k.id ? "tab active" : "tab"}
            onClick={() => (setKind(k.id), setType(""), setOpen(null))}
            data-testid={`lib-tab-${k.id}`}
          >
            {k.label} ({catalog[k.id].filter((i) => i.origin !== "validation").length})
          </button>
        ))}
      </div>

      <p className="small">{INTRO[kind]}</p>

      <div className="lib-filters">
        <input type="search" placeholder="Search ID, description, source…" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} data-testid="lib-search" />
        {types.length > 1 && (
          <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
        {hiddenValidation > 0 && (
          <label className="small">
            <input type="checkbox" checked={validation} onChange={(e) => setValidation(e.target.checked)} /> include the {hiddenValidation} LCAM Ch. 8 test row{hiddenValidation > 1 ? "s" : ""}
          </label>
        )}
        <span className="muted small">{rows.length} shown</span>
      </div>

      {all.length === 0 ? (
        <p className="muted">{kind === "glazing" ? "This project has no glazing rows yet." : "Nothing loaded."}</p>
      ) : (
        <div className="table-wrap">
          <table className="results compact lib-table" data-testid="lib-table">
            <thead>
              <tr>
                {head[kind].map((h, c) => (
                  <th key={h} className={numCols.has(c) ? undefined : "text"}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <Fragment key={`${i.origin}:${i.id}`}>
                  <tr className={open === i.id ? "open" : undefined} onClick={() => setOpen(open === i.id ? null : i.id)} data-testid={`lib-row-${i.id}`}>
                    {cells(i).map((c, ci) => (
                      <td key={ci} className={numCols.has(ci) ? undefined : "text"}>
                        {c}
                      </td>
                    ))}
                  </tr>
                  {open === i.id && (
                    <tr className="lib-detail">
                      <td colSpan={head[kind].length} className="text">
                        <div>
                          <b>Source:</b> {i.source ?? "none recorded"}
                        </div>
                        {i.cts && (
                          <div className="cts">
                            <svg viewBox="0 0 240 44" width="240" height="44" role="img" aria-label="CTS by hour">
                              {i.cts.map((x, h) => {
                                const max = Math.max(...i.cts!, 1e-9);
                                const bar = (x / max) * 38;
                                return <rect key={h} x={h * 10 + 1} y={42 - bar} width={8} height={bar} fill="var(--accent)" />;
                              })}
                            </svg>
                            <span className="muted small">CTS, hour 0 to 23 after the heat reaches the outside (peak {short(Math.max(...i.cts))})</span>
                          </div>
                        )}
                        {kind === "rts" && <div className="muted small">Weight, carpet and glass share are in the code: see the note above the table.</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="text muted" colSpan={head[kind].length}>
                    {!validation && !needle && !type && hiddenValidation > 0
                      ? `Only the ${hiddenValidation} LCAM Ch. 8 test row${hiddenValidation > 1 ? "s are" : " is"} here. Tick “include” above to see ${hiddenValidation > 1 ? "them" : "it"}.`
                      : "No match."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {kind === "glazing" && catalog.acf.length > 0 && (
        <details className="acf">
          <summary>Table 3.8 glazing types ({catalog.acf.length})</summary>
          <table className="results compact">
            <thead>
              <tr>
                <th className="text">Type</th>
                <th className="text">Description</th>
                <th>Layers</th>
                <th>Tv</th>
                <th>SHGC (reference)</th>
              </tr>
            </thead>
            <tbody>
              {catalog.acf.map((a) => (
                <tr key={a.typeId}>
                  <td className="text">
                    <b>{a.typeId}</b>
                  </td>
                  <td className="text">{a.description ?? "—"}</td>
                  <td>{a.layers ?? "—"}</td>
                  <td>{a.tv ?? "—"}</td>
                  <td>{a.shgcRef ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </aside>
  );
}
