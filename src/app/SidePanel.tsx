// Right-hand list: ASSUMED inputs (result.assumed) and input errors (result.errors). No status light,
// no O3 checks (Matteo, 2026-11-01). Each item opens the room it touches, or the project tab.
import type { AssumedItem, ProjectResult } from "../engine/project";
import type { DefaultItem } from "../model/newProject";

const KIND: Record<AssumedItem["kind"], string> = {
  "surface-note": "Surface",
  "space-note": "Room",
  construction: "Construction",
  glazing: "Glazing",
  shade: "Shade",
  rts: "RTS series",
  "pz-default-density": "62.1 default density",
  "not-621-category": "Not a 62.1 category",
  "workbook-choice": "Workbook choice",
  north: "North",
};

interface Props {
  result: ProjectResult;
  defaults: DefaultItem[]; // new-project template defaults not yet edited
  onKeep: (item: DefaultItem) => void;
  roomName: (id: string) => string;
  onRoom: (id: string) => void;
  onProject: (kind?: AssumedItem["kind"]) => void;
}

export function SidePanel({ result, defaults, onKeep, roomName, onRoom, onProject }: Props) {
  const errs = result.errors;
  return (
    <aside className="side" data-testid="side-panel">
      <section className="side-errors">
        <h3>
          Input errors <span className="count" data-testid="error-count">{errs.length}</span>
        </h3>
        {errs.length === 0 ? (
          <p className="muted">None. Every ID the rooms use was found.</p>
        ) : (
          <ul>
            {errs.map((e, i) => (
              <li key={i}>
                {e.room ? (
                  <button className="link" onClick={() => onRoom(e.room!)}>
                    {roomName(e.room)}
                  </button>
                ) : (
                  <b>Project</b>
                )}
                <div>{e.text}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="side-assumed">
        <h3>
          ASSUMED <span className="count" data-testid="assumed-count">{result.assumed.length + defaults.length}</span>
        </h3>
        <p className="muted">Inputs marked ASSUMED, template defaults not yet checked, 62.1 defaults used, and the workbook choices.</p>
        <ul>
          {defaults.map((x) => (
            <li key={`${x.scope}:${x.path}`} data-testid={x.room ? "auto-match" : "template-default"}>
              <span className="kind">{x.room ? "Matched from name" : "Template default"}</span> <b>{x.ref}</b>
              <div className="text">{x.text}</div>
              {x.room ? (
                <button className="link" onClick={() => onRoom(x.room!)}>
                  {roomName(x.room)}
                </button>
              ) : (
                <button className="link" onClick={() => onProject()}>
                  Project settings
                </button>
              )}{" "}
              <button className="link" onClick={() => onKeep(x)} title="Keep this value as entered and remove it from the ASSUMED list">
                Keep
              </button>
            </li>
          ))}
          {result.assumed.map((x, i) => (
            <li key={i}>
              <span className="kind">{KIND[x.kind]}</span> <b>{x.ref}</b>
              <div className="text">{x.text}</div>
              {x.rooms.length > 0 ? (
                <div className="rooms">
                  {x.rooms.map((r) => (
                    <button key={r} className="link" onClick={() => onRoom(r)}>
                      {roomName(r)}
                    </button>
                  ))}
                </div>
              ) : (
                <button className="link" onClick={() => onProject(x.kind)}>
                  {x.kind === "north" ? "Plan and north" : "Project settings"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
