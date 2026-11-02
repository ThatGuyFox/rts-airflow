// Small form controls. Blank inputs become null, as a blank workbook cell.
import { useEffect, useId, useState, type ReactNode } from "react";

interface Base {
  label: string;
  hint?: ReactNode;
  tag?: ReactNode; // e.g. the "workbook choice" badge
  testId?: string;
}

export function NumField(p: Base & { value: number | null; onChange: (v: number | null) => void; allowBlank?: boolean; unit?: string }) {
  const [text, setText] = useState(p.value === null ? "" : String(p.value));
  const [badText, setBad] = useState(false);
  useEffect(() => {
    const cur = text.trim() === "" ? null : Number(text);
    if (cur !== p.value) setText(p.value === null ? "" : String(p.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.value]);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {p.label} {p.tag}
      </label>
      <div className="with-unit">
        <input
          id={id}
          data-testid={p.testId}
          inputMode="decimal"
          className={badText ? "invalid" : undefined}
          value={text}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (t.trim() === "") {
              setBad(!p.allowBlank);
              if (p.allowBlank) p.onChange(null);
              return;
            }
            const v = Number(t);
            setBad(!Number.isFinite(v));
            if (Number.isFinite(v)) p.onChange(v);
          }}
        />
        {p.unit && <span className="unit">{p.unit}</span>}
      </div>
      {p.hint && <div className="hint">{p.hint}</div>}
    </div>
  );
}

export function TextField(p: Base & { value: string | null; onChange: (v: string | null) => void; options?: string[]; wide?: boolean }) {
  const id = useId();
  const listId = p.options ? `${id}-list` : undefined;
  return (
    <div className={p.wide ? "field wide" : "field"}>
      <label htmlFor={id}>
        {p.label} {p.tag}
      </label>
      <input id={id} data-testid={p.testId} list={listId} value={p.value ?? ""} onChange={(e) => p.onChange(e.target.value === "" ? null : e.target.value)} />
      {p.options && (
        <datalist id={listId}>
          {p.options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      {p.hint && <div className="hint">{p.hint}</div>}
    </div>
  );
}

export function SelectField<T extends string | number>(p: Base & { value: T; options: readonly (T | { value: T; label: string })[]; onChange: (v: T) => void }) {
  const id = useId();
  const opts = p.options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
  return (
    <div className="field">
      <label htmlFor={id}>
        {p.label} {p.tag}
      </label>
      <select
        id={id}
        data-testid={p.testId}
        value={String(p.value)}
        onChange={(e) => {
          const hit = opts.find((o) => String(o.value) === e.target.value);
          if (hit) p.onChange(hit.value);
        }}
      >
        {opts.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      {p.hint && <div className="hint">{p.hint}</div>}
    </div>
  );
}

export const WorkbookChoice = () => (
  <span className="badge choice" title="A setting from Matteo's workbook. Editable. Not a value from an ASHRAE standard.">
    workbook choice, not ASHRAE
  </span>
);

export function Card(p: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="card">
      <div className="card-label">{p.label}</div>
      <div className="card-value" data-testid={p.testId}>
        {p.value}
      </div>
      {p.sub && <div className="card-sub">{p.sub}</div>}
    </div>
  );
}

export function ShowWorking(p: { children: ReactNode; label?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="working">
      <button className="link" data-testid={p.testId} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "▾ Hide working" : `▸ Show working${p.label ? ` — ${p.label}` : ""}`}
      </button>
      {open && <div className="working-body">{p.children}</div>}
    </div>
  );
}
