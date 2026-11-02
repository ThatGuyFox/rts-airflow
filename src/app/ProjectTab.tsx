// "Project and inputs": project-wide settings (stored once in the file), this AHU's settings, and its rooms.
import type { ProjectResult } from "../engine/project";
import type { AhuEntry, ProjectFile } from "../model/projectFile";
import { MONTHS, num } from "./fmt";
import type { Options } from "./options";
import { NumField, SelectField, TextField, WorkbookChoice } from "./ui";

interface Props {
  file: ProjectFile;
  ahuIndex: number;
  result: ProjectResult | null;
  options: Options;
  onFile: (fn: (f: ProjectFile) => void) => void;
  onAhu: (fn: (a: AhuEntry) => void) => void;
  onRoom: (id: string) => void;
  onAddRoom: () => void;
}

export function ProjectTab({ file, ahuIndex, result, options, onFile, onAhu, onRoom, onAddRoom }: Props) {
  const a = file.ahus[ahuIndex]!;
  const c = file.climate;
  return (
    <section className="project-tab">
      <div className="panel">
        <h2>Project</h2>
        <p className="muted">Stored once for every AHU in this file.</p>
        <div className="grid">
          <TextField label="Project name" value={file.name} onChange={(v) => onFile((f) => void (f.name = v))} wide />
        </div>
        <h3>Climate and design day</h3>
        <div className="grid">
          <SelectField label="Climate" value={c.climSrc} options={["Nassau", "Override"]} onChange={(v) => onFile((f) => void (f.climate.climSrc = v))} />
          <SelectField label="Design percentile" value={c.designPct} options={options.designPct.length ? options.designPct : [c.designPct]} onChange={(v) => onFile((f) => void (f.climate.designPct = v))} />
          <SelectField
            label="Design month"
            value={c.designMonth}
            options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
            onChange={(v) => onFile((f) => void (f.climate.designMonth = v))}
            hint="All 12 months are run; each room is sized at its worst month."
          />
          <SelectField label="Daylight saving" value={c.dst ? "Yes" : "No"} options={["Yes", "No"]} onChange={(v) => onFile((f) => void (f.climate.dst = v === "Yes"))} />
          <SelectField label="Air factors" value={c.airBasis} options={["Site", "Standard"]} onChange={(v) => onFile((f) => void (f.climate.airBasis = v))} hint="Site = density-corrected" />
          <NumField label="Ground reflectance ρg" value={c.rhoG} onChange={(v) => onFile((f) => void (f.climate.rhoG = v ?? 0))} />
        </div>
        <h3>Indoor design</h3>
        <div className="grid">
          <NumField label="Indoor dry bulb" unit="°F" value={file.indoor.tin} onChange={(v) => onFile((f) => void (f.indoor.tin = v ?? 0))} />
          <NumField label="Indoor RH" unit="fraction" value={file.indoor.rhIn} onChange={(v) => onFile((f) => void (f.indoor.rhIn = v ?? 0))} />
        </div>
        <h3>Envelope options</h3>
        <div className="grid">
          <NumField label="Roof heat to plenum" value={file.envelope.roofPlenum} onChange={(v) => onFile((f) => void (f.envelope.roofPlenum = v ?? 0))} />
          <NumField label="Radiant fraction, walls" value={file.envelope.frWall} onChange={(v) => onFile((f) => void (f.envelope.frWall = v ?? 0))} />
          <NumField label="Radiant fraction, roofs" value={file.envelope.frRoof} onChange={(v) => onFile((f) => void (f.envelope.frRoof = v ?? 0))} />
          <NumField label="Radiant fraction, window conduction" value={file.envelope.frWin} onChange={(v) => onFile((f) => void (f.envelope.frWin = v ?? 0))} />
          <NumField label="Long-wave term, horizontal" unit="°F" value={file.envelope.lwHoriz} onChange={(v) => onFile((f) => void (f.envelope.lwHoriz = v ?? 0))} />
        </div>
        <h3>North</h3>
        <div className="grid">
          <NumField
            label="North (model azimuth of true north)"
            unit="°"
            allowBlank
            value={file.north.deg}
            onChange={(v) => onFile((f) => void (f.north.deg = v))}
            hint="Set it graphically on the Plan and north tab. Walls with a model azimuth face model azimuth − north."
          />
          <TextField
            label="Source of north"
            value={file.north.source}
            onChange={(v) => onFile((f) => void (f.north.source = v))}
            hint={file.north.source ? undefined : "Blank = listed as ASSUMED"}
            wide
          />
        </div>
      </div>

      <div className="panel">
        <h2>AHU {a.id}</h2>
        <p className="muted">Settings for this AHU only.</p>
        <div className="grid">
          <TextField
            label="AHU tag"
            value={a.id}
            testId="ahu-id"
            onChange={(v) => {
              if (v && !file.ahus.some((x, i) => i !== ahuIndex && x.id === v)) onAhu((x) => void (x.id = v));
            }}
          />
          <SelectField label="Airflow basis" value={a.air.sysType} options={["CAV", "VAV"]} onChange={(v) => onAhu((x) => void (x.air.sysType = v))} />
          <NumField label="Supply ΔT" unit="°F" value={a.load.dTsupply} onChange={(v) => onAhu((x) => void (x.load.dTsupply = v ?? 0))} />
          <NumField label="Safety factor on sensible" value={a.load.sf} onChange={(v) => onAhu((x) => void (x.load.sf = v ?? 0))} hint="0.10 = +10 %" />
          <SelectField
            label="Ventilation system"
            value={a.air.ventSys}
            options={["Auto", "Single-zone", "Multiple-zone", "100% OA"]}
            onChange={(v) => onAhu((x) => void (x.air.ventSys = v))}
            hint="Auto = single-zone if one room"
          />
          <SelectField label="Ev method" value={a.air.evMethod} options={["Appendix A", "Simplified"]} onChange={(v) => onAhu((x) => void (x.air.evMethod = v))} />
          <NumField label="System population Ps" allowBlank value={a.air.ps} onChange={(v) => onAhu((x) => void (x.air.ps = v))} hint="Blank = Σ Pz" />
          <TextField label="Default Ez configuration" value={a.air.ezDefault} options={options.ez} onChange={(v) => onAhu((x) => void (x.air.ezDefault = v ?? ""))} wide />
          <NumField label="Pressurization" unit="cfm" value={a.air.pressurization} onChange={(v) => onAhu((x) => void (x.air.pressurization = v ?? 0))} />
        </div>
        <h3>Workbook choices</h3>
        <p className="muted">Matteo's settings from the workbook. Editable; not values from an ASHRAE standard.</p>
        <div className="grid">
          <NumField label="Maximum zone Zpz" tag={<WorkbookChoice />} value={a.air.zpzMax} onChange={(v) => onAhu((x) => void (x.air.zpzMax = v ?? 1))} hint="1 = off" testId="zpzMax" />
          <NumField label="VAV box minimum" tag={<WorkbookChoice />} value={a.air.vavMin} onChange={(v) => onAhu((x) => void (x.air.vavMin = v ?? 0))} hint="fraction of room supply" testId="vavMin" />
          <NumField label="Round airflows up to" unit="cfm" tag={<WorkbookChoice />} value={a.air.cfmRound} onChange={(v) => onAhu((x) => void (x.air.cfmRound = v ?? 0))} hint="0 = no rounding" testId="cfmRound" />
          <NumField label="Exhaust makeup by direct supply" tag={<WorkbookChoice />} value={a.air.exhMakeup} onChange={(v) => onAhu((x) => void (x.air.exhMakeup = v ?? 0))} hint="fraction of exhaust; 0 = off" testId="exhMakeup" />
        </div>
      </div>

      <div className="panel">
        <h2>Rooms on {a.id}</h2>
        <table className="results">
          <thead>
            <tr>
              <th className="room">Room</th>
              <th>Area ft²</th>
              <th>People</th>
              <th className="text">62.1 category</th>
              <th>Surfaces</th>
              <th>Supply cfm</th>
            </tr>
          </thead>
          <tbody>
            {a.spaces.map((s) => {
              const r = result?.rooms.find((x) => x.id === s.id);
              return (
                <tr key={s.id}>
                  <td className="room">
                    <button className="link" onClick={() => onRoom(s.id)}>
                      {s.name}
                    </button>
                    <span className="room-id">{s.id}</span>
                    {r && r.errors.length > 0 && <span className="badge error">{r.errors.length} error{r.errors.length > 1 ? "s" : ""}</span>}
                  </td>
                  <td>{num(s.area, 1)}</td>
                  <td>{s.people ?? "—"}</td>
                  <td className="text">{s.ventCat}</td>
                  <td>{a.surfaces.filter((x) => x.space === s.id).length}</td>
                  <td>{r ? num(r.air.supply) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row-actions">
          <button onClick={onAddRoom}>Add room</button>
        </div>
      </div>
    </section>
  );
}
