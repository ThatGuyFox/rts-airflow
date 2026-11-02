// Room cooling loads by the Radiant Time Series: port of C6_RTS (one 31-row block per 02_Spaces row).
// Each heat-gain component is split radiant / convective; cooling load = convective + RTS convolution of the
// radiant part (nonsolar RTS, or solar RTS for unshaded beam). RTS tables as tabulated (LCAM Tables 7.11, 7.12
// = Fund. Ch. 18 Tables 19–20); ΣRTS check tolerance ±0.011 (2-digit tables). Hour = local clock time.

import { isBlank, n, sum, textEq } from "./excel";
import type { ConductionBlock } from "./conduction";
import type { FenestrationBlock } from "./fenestration";
import type { InternalBlock } from "./internal";
import type { InfiltrationBlock } from "./infiltration";

/** L4 row: library (libraries/rts.json) or project row (L4 31–40). NS/S hour 0..23; S blank for interior zones. */
export interface RtsSeries {
  row: number;
  id: string;
  description: string | null;
  NS: (number | null)[];
  S: (number | null)[] | null; // null in the library for interior zones
  source: string | null;
}

/** Cyclic 24-h convolution: out(h) = Σ_j f_j · x((h − j) mod 24). Blank factors count as 0 (SUMPRODUCT). */
export function convolve24(factors: readonly (number | null)[] | null, x: readonly number[]): number[] {
  const f = Array.from({ length: 24 }, (_, j) => n(factors?.[j]));
  return x.map((_, h) => {
    let acc = 0;
    for (let j = 0; j < 24; j++) acc += f[j]! * x[(h - j + 24) % 24]!;
    return acc;
  });
}

export interface Component {
  radiant: number[];
  convective: number[];
  load: number[];
}

export interface RoomLoad {
  n: number; // AF
  spaceId: string;
  rtsRow: number; // AG (L4 row − 4)
  rts?: RtsSeries;
  walls: Component; // walls, doors, partitions, floors → nonsolar
  roof: Component; // roof, room part → nonsolar
  winCond: Component; // window conduction → nonsolar
  beam: Component; // unshaded beam → solar RTS
  diffuse: Component; // diffuse + shaded beam → nonsolar
  people: Component;
  lighting: Component; // room part
  equipment: Component;
  infiltration: number[]; // all convective
  sensible: number[]; // row 38
  latent: number[]; // row 39
  toPlenum: number[]; // row 40
  balance: { diff: number; tol: number; ok: boolean }; // AH38:AJ38, 24-h energy balance
  issues: string[];
}

export interface RoomLoadSpace {
  id: string;
  rts: string | null;
}

const H24 = Array.from({ length: 24 }, (_, h) => h);
const zeros = () => H24.map(() => 0);
const add = (a: number[], b: readonly number[]) => a.map((v, i) => v + b[i]!);

export function roomLoads(
  spaces: readonly RoomLoadSpace[],
  rtsTable: readonly RtsSeries[],
  c2: readonly ConductionBlock[],
  c3: readonly FenestrationBlock[],
  c4: readonly InternalBlock[],
  c5: readonly InfiltrationBlock[],
  frWin: number,
): RoomLoad[] {
  return spaces.map((s, i) => {
    const issues: string[] = [];
    const rts = isBlank(s.rts) ? undefined : rtsTable.find((r) => textEq(r.id, s.rts!));
    if (!rts) issues.push(`RTS series "${s.rts ?? ""}" not in L4`);
    const ns = rts ? rts.NS : H24.map(() => NaN);
    const so = rts ? rts.S : H24.map(() => NaN);

    // SUMIFS over C2 / C3 blocks of this space (case-insensitive, like SUMIFS)
    const mine2 = c2.filter((b) => textEq(b.space, s.id));
    const mine3 = c3.filter((b) => textEq(b.space, s.id));
    const sum2 = (pick: (b: ConductionBlock) => number[], roof: boolean) =>
      mine2.filter((b) => textEq(b.type, "Roof") === roof).reduce((a, b) => add(a, pick(b)), zeros());
    const sum3 = (pick: (b: FenestrationBlock) => number[]) => mine3.reduce((a, b) => add(a, pick(b)), zeros());

    const comp = (radiant: number[], convective: number[], series: readonly (number | null)[] | null): Component => ({
      radiant,
      convective,
      load: add(convective, convolve24(series, radiant)),
    });

    const cond3 = sum3((b) => b.cond);
    const winCondRad = cond3.map((x) => x * frWin);
    const winCondConv = cond3.map((x) => x * (1 - frWin));
    const g4 = c4[i];
    const g5 = c5[i];
    if (!g4 || !g5) issues.push("C4/C5 block missing for this space");

    const walls = comp(sum2((b) => b.radiant, false), sum2((b) => b.convective, false), ns);
    const roof = comp(sum2((b) => b.radiant, true), sum2((b) => b.convective, true), ns);
    const winCond = comp(winCondRad, winCondConv, ns);
    const beam = comp(sum3((b) => b.radSolar), zeros(), so);
    const diffuse = comp(
      sum3((b) => b.radNonsolar).map((x, h) => x - winCondRad[h]!),
      sum3((b) => b.convective).map((x, h) => x - winCondConv[h]!),
      ns,
    );
    const split = (gain: number[] | undefined, fr: number | undefined) =>
      comp((gain ?? zeros()).map((x) => x * (fr ?? NaN)), (gain ?? zeros()).map((x) => x * (1 - (fr ?? NaN))), ns);
    const people = split(g4?.peopleSens, g4?.frPeople);
    const lighting = split(g4?.lightingSpace, g4?.frLighting);
    const equipment = split(g4?.equipment, g4?.frEquip);
    const infiltration = g5 ? g5.sensible.slice() : zeros();

    const comps = [walls, roof, winCond, beam, diffuse, people, lighting, equipment];
    const sensible = comps.reduce((a, c) => add(a, c.load), infiltration.slice());
    const latent = add(g4 ? g4.peopleLat : zeros(), g5 ? g5.latent : zeros());
    const plenum2 = mine2.reduce((a, b) => add(a, b.toPlenum), zeros());
    const toPlenum = add(plenum2, g4 ? g4.lightingPlenum : zeros());

    // AH38:AJ38 — Σ24 cooling load = Σ24 gains, within 0.011 × Σ|radiant| + 0.5
    const radSum = comps.map((c) => sum(c.radiant));
    const gainSum = sum(radSum) + sum(comps.map((c) => sum(c.convective))) + sum(infiltration);
    const diff = sum(sensible) - gainSum;
    const tol = 0.011 * sum(radSum.map(Math.abs)) + 0.5;

    return {
      n: i + 1, spaceId: s.id, rtsRow: rts ? rts.row - 4 : NaN, rts,
      walls, roof, winCond, beam, diffuse, people, lighting, equipment, infiltration, sensible, latent, toPlenum,
      balance: { diff, tol, ok: Math.abs(diff) <= tol }, issues,
    };
  });
}

/** C6 rows 6–8: AHU block sums of room sensible, latent and to-plenum. */
export function blockLoads(rooms: readonly RoomLoad[]) {
  return {
    sensible: rooms.reduce((a, r) => add(a, r.sensible), zeros()),
    latent: rooms.reduce((a, r) => add(a, r.latent), zeros()),
    toPlenum: rooms.reduce((a, r) => add(a, r.toPlenum), zeros()),
  };
}
