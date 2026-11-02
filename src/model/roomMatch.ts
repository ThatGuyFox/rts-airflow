// Room name → 62.1 category and exhaust type, for the Revit import (Matteo, 2026-11-01). Pure: no DOM.
// The rules below are name keywords, not table values: each points at a row by its text, and a match counts
// only if that row is in the loaded library. Names that could mean several rows (holding, lobby, waiting,
// classroom, IT) are left unmatched on purpose: a blank shows as an input error, a wrong guess would not.
// Every match is listed ASSUMED ("matched from room name") until the user edits or keeps it.

import type { EngineLibraries } from "../engine/project";

/** The workbook's exhaust-only row (02_Spaces category for toilets, janitor: no Vbz). Found by this text. */
const EXHAUST_ONLY = /^exhaust-only space/i;

interface Rule {
  re: RegExp; // on the normalized name
  why: string; // shown in the ASSUMED note
  category?: string | typeof EXHAUST_ONLY; // Table 6-1 row (exact text, case-insensitive) or the exhaust-only row
  exhaust?: string; // Table 6-2 row (exact text, case-insensitive)
}

// First rule that matches wins. Exhaust rooms first, so "Office Restroom" is a restroom.
export const RULES: Rule[] = [
  { re: /\b(rest ?rooms?|toilets?|wcs?|washrooms?|bath ?rooms?|lavator(y|ies)|powder room)\b/, why: "toilet room", category: EXHAUST_ONLY, exhaust: "Toilets—public, normal use" },
  { re: /\b(janitors?|jan|custodial|trash|recycling)\b/, why: "janitor / trash room", category: EXHAUST_ONLY, exhaust: "Janitor closets, trash rooms, recycling" },
  { re: /\b(kitchenettes?|pantry)\b/, why: "kitchenette", exhaust: "Kitchenettes" },
  { re: /\b(copy|printing|print room)\b/, why: "copy / print room", exhaust: "Copy, printing rooms" },
  { re: /\b(corridors?|hallways?|halls?|corr)\b/, why: "corridor", category: "Corridors" },
  { re: /\breception\b/, why: "reception", category: "Reception areas" },
  { re: /\b(conference|conf|meeting|board ?room)\b/, why: "conference / meeting", category: "Conference/meeting" },
  { re: /\b(break ?rooms?|lunch ?room|staff lounge)\b/, why: "break room", category: "Breakrooms" },
  { re: /\b(offices?|ofc|ofc\.)\b/, why: "office", category: "Office space" },
  { re: /\b(storage|store ?room|stor|sto)\b/, why: "storage", category: "Occupiable storage rooms for dry materials" },
];

export interface RoomMatch {
  ventCat: string | null;
  exhType: string | null;
  how: string; // e.g. "matched from room name “Female Restroom 1” (toilet room)"
}

/** Lower case, "(Rm 14)" and punctuation removed, single spaces. */
export function normalizeName(name: string): string {
  return name
    .replace(/\(rm\s*\w+\)/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The library rows a room name points at, or nulls. Rows not in the library do not match. */
export function matchRoom(name: string, lib: Pick<EngineLibraries, "vent621">): RoomMatch {
  const n = normalizeName(name);
  const cats = lib.vent621.zone.rows.map((r) => r.category);
  const exhs = lib.vent621.exhaust.rows.map((r) => r.type);
  const find = (list: string[], t: string | RegExp) => list.find((c) => (typeof t === "string" ? c.toLowerCase() === t.toLowerCase() : t.test(c))) ?? null;
  for (const r of RULES) {
    if (!r.re.test(n)) continue;
    const ventCat = r.category ? find(cats, r.category) : null;
    const exhType = r.exhaust ? find(exhs, r.exhaust) : null;
    if (!ventCat && !exhType) continue;
    return { ventCat, exhType, how: `matched from room name “${name}” (${r.why})` };
  }
  return { ventCat: null, exhType: null, how: "" };
}
