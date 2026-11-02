// Library row types and lookups. Data comes from libraries/*.json (exported from the workbook with
// citations by tools/export_libraries.py). The engine never reads files: the caller passes the data in.

import { textEq } from "./excel";

/** Fields every exported library row carries. */
export interface Cited {
  row: number;
  source: string;
  source_level: "row" | "table";
  scope: "standard" | "validation" | "workbook";
}

/** 62.1-2022 Table 6-1 (L6 A6:G96, lib_VentTbl). */
export interface VentZoneRow extends Cited {
  category: string;
  group: string | null;
  Rp_cfm_per_person: number | null;
  Ra_cfm_per_ft2: number | null;
  default_density_per_1000ft2: number | null;
  air_class: number | null;
  notes: string | null;
}

/** 62.1-2022 Table 6-4 (L6 A101:D116, lib_EzTbl). */
export interface VentEzRow extends Cited {
  id: string;
  Ez: number;
  description: string | null;
  group: string | null;
}

/** 62.1-2022 Table 6-2 (L6 A121:F157, lib_ExhTbl). */
export interface VentExhaustRow extends Cited {
  type: string;
  cfm_per_unit: number | null;
  cfm_per_ft2: number | null;
  unit: string | null;
  air_class: number | null;
  notes: string | null;
}

export interface LibraryFile<R> {
  library: string;
  title: string;
  table_source?: string;
  rows: R[];
}

export interface Vent621Libraries {
  zone: LibraryFile<VentZoneRow>;
  ez: LibraryFile<VentEzRow>;
  exhaust: LibraryFile<VentExhaustRow>;
}

/** MATCH(key, column, 0): first row whose key equals `key`, case-insensitive. */
export function lookup<R>(rows: readonly R[], key: (r: R) => string, value: string): R | undefined {
  return rows.find((r) => textEq(key(r), value));
}
