// Room side panel: one room's 02_Spaces fields and its 03_Surfaces rows, editable.
import type { SurfaceType } from "../engine/conduction";
import type { ProjectResult, ProjectSpace } from "../engine/project";
import { trueAz } from "../model/plan";
import type { AhuEntry, FileSurface } from "../model/projectFile";
import { num } from "./fmt";
import type { Options } from "./options";
import { NumField, SelectField, TextField } from "./ui";

const SURFACE_TYPES: SurfaceType[] = ["Wall", "Roof", "Floor", "Partition", "Door", "Window"];

interface Props {
  north: number | null;
  ahu: AhuEntry;
  roomId: string;
  result: ProjectResult | null;
  options: Options;
  onEdit: (fn: (a: AhuEntry) => void) => void;
  onRename: (oldId: string, newId: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Fills people, LPD, EPD and schedules from the space-type defaults of the room's category (null = no row). */
  onSpaceDefaults?: ((id: string) => void) | null;
}

export function RoomPanel({ north, ahu, roomId, result, options, onEdit, onRename, onDelete, onClose, onSpaceDefaults }: Props) {
  const idx = ahu.spaces.findIndex((s) => s.id === roomId);
  const s = ahu.spaces[idx];
  if (!s) return null;
  const r = result?.rooms.find((x) => x.id === roomId);
  const assumed = result?.assumed.filter((x) => x.rooms.includes(roomId)) ?? [];
  const surfaces = ahu.surfaces.map((x, i) => ({ x, i })).filter(({ x }) => x.space === roomId);

  const set = <K extends keyof ProjectSpace>(k: K, v: ProjectSpace[K]) => onEdit((a) => void (a.spaces[idx]![k] = v));
  const setSrf = <K extends keyof FileSurface>(i: number, k: K, v: FileSurface[K]) => onEdit((a) => void (a.surfaces[i]![k] = v));
  const T = (k: keyof ProjectSpace & string, label: string, opts?: string[]) => (
    <TextField label={label} value={(s[k] as string | null) ?? null} options={opts} onChange={(v) => set(k, v as never)} testId={`space-${k}`} />
  );
  const N = (k: keyof ProjectSpace & string, label: string, unit?: string, allowBlank = true) => (
    <NumField label={label} unit={unit} allowBlank={allowBlank} value={(s[k] as number | null) ?? null} onChange={(v) => set(k, (v ?? (allowBlank ? null : 0)) as never)} testId={`space-${k}`} />
  );

  return (
    <aside className="room-panel" data-testid="room-panel" aria-label={`Room ${s.name}`}>
      <header>
        <div>
          <h2>{s.name}</h2>
          <span className="room-id">{s.id}</span>
        </div>
        <button onClick={onClose} aria-label="Close room panel">
          Close
        </button>
      </header>

      {r && (
        <div className="room-summary">
          <span>
            Supply <b>{num(r.air.supply)}</b> cfm
          </span>
          <span>Return {num(r.air.ret)}</span>
          <span>Voz {num(r.zone.Voz, 1)}</span>
          <span>Load cfm {num(r.loadCfm, 1)}</span>
          <span>Governed by {r.air.governedBy}</span>
        </div>
      )}
      {r && r.errors.length > 0 && (
        <div className="notice error">
          {r.errors.map((e, i) => (
            <div key={i}>{e.text}</div>
          ))}
        </div>
      )}
      {assumed.length > 0 && (
        <div className="notice assumed">
          <b>ASSUMED in this room</b>
          {assumed.map((x, i) => (
            <div key={i}>
              {x.ref}: {x.text}
            </div>
          ))}
        </div>
      )}

      <h3>Room</h3>
      <div className="grid">
        <TextField label="Space ID" value={s.id} onChange={(v) => v && onRename(s.id, v)} testId="space-id" />
        {T("name", "Name")}
        {N("area", "Area", "ft²", false)}
        {N("height", "Ceiling height", "ft")}
      </div>

      <h3>Ventilation (62.1)</h3>
      <div className="grid">
        <TextField label="62.1 category (Table 6-1)" value={s.ventCat} options={options.ventCat} onChange={(v) => set("ventCat", v ?? "")} wide testId="space-ventCat" />
        {N("people", "People (Pz)", undefined)}
        {T("ez", "Ez configuration (blank = AHU default)", options.ez)}
        {T("exhType", "Exhaust type (Table 6-2)", options.exhType)}
        {N("exhUnits", "Exhaust units")}
        {N("exhCfm", "Exhaust override", "cfm")}
        {T("xferTo", "Transfer to (Space IDs, comma list)")}
        {N("xferCfm", "Transfer override", "cfm")}
      </div>

      <h3>Internal loads and infiltration</h3>
      {onSpaceDefaults && (
        <p className="small">
          <button onClick={() => onSpaceDefaults(s.id)} data-testid="space-defaults">
            Fill from 62.1 category defaults
          </button>{" "}
          <span className="muted">People (62.1 Table 6-1), LPD (90.1-2022), EPD and schedules (DOE prototypes) for “{s.ventCat}”. Listed ASSUMED in the room note.</span>
        </p>
      )}
      <div className="grid">
        {T("activity", "People activity", options.activity)}
        {T("occSch", "People schedule", options.schedules)}
        {N("lpd", "Lighting power density", "W/ft²")}
        {T("ltgType", "Lighting type", options.ltgType)}
        {T("ltgSch", "Lighting schedule", options.schedules)}
        {N("epd", "Equipment power density", "W/ft²")}
        {T("eqpClass", "Equipment class", options.eqpClass)}
        {T("eqpSch", "Equipment schedule", options.schedules)}
        {T("rts", "RTS series", options.rts)}
        <SelectField label="Return plenum" value={s.plenum === "Y" ? "Y" : "N"} options={["Y", "N"]} onChange={(v) => set("plenum", v === "Y" ? "Y" : null)} />
        {N("ach", "Infiltration", "ACH")}
        {N("infCfm", "Infiltration override", "cfm")}
      </div>
      <TextField label="Notes (write ASSUMED to list an assumption)" value={s.notes ?? null} onChange={(v) => set("notes", v)} wide />

      <h3>Surfaces ({surfaces.length})</h3>
      <div className="table-wrap">
        <table className="edit">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Construction / glazing</th>
              <th title="Model azimuth of the outward normal, ° clockwise from model +Y">Faces (model) °</th>
              <th title="True azimuth = model − north. Typed only for walls with no model azimuth.">Faces (true) °</th>
              <th>Tilt °</th>
              <th>Area ft²</th>
              <th>W ft</th>
              <th>H ft</th>
              <th>Qty</th>
              <th>Host wall</th>
              <th>OH depth</th>
              <th>OH gap</th>
              <th>Shade</th>
              <th>Tadj °F</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {surfaces.map(({ x, i }) => {
              const win = x.type === "Window";
              const cell = (k: "az" | "tilt" | "area" | "w" | "h" | "qty" | "ohDepth" | "ohGap" | "tadj") => (
                <td>
                  <CellNum value={x[k]} onChange={(v) => setSrf(i, k, v)} />
                </td>
              );
              return (
                <tr key={i} className={x.notes && /ASSUMED/.test(x.notes) ? "assumed-row" : undefined}>
                  <td>
                    <input className="cell" value={x.id} onChange={(e) => setSrf(i, "id", e.target.value)} />
                  </td>
                  <td>
                    <select className="cell" value={x.type} onChange={(e) => setSrf(i, "type", e.target.value as SurfaceType)}>
                      {SURFACE_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="cell wide" list={win ? "opt-glazing" : "opt-con"} value={x.con} onChange={(e) => setSrf(i, "con", e.target.value)} />
                  </td>
                  <td>
                    <CellNum value={x.modelAz ?? null} onChange={(v) => setSrf(i, "modelAz", v)} />
                  </td>
                  {x.modelAz != null ? (
                    <td className="derived" data-testid={`true-az-${x.id}`} title="model − north">
                      {trueAz(x.modelAz, north)}
                    </td>
                  ) : (
                    cell("az")
                  )}
                  {cell("tilt")}
                  {cell("area")}
                  {cell("w")}
                  {cell("h")}
                  {cell("qty")}
                  <td>
                    <input className="cell" list="opt-hosts" value={x.host ?? ""} onChange={(e) => setSrf(i, "host", e.target.value || null)} />
                  </td>
                  {cell("ohDepth")}
                  {cell("ohGap")}
                  <td>
                    <input className="cell" list="opt-shades" value={x.shade ?? ""} onChange={(e) => setSrf(i, "shade", e.target.value || null)} />
                  </td>
                  {cell("tadj")}
                  <td>
                    <input className="cell wide" value={x.notes ?? ""} title={x.notes ?? ""} onChange={(e) => setSrf(i, "notes", e.target.value || null)} />
                  </td>
                  <td>
                    <button
                      className="icon"
                      aria-label={`Delete surface ${x.id}`}
                      onClick={() => {
                        if (confirm(`Delete surface ${x.id}?`)) onEdit((a) => void a.surfaces.splice(i, 1));
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="opt-con">
          {options.constructions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="opt-glazing">
          {options.glazing.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="opt-shades">
          {options.shades.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="opt-hosts">
          {ahu.surfaces
            .filter((x) => x.space === roomId && x.type !== "Window")
            .map((x) => (
              <option key={x.id} value={x.id} />
            ))}
        </datalist>
      </div>
      <div className="row-actions">
        <button
          onClick={() =>
            onEdit((a) => {
              const n = a.surfaces.filter((x) => x.space === roomId).length + 1;
              a.surfaces.push({ id: `${roomId}-S${n}`, space: roomId, type: "Wall", con: "", az: null, tilt: 90, area: null, w: null, h: null, qty: null, host: null, ohDepth: null, ohGap: null, shade: null, tadj: null, notes: null });
            })
          }
        >
          Add surface
        </button>
        <span className="spacer" />
        <button className="danger" onClick={() => confirm(`Delete room ${s.name} (${s.id}) and its ${surfaces.length} surfaces?`) && onDelete(s.id)}>
          Delete room
        </button>
      </div>
    </aside>
  );
}

function CellNum({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      className="cell num"
      inputMode="decimal"
      defaultValue={value ?? ""}
      key={value ?? "blank"}
      onBlur={(e) => {
        const t = e.target.value.trim();
        if (t === "") return value !== null && onChange(null);
        const v = Number(t);
        if (Number.isFinite(v) && v !== value) onChange(v);
        else if (!Number.isFinite(v)) e.target.value = value === null ? "" : String(value);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
