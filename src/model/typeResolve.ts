// Revit types → construction / glazing IDs for the Revit import (Matteo, 2026-11-02). Pure: no DOM.
// Order, per Revit type:
//   1. what the user typed on the import page;
//   2. the remembered map (types mapped on earlier imports, kept in this browser and in the project file);
//   3. the Revit type's own thermal data (analytical U, SHGC):
//      - wall / roof: the library row of the same kind with the nearest U (nearest tabulated, ASSUMED);
//      - partition: a project row with that U, else a new project row (steady U·A·ΔT, CTS 1.0 in hour 0);
//      - door: a project Door row with that U, else a new row copying α, hₒ and CTS from an existing
//        project Door row (Revit has no α, hₒ, CTS); none to copy from → blank;
//      - window: a project glazing row with that U and SHGC, else a new row with them, Table 3.8 angle
//        type = the row with the nearest reference SHGC (ASSUMED);
//   4. blank: an input error on the room until entered.
// New rows say "ASSUMED" in their description, so the app lists them where they are used.

import type { Construction } from "../engine/conduction";
import type { AcfRow, GlazingInput } from "../engine/fenestration";
import type { RevitType, TypeKind } from "./revitImport";

export type TypeSource = "page" | "remembered" | "revit-u" | "new-row" | "none";
export interface TypeChoice {
  id: string;
  src: TypeSource;
  how: string; // shown on the page and, for "revit-u", in the ASSUMED list
}
export interface ResolveInput {
  need: { kind: TypeKind; name: string; key: string }[];
  revitTypes: RevitType[];
  picks: Record<string, string>; // typed on the page
  remembered: Record<string, string>;
  library: Construction[]; // libraries/constructions.json
  project: Construction[]; // the project's own L2 rows
  glazing: GlazingInput[]; // the project's L3 rows
  acf: (AcfRow & { SHGC0_reference?: number | null; description?: string | null })[];
}
export interface Resolved {
  choice: Record<string, TypeChoice>;
  newConstructions: Construction[];
  newGlazing: GlazingInput[];
}

const SAME = 0.0005; // U / SHGC equal to this tolerance → reuse the row
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

export function resolveTypes(p: ResolveInput): Resolved {
  const choice: Record<string, TypeChoice> = {};
  const newConstructions: Construction[] = [];
  const newGlazing: GlazingInput[] = [];
  const allCons = () => [...p.library, ...p.project, ...newConstructions];
  const usedIds = new Set([...p.library, ...p.project].map((c) => c.id.toLowerCase()).concat(p.glazing.map((g) => g.id.toLowerCase())));
  const freshId = (base: string) => {
    let id = base, n = 2;
    while (usedIds.has(id.toLowerCase())) id = `${base}-${n++}`;
    usedIds.add(id.toLowerCase());
    return id;
  };
  let conRow = Math.max(62, ...p.project.map((c) => c.row));
  let glzRow = Math.max(5, ...p.glazing.map((g) => g.row));
  const revit = (kind: TypeKind, name: string) => p.revitTypes.find((t) => t.cat === (kind === "partition" ? "wall" : kind) && t.name === name);

  for (const t of p.need) {
    if (t.key in p.picks) {
      choice[t.key] = { id: p.picks[t.key]!, src: "page", how: "entered here" };
      continue;
    }
    if (p.remembered[t.key]) {
      choice[t.key] = { id: p.remembered[t.key]!, src: "remembered", how: "your map from an earlier import" };
      continue;
    }
    const rt = revit(t.kind, t.name);
    const u = rt?.u ?? null;
    const none = (why: string): TypeChoice => ({ id: "", src: "none", how: why });

    if (t.kind === "wall" || t.kind === "roof") {
      if (u == null) {
        choice[t.key] = none("no U-value in Revit for this type");
        continue;
      }
      const kind = t.kind === "wall" ? "Wall" : "Roof";
      const rows = [...p.library.filter((c) => (c as Construction & { scope?: string }).scope !== "validation"), ...p.project].filter((c) => c.type === kind);
      const best = rows.sort((a, b) => Math.abs(a.U_btuh_ft2F - u) - Math.abs(b.U_btuh_ft2F - u))[0];
      choice[t.key] = best
        ? { id: best.id, src: "revit-u", how: `nearest U in the library: ${best.id} U ${best.U_btuh_ft2F} for Revit type “${t.name}” U ${r3(u)}` }
        : none(`no ${kind} rows in the library`);
      continue;
    }

    if (t.kind === "partition" || t.kind === "door") {
      if (u == null) {
        choice[t.key] = none("no U-value in Revit for this type");
        continue;
      }
      const kind = t.kind === "partition" ? "Partition" : "Door";
      const same = allCons().find((c) => c.type === kind && Math.abs(c.U_btuh_ft2F - u) <= SAME);
      if (same) {
        choice[t.key] = { id: same.id, src: "revit-u", how: `project row ${same.id} has the Revit U ${r3(u)}` };
        continue;
      }
      const like = t.kind === "door" ? [...p.project, ...newConstructions].find((c) => c.type === "Door") : null;
      if (t.kind === "door" && !like) {
        choice[t.key] = none("Revit gives U but not α, hₒ, CTS, and the project has no Door row to copy them from");
        continue;
      }
      const id = freshId(`RVT-${slug(t.name)}`);
      newConstructions.push({
        row: ++conRow,
        id,
        description: `ASSUMED — from Revit ${t.kind === "door" ? "door" : "wall"} type “${t.name}”`,
        type: kind,
        U_btuh_ft2F: r3(u),
        alpha: like ? like.alpha : null,
        ho_btuh_ft2F: like ? like.ho_btuh_ft2F : null,
        CTS: like ? [...like.CTS] : [1, ...Array<number>(23).fill(0)],
        source: like
          ? `U from the Revit type's analytical properties; α, hₒ and CTS copied from ${like.id}.`
          : "U from the Revit type's analytical properties. CTS 1.0 in hour 0 (partitions use steady U·A·ΔT).",
      });
      choice[t.key] = { id, src: "new-row", how: `new project row ${id}, U ${r3(u)} from Revit${like ? `, α / hₒ / CTS from ${like.id}` : ""}` };
      continue;
    }

    // window
    const shgc = rt?.shgc ?? null;
    if (u == null || shgc == null) {
      choice[t.key] = none(`no ${u == null ? "U-value" : "SHGC"} in Revit for this window type`);
      continue;
    }
    const same = [...p.glazing, ...newGlazing].find((g) => Math.abs(g.U - u) <= SAME && Math.abs(g.SHGC0 - shgc) <= SAME);
    if (same) {
      choice[t.key] = { id: same.id, src: "revit-u", how: `project glazing ${same.id} has the Revit U ${r3(u)} and SHGC ${r3(shgc)}` };
      continue;
    }
    const acf = p.acf
      .filter((a) => typeof a.SHGC0_reference === "number")
      .sort((a, b) => Math.abs(a.SHGC0_reference! - shgc) - Math.abs(b.SHGC0_reference! - shgc))[0];
    const id = freshId(`RVT-G-${slug(t.name)}`);
    newGlazing.push({
      row: ++glzRow,
      id,
      description: `ASSUMED — from Revit window type “${t.name}”; Table 3.8 type ${acf?.type_id ?? "—"}${acf?.description ? ` (${acf.description})` : ""} nearest by reference SHGC`,
      U: r3(u),
      SHGC0: r3(shgc),
      acfType: acf?.type_id ?? null,
      source: "U and SHGC from the Revit window type's analytical properties.",
    });
    choice[t.key] = { id, src: "new-row", how: `new glazing row ${id}, U ${r3(u)}, SHGC ${r3(shgc)} from Revit, angle type ${acf?.type_id ?? "—"} nearest by SHGC` };
  }
  return { choice, newConstructions, newGlazing };
}
