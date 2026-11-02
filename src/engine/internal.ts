// Internal gains: port of C4_Internal (one 7-row block per 02_Spaces row).
// People (LCAM Table 6.1 / Fund. Ch. 18 Table 1), lighting (Fund. 2017 Ch. 18 Table 3), equipment
// (Fund. 2017 Ch. 18 Tables 5–11, 14). W → Btu/h × 3.412. Schedules: hour-ending clock time, blank = always on.
// People load uses the entered count only: a blank count gives no people load (the 62.1 default density
// feeds ventilation only, HANDOFF §7).

import { isBlank, n, textEq } from "./excel";

export interface PeopleRow { row: number; activity: string; sensible_btuh: number; latent_btuh: number; radiant_fraction: number; source: string }
export interface LightingRow { row: number; fixture: string; space_fraction: number; radiant_fraction: number; Fsa: number | null; source: string }
export interface EquipmentRow { row: number; class: string; radiant_fraction: number; usage_factor: number | null; source: string }

export interface GainLibraries {
  people: PeopleRow[];
  lighting: LightingRow[];
  equipment: EquipmentRow[];
}

/** 04_Schedules row: 24 hour-ending fractions in local clock time. */
export interface Schedule {
  row: number; // sheet row (sch_ID MATCH index = row − 4)
  id: string;
  frac: (number | null)[];
}

/** 02_Spaces columns used by C4. */
export interface GainSpace {
  id: string;
  area: number; // C
  people: number | null; // F
  lpd: number | null; // G, W/ft²
  epd: number | null; // H, W/ft²
  occSch: string | null; // I
  ltgSch: string | null; // J
  eqpSch: string | null; // K
  ltgType: string | null; // L
  plenum: string | null; // M, "Y" = plenum return
  activity: string | null; // R
  eqpClass: string | null; // S
}

export interface InternalBlock {
  n: number; // AF, space position in 02_Spaces
  spaceId: string;
  people: number; // AG
  pplRow: number | null; // AH
  pplRef?: PeopleRow;
  sensPerPerson: number; // AI
  latPerPerson: number; // AJ
  frPeople: number; // AK
  lightingW: number; // AL
  ltgRow: number | null; // AM
  ltgRef?: LightingRow;
  spaceFrac: number; // AN
  frLighting: number; // AO
  fsa: number; // AP
  plenumFrac: number; // AQ
  equipW: number; // AR
  eqpRow: number | null; // AS
  eqpRef?: EquipmentRow;
  frEquip: number; // AT
  usage: number; // AU
  occSchRow: number | null; // AV
  ltgSchRow: number | null; // AW
  eqpSchRow: number | null; // AX
  peopleSens: number[]; // row 1
  peopleLat: number[]; // row 2
  lightingTotal: number[]; // row 3
  lightingPlenum: number[]; // row 4
  lightingSpace: number[]; // row 5
  equipment: number[]; // row 6
  issues: string[];
}

const W_TO_BTUH = 3.412;

export function internalGains(spaces: readonly GainSpace[], schedules: readonly Schedule[], lib: GainLibraries): InternalBlock[] {
  return spaces.map((s, i) => {
    const issues: string[] = [];
    // MATCH index into a library range, or null when the input is blank; NaN (≈ #N/A) when not found
    function find<R extends { row: number }>(key: string | null, rows: readonly R[], k: (r: R) => string, first: number, what: string) {
      if (isBlank(key)) return { idx: null as number | null, ref: undefined as R | undefined };
      const ref = rows.find((r) => textEq(k(r), key));
      if (!ref) issues.push(`${what} "${key}" not found`);
      return { idx: ref ? ref.row - first + 1 : NaN, ref };
    }
    const ppl = find(s.activity, lib.people, (r) => r.activity, 6, "people activity");
    const ltg = find(s.ltgType, lib.lighting, (r) => r.fixture, 25, "lighting type");
    const eqp = find(s.eqpClass, lib.equipment, (r) => r.class, 44, "equipment class");
    const sch = (id: string | null, what: string) => find(id, schedules, (r) => r.id, 5, `${what} schedule`);
    const occ = sch(s.occSch, "occupancy");
    const lsc = sch(s.ltgSch, "lighting");
    const esc = sch(s.eqpSch, "equipment");

    const val = <R>(f: { idx: number | null; ref?: R }, get: (r: R) => number, ifBlank: number) =>
      f.idx === null ? ifBlank : f.ref ? get(f.ref) : NaN;

    const people = n(s.people);
    const sensPerPerson = val(ppl, (r) => r.sensible_btuh, 0);
    const latPerPerson = val(ppl, (r) => r.latent_btuh, 0);
    const frPeople = val(ppl, (r) => r.radiant_fraction, 0);
    const lightingW = n(s.lpd) * s.area;
    const spaceFrac = val(ltg, (r) => r.space_fraction, 1);
    const frLighting = val(ltg, (r) => r.radiant_fraction, 0);
    const fsa = val(ltg, (r) => (isBlank(r.Fsa) ? 1 : r.Fsa!), 1);
    const plenumFrac = s.plenum === "Y" ? 1 - spaceFrac : 0;
    const equipW = n(s.epd) * s.area;
    const frEquip = val(eqp, (r) => r.radiant_fraction, 0);
    const usage = val(eqp, (r) => (isBlank(r.usage_factor) ? 1 : r.usage_factor!), 1);

    const f = (sc: { idx: number | null; ref?: Schedule }, h: number) => (sc.idx === null ? 1 : sc.ref ? n(sc.ref.frac[h]) : NaN);
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const peopleSens = hours.map((h) => people * sensPerPerson * f(occ, h));
    const peopleLat = hours.map((h) => people * latPerPerson * f(occ, h));
    const lightingTotal = hours.map((h) => lightingW * W_TO_BTUH * fsa * f(lsc, h));
    const lightingPlenum = lightingTotal.map((x) => x * plenumFrac);
    const lightingSpace = lightingTotal.map((x, h) => x - lightingPlenum[h]!);
    const equipment = hours.map((h) => equipW * W_TO_BTUH * usage * f(esc, h));

    return {
      n: i + 1, spaceId: s.id, people, pplRow: ppl.idx, pplRef: ppl.ref, sensPerPerson, latPerPerson, frPeople,
      lightingW, ltgRow: ltg.idx, ltgRef: ltg.ref, spaceFrac, frLighting, fsa, plenumFrac,
      equipW, eqpRow: eqp.idx, eqpRef: eqp.ref, frEquip, usage,
      occSchRow: occ.idx, ltgSchRow: lsc.idx, eqpSchRow: esc.idx,
      peopleSens, peopleLat, lightingTotal, lightingPlenum, lightingSpace, equipment, issues,
    };
  });
}
