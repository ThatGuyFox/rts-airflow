// What an ID means, shown where it is picked: a one-line description under the field, and labelled pick-list entries.
import { summaryLine, type Catalog, type IdInfo, type IdKind } from "../model/idInfo";

const ORIGIN_LABEL: Record<IdInfo["origin"], string> = {
  library: "",
  validation: "LCAM Ch. 8 test row",
  workbook: "workbook row",
  project: "this project",
};

/** Badges for a row: where it comes from when not a plain library row, ASSUMED, placeholder. */
export function IdBadges({ info }: { info: IdInfo }) {
  return (
    <>
      {info.origin !== "library" && <span className="badge">{ORIGIN_LABEL[info.origin]}</span>}
      {info.assumed && <span className="badge assumed">ASSUMED</span>}
      {info.placeholder && <span className="badge assumed">placeholder values</span>}
    </>
  );
}

/** Pick-list entries that show the description beside each ID. */
export function IdOptions({ list, infos }: { list: string; infos: IdInfo[] }) {
  const seen = new Set<string>();
  return (
    <datalist id={list}>
      {infos
        .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
        .map((i) => (
          <option key={i.id} value={i.id} label={summaryLine(i)} />
        ))}
    </datalist>
  );
}

/** Under an ID field: what the ID is, or that it is not found. Renders nothing for a blank ID. */
export function IdDetail({ catalog, kind, id, clamp }: { catalog: Catalog; kind: IdKind; id: string | null | undefined; clamp?: boolean }) {
  if (!id?.trim()) return null;
  const info = catalog.find(kind, id);
  if (!info) {
    return (
      <div className="id-note bad" data-testid="id-detail">
        not found in the libraries or this project
      </div>
    );
  }
  // Clamped (inside a table row): three lines, the full text and the source on hover
  const line = summaryLine(info);
  return (
    <div className={clamp ? "id-note clamp" : "id-note"} data-testid="id-detail" title={clamp ? `${line}${info.source ? `\nSource: ${info.source}` : ""}` : info.source ? `Source: ${info.source}` : undefined}>
      {clamp ? <span className="id-text">{line}</span> : line} {info.assumed && <span className="badge assumed">ASSUMED</span>}
      {!clamp && <IdBadges info={{ ...info, assumed: false }} />}
    </div>
  );
}
