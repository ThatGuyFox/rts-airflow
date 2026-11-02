// The three result steps (HANDOFF §9): 1 outdoor air, 2 cooling loads, 3 airflows.
// Results first; hourly and month detail sits behind "Show working".
import { useState } from "react";
import type { ProjectInput, ProjectResult, RoomResult } from "../engine/project";
import { bad, hour, month, MONTHS, num } from "./fmt";
import { Card, ShowWorking } from "./ui";

interface StepProps {
  project: ProjectInput;
  result: ProjectResult;
  onRoom: (id: string) => void;
}

function RoomCell({ r, onRoom }: { r: RoomResult; onRoom: (id: string) => void }) {
  return (
    <td className="room">
      <button className="link" onClick={() => onRoom(r.id)} title="Open room inputs">
        {r.name}
      </button>
      <span className="room-id">{r.id}</span>
      {r.errors.length > 0 && (
        <span className="badge error" title={r.errors.map((e) => e.text).join("\n")}>
          {r.errors.length} error{r.errors.length > 1 ? "s" : ""}
        </span>
      )}
    </td>
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------------------------
// Step 1: zone ventilation (62.1-2022 VRP, Eq. 6-1, 6-2; Table 6-2 exhaust)

export function Step1({ project, result, onRoom }: StepProps) {
  const a = result.ahu;
  const z = result.rooms.map((r) => r.zone);
  return (
    <section>
      <p className="step-lead">Outdoor air each room needs by ASHRAE 62.1-2022, before any load. The AHU intake (Vou, Ev, Vot) depends on the room supplies from step 3.</p>
      <div className="cards">
        <Card label="Σ Voz, zone outdoor air" value={`${num(sum(z.map((x) => x.Voz)), 1)} cfm`} />
        <Card label="Vou, uncorrected OA" value={`${num(a.Vou, 1)} cfm`} sub={`D = ${num(a.D, 3)}`} />
        <Card label="Design outdoor air" value={`${num(a.Vot)} cfm`} sub={a.oaGovernedBy} />
        <Card label="Σ exhaust" value={`${num(a.sumExhaust)} cfm`} />
      </div>
      <div className="table-wrap">
        <table className="results" data-testid="step1-table">
          <thead>
            <tr>
              <th className="room">Room</th>
              <th className="text">62.1 category</th>
              <th title="Outdoor air rate per person, Table 6-1">Rp cfm/p</th>
              <th title="Outdoor air rate per area, Table 6-1">Ra cfm/ft²</th>
              <th title="Zone population">Pz</th>
              <th title="Zone floor area">Az ft²</th>
              <th title="Zone air distribution effectiveness, Table 6-4">Ez</th>
              <th title="Breathing zone OA, Eq. 6-1">Vbz cfm</th>
              <th title="Zone OA, Eq. 6-2">Voz cfm</th>
              <th title="Table 6-2 or override">Exhaust cfm</th>
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((r, i) => {
              const s = project.spaces[i]!;
              return (
                <tr key={r.id}>
                  <RoomCell r={r} onRoom={onRoom} />
                  <td className="text">{s.ventCat}</td>
                  <td>{num(r.zone.Rp, 1)}</td>
                  <td>{num(r.zone.Ra, 2)}</td>
                  <td>
                    {num(r.zone.Pz, r.zone.PzFromDefaultDensity ? 2 : 0)}
                    {r.zone.PzFromDefaultDensity && (
                      <span className="badge assumed" title="Pz from the 62.1 default occupant density (no people count entered)">
                        default
                      </span>
                    )}
                  </td>
                  <td>{num(s.area, 1)}</td>
                  <td>{num(r.zone.Ez, 2)}</td>
                  <td>{num(r.zone.Vbz, 1)}</td>
                  <td>{num(r.zone.Voz, 1)}</td>
                  <td>{num(r.zone.exhaust)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="room">Total</td>
              <td />
              <td />
              <td />
              <td>{num(a.sumPz, 1)}</td>
              <td>{num(sum(project.spaces.map((s) => s.area)), 1)}</td>
              <td />
              <td>{num(sum(z.map((x) => x.Vbz)), 1)}</td>
              <td>{num(sum(z.map((x) => x.Voz)), 1)}</td>
              <td>{num(a.sumExhaust)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ShowWorking label="62.1 table rows used" testId="working-1">
        <table className="results small">
          <thead>
            <tr>
              <th className="room">Room</th>
              <th className="text">Table 6-1 row</th>
              <th>Default density /1000 ft²</th>
              <th>Air class</th>
              <th className="text">Exhaust row (Table 6-2)</th>
              <th>Rp·Pz</th>
              <th>Ra·Az</th>
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((r) => (
              <tr key={r.id}>
                <td className="room">{r.name}</td>
                <td className="text">
                  {r.zone.ventRow ? r.zone.ventRow.category : "not found"}
                  {r.zone.ventRow && <div className="cite">{r.zone.ventRow.source}</div>}
                </td>
                <td>{num(r.zone.ventRow?.default_density_per_1000ft2 ?? null, 0)}</td>
                <td>{num(r.zone.airClass)}</td>
                <td className="text">
                  {r.zone.exhRow ? `${r.zone.exhRow.type} (${r.zone.exhRow.cfm_per_unit ?? r.zone.exhRow.cfm_per_ft2} ${r.zone.exhRow.unit ?? ""})` : "—"}
                  {r.zone.exhRow && <div className="cite">{r.zone.exhRow.source}</div>}
                </td>
                <td>{num(r.zone.RpPz, 1)}</td>
                <td>{num(r.zone.RaAz, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="kv">
          <dt>Σ Pz</dt>
          <dd>{num(a.sumPz, 1)}</dd>
          <dt>Ps, system population</dt>
          <dd>{num(a.Ps, 1)}</dd>
          <dt>D = Ps / ΣPz (Eq. 6-6)</dt>
          <dd>{num(a.D, 3)}</dd>
          <dt>Σ Rp·Pz</dt>
          <dd>{num(a.sumRpPz, 1)}</dd>
          <dt>Σ Ra·Az</dt>
          <dd>{num(a.sumRaAz, 1)}</dd>
          <dt>Vou = D·ΣRp·Pz + ΣRa·Az (Eq. 6-5)</dt>
          <dd>{num(a.Vou, 2)} cfm</dd>
        </dl>
      </ShowWorking>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 2: room cooling loads (RTS), each room at its worst month

const COMPONENTS = [
  ["walls", "Walls, doors, partitions, floors"],
  ["roof", "Roof (room part)"],
  ["winCond", "Window conduction"],
  ["beam", "Window beam, unshaded (solar RTS)"],
  ["diffuse", "Window diffuse + shaded beam"],
  ["people", "People sensible"],
  ["lighting", "Lighting (room part)"],
  ["equipment", "Equipment"],
] as const;

export function Step2({ result, onRoom }: StepProps) {
  const b = result.block;
  const designPeak = b.monthlyPeaks.find((m) => m.month === result.designMonth);
  const worstPeak = b.monthlyPeaks.find((m) => m.month === b.worstMonth) ?? designPeak;
  const [pickRoom, setPickRoom] = useState(0);
  const [pickMonth, setPickMonth] = useState<number | null>(null);
  const room = result.rooms[pickRoom] ?? result.rooms[0];
  const showMonth = pickMonth ?? room?.governingMonth ?? result.designMonth;
  const mr = result.months.find((m) => m.month === showMonth);
  const rl = mr && room ? mr.rooms[result.rooms.indexOf(room)] : undefined;

  return (
    <section>
      <p className="step-lead">
        Room sensible cooling loads by the ASHRAE Radiant Time Series method, run for all 12 months. Each room is sized at its worst month; the design month is{" "}
        {month(result.designMonth)}.
      </p>
      <div className="cards">
        <Card label="AHU block sensible peak" value={`${num(b.worstSensible)} Btu/h`} sub={`${month(b.worstMonth)} ${hour(worstPeak?.hour)}`} testId="block-peak" />
        <Card label={`Block peak, design month (${month(result.designMonth)})`} value={`${num(b.designSensible)} Btu/h`} sub={hour(b.designHour)} />
        <Card label="Σ room sizing sensible" value={`${num(sum(result.rooms.map((r) => r.sizingSensible)))} Btu/h`} sub="each at its own worst month" />
        <Card label="Months run" value={String(result.monthsRun.length)} />
      </div>
      <div className="table-wrap">
        <table className="results" data-testid="step2-table">
          <thead>
            <tr>
              <th className="room">Room</th>
              <th title="Room sensible peak in the design month">Design month peak Btu/h</th>
              <th title="Highest monthly peak, months 1–12">12-month max Btu/h</th>
              <th>Governing month</th>
              <th>Peak hour</th>
              <th title="max(design, 12-month) × (1 + safety factor)">Sizing sensible Btu/h</th>
              <th title="Design-month latent at the design-month sensible peak hour">Latent Btu/h</th>
              <th title="Sizing sensible ÷ (Cs · ΔT supply)">Load cfm</th>
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((r) => (
              <tr key={r.id}>
                <RoomCell r={r} onRoom={onRoom} />
                <td>{num(r.designSensible)}</td>
                <td>{num(r.sweepMax)}</td>
                <td data-testid={`govmonth-${r.id}`}>{month(r.governingMonth)}</td>
                <td>{hour(r.monthlyPeaks.find((m) => m.month === r.governingMonth)?.hour)}</td>
                <td>{num(r.sizingSensible)}</td>
                <td>{num(r.latentAtPeak)}</td>
                <td>{num(r.loadCfm, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ShowWorking label="monthly peaks and hourly loads" testId="working-2">
        <h4>Room sensible peak by month, Btu/h</h4>
        <div className="table-wrap">
          <table className="results small">
            <thead>
              <tr>
                <th className="room">Room</th>
                {result.monthsRun.map((m) => (
                  <th key={m}>{month(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rooms.map((r) => (
                <tr key={r.id}>
                  <td className="room">{r.name}</td>
                  {r.monthlyPeaks.map((p) => (
                    <td key={p.month} className={p.month === r.governingMonth ? "gov" : undefined} title={`peak at ${hour(p.hour)}`}>
                      {num(p.value)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="block-row">
                <td className="room">AHU block</td>
                {b.monthlyPeaks.map((p) => (
                  <td key={p.month} className={p.month === b.worstMonth ? "gov" : undefined} title={`peak at ${hour(p.hour)}`}>
                    {num(p.value)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <h4>Hourly cooling load by component</h4>
        <div className="pickers">
          <label>
            Room{" "}
            <select value={pickRoom} onChange={(e) => setPickRoom(Number(e.target.value))}>
              {result.rooms.map((r, i) => (
                <option key={r.id} value={i}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Month{" "}
            <select value={showMonth} onChange={(e) => setPickMonth(Number(e.target.value))}>
              {result.monthsRun.map((m) => (
                <option key={m} value={m}>
                  {MONTHS[m - 1]}
                  {room && m === room.governingMonth ? " (governing)" : ""}
                </option>
              ))}
            </select>
          </label>
          {rl && (
            <span className={rl.balance.ok ? "ok" : "warn"}>
              24-h energy balance {rl.balance.ok ? "closes" : "does not close"} (difference {num(rl.balance.diff, 2)} Btu, tolerance {num(rl.balance.tol, 2)})
            </span>
          )}
        </div>
        {rl && (
          <div className="table-wrap">
            <table className="results small hourly">
              <thead>
                <tr>
                  <th className="room">Btu/h</th>
                  {rl.sensible.map((_, h) => (
                    <th key={h}>{h + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPONENTS.map(([k, label]) => (
                  <tr key={k}>
                    <td className="room">{label}</td>
                    {rl[k].load.map((v, h) => (
                      <td key={h}>{num(v)}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="room">Infiltration sensible</td>
                  {rl.infiltration.map((v, h) => (
                    <td key={h}>{num(v)}</td>
                  ))}
                </tr>
                <tr className="block-row">
                  <td className="room">Room sensible</td>
                  {rl.sensible.map((v, h) => (
                    <td key={h}>{num(v)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="room">Room latent</td>
                  {rl.latent.map((v, h) => (
                    <td key={h}>{num(v)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="room">To return plenum</td>
                  {rl.toPlenum.map((v, h) => (
                    <td key={h}>{num(v)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {mr && (
          <dl className="kv">
            <dt>Design DB / MCWB ({month(showMonth)})</dt>
            <dd>
              {num(mr.dc.dbPeak, 1)} / {num(mr.dc.mcwb, 1)} °F
            </dd>
            <dt>Daily range DB / WB</dt>
            <dd>
              {num(mr.dc.dbRange, 1)} / {num(mr.dc.wbRange, 1)} °F
            </dd>
            <dt>Cs (air sensible factor)</dt>
            <dd>{num(mr.dc.cs, 3)}</dd>
          </dl>
        )}
      </ShowWorking>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 3: room supply, return, exhaust, transfer, and the AHU totals

export function Step3({ project, result, onRoom }: StepProps) {
  const a = result.ahu;
  const rp = result.returnPlenum;
  return (
    <section>
      <p className="step-lead">
        Room supply is the largest of load cfm, Voz and the 62.1 / exhaust-makeup floors, rounded up to {project.air.cfmRound} cfm. These are the numbers to size ducts from.
      </p>
      <div className="cards">
        <Card label="Σ supply" value={`${num(a.sumSupply)} cfm`} sub={`${a.sysType}, ${num(a.cfmPerFt2, 2)} cfm/ft²`} testId="total-supply" />
        <Card label="Σ return" value={`${num(a.sumReturn)} cfm`} testId="total-return" />
        <Card label="Design outdoor air" value={`${num(a.Vot)} cfm`} sub={a.oaGovernedBy} testId="design-oa" />
        <Card label="Relief" value={`${num(a.relief)} cfm`} sub={`Σ exhaust ${num(a.sumExhaust)} cfm`} testId="relief" />
      </div>
      <div className="cards secondary">
        <Card label="Xs = Vou / Vps" value={num(a.Xs, 3)} />
        <Card label={`Ev (${project.air.evMethod})`} value={num(a.Ev, 3)} sub={`App. A ${num(a.EvAppendixA, 3)} · Simplified ${num(a.EvSimplified, 3)}`} />
        <Card label="Vot by VRP = Vou / Ev" value={`${num(a.VotVRP, 1)} cfm`} />
        <Card label="Return air temperature" value={`${num(rp.tReturn, 2)} °F`} sub={`plenum gain ${num(rp.gain)} Btu/h`} />
      </div>
      <div className="table-wrap">
        <table className="results" data-testid="step3-table">
          <thead>
            <tr>
              <th className="room">Room</th>
              <th>Supply cfm</th>
              <th className="text">Governed by</th>
              <th>Return cfm</th>
              <th>Exhaust cfm</th>
              <th>Transfer in</th>
              <th>Transfer out</th>
              <th className="text">Transfer to</th>
              <th>cfm/ft²</th>
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((r) => (
              <tr key={r.id}>
                <RoomCell r={r} onRoom={onRoom} />
                <td className="strong" data-testid={`supply-${r.id}`}>
                  {num(r.air.supply)}
                </td>
                <td className="text">{r.air.governedBy}</td>
                <td data-testid={`return-${r.id}`}>{num(r.air.ret)}</td>
                <td>{num(r.zone.exhaust)}</td>
                <td>{num(r.air.xferIn)}</td>
                <td>{num(r.air.xferOut)}</td>
                <td className="text">{r.air.xferTo.join(", ") || "—"}</td>
                <td>{num(r.air.cfmPerFt2, 2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="room">Total</td>
              <td className="strong">{num(a.sumSupply)}</td>
              <td />
              <td>{num(a.sumReturn)}</td>
              <td>{num(a.sumExhaust)}</td>
              <td>{num(sum(result.rooms.map((r) => r.air.xferIn)))}</td>
              <td>{num(sum(result.rooms.map((r) => r.air.xferOut)))}</td>
              <td />
              <td>{num(a.cfmPerFt2, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <RoomChecks result={result} />
      <ShowWorking label="AHU ventilation block and zone fractions" testId="working-3">
        <table className="results small">
          <thead>
            <tr>
              <th className="room">Room</th>
              <th>Load cfm</th>
              <th>Voz</th>
              <th title="Primary airflow used for Zpz">Vpz</th>
              <th title="Zpz = Voz / Vpz (Eq. A-3)">Zpz</th>
              <th title="Evz (Eq. A-2)">Evz</th>
              <th title="Exhaust not made up by supply">Shortfall</th>
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((r) => (
              <tr key={r.id}>
                <td className="room">{r.name}</td>
                <td>{num(r.air.loadCfm, 1)}</td>
                <td>{num(r.zone.Voz, 1)}</td>
                <td>{num(r.air.Vpz, 1)}</td>
                <td>{typeof r.air.Zpz === "number" ? num(r.air.Zpz, 3) : r.air.Zpz}</td>
                <td>{num(r.air.Evz, 3)}</td>
                <td>{num(r.air.shortfall, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="kv">
          <dt>Ventilation system</dt>
          <dd>{a.ventSys}</dd>
          <dt>Σ supply / block supply (C66)</dt>
          <dd>
            {num(a.sumSupply)} / {num(a.blockSupply, 1)} cfm
          </dd>
          <dt>Σ VAV minimums</dt>
          <dd>{num(a.sumVavMin, 1)} cfm</dd>
          <dt>Vps, system primary airflow</dt>
          <dd>{num(a.Vps, 1)} cfm</dd>
          <dt>Vou</dt>
          <dd>{num(a.Vou, 2)} cfm</dd>
          <dt>Xs</dt>
          <dd>{num(a.Xs, 4)}</dd>
          <dt>Ev, Appendix A (Eq. A-9)</dt>
          <dd>{num(a.EvAppendixA, 4)}</dd>
          <dt>Ev, Simplified (Eq. 6-7 / 6-8)</dt>
          <dd>{num(a.EvSimplified, 4)}</dd>
          <dt>Vot by VRP</dt>
          <dd>{num(a.VotVRP, 2)} cfm</dd>
          <dt>Σ exhaust + pressurization</dt>
          <dd>
            {num(a.sumExhaust)} + {num(a.pressurization)} cfm
          </dd>
          <dt>Design OA, rounded up</dt>
          <dd>
            {num(a.Vot)} cfm ({a.oaGovernedBy})
          </dd>
          <dt>OA fraction</dt>
          <dd>{num(a.oaFraction * 100, 1)} %</dd>
          <dt>Recirculated</dt>
          <dd>{num(a.recirculated)} cfm</dd>
          <dt>Return plenum gain / ΔT / return temp</dt>
          <dd>
            {num(rp.gain)} Btu/h / {num(rp.dTret, 2)} °F / {num(rp.tReturn, 2)} °F
          </dd>
          <dt>System check</dt>
          <dd>{a.systemCheck}</dd>
        </dl>
      </ShowWorking>
    </section>
  );
}

/** Totals are NaN when a room has an input error (an ID not found); say so instead of showing dashes alone. */
function RoomChecks({ result }: { result: ProjectResult }) {
  if (!bad(result.ahu.sumSupply)) return null;
  return <div className="notice warn">Some rooms have input errors, so totals cannot be computed. See the errors list.</div>;
}
