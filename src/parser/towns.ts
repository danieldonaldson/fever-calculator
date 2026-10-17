// Towns: ids, TownBuilding records, clustering, centres (FINDINGS §5).
import { ascii, concat, findAll, le32, pyRound, pySum, type Bytes } from './bytes';
import type { Building } from './constructions';

const TOWN_ENTITY = concat(
  ascii('townEntity'), le32(4), [1], le32(2),
  le32(3), le32(6), ascii('entity'), le32(2),
); // followed by f64 town id

export function townIds(b: Bytes): { ids: number[]; first: number | null } {
  const hits = findAll(b.u8, TOWN_ENTITY).filter((h) => h + TOWN_ENTITY.length + 8 <= b.length);
  const ids = [...new Set(hits.map((h) => Math.trunc(b.f64(h + TOWN_ENTITY.length))))].sort((a, z) => a - z);
  return { ids, first: hits.length ? hits[0] : null };
}

/**
 * TownBuilding: … u32 depth(1-4), f32 height, u32 town, i64 timeBuilt …
 * Port of the regex `[\x01-\x04]\0\0\0.{4}(?:ids)` with finditer's non-overlapping scan,
 * then the height filter. Keeps the densest contiguous run (records are ~45-55 bytes apart).
 */
export function townBuildings(b: Bytes, ids: number[]): { towns: number[]; first: number } {
  const idSet = new Set(ids);
  // Search for the town id's upper three bytes; the low byte and the depth are checked after.
  const candidates: number[] = [];
  for (const hi of new Set(ids.map((t) => t >>> 8))) {
    for (const q of findAll(b.u8, le32(hi).subarray(0, 3))) {
      const at = q - 1, h = at - 8;
      if (h < 0 || !idSet.has(b.u32(at))) continue;
      const d = b.u8[h];
      if (d >= 1 && d <= 4 && b.u8[h + 1] === 0 && b.u8[h + 2] === 0 && b.u8[h + 3] === 0) candidates.push(h);
    }
  }
  candidates.sort((a, z) => a - z);
  const hits: [number, number][] = [];
  let lastEnd = 0;
  for (const h of candidates) {
    if (h < lastEnd) continue;
    lastEnd = h + 12;
    const height = b.f32(h + 4);
    if (height > 2 && height < 300) hits.push([h, b.u32(h + 8)]);
  }
  if (!hits.length) throw new Error('no TownBuilding records found');
  const runs: [number, number][][] = [];
  let cur = [hits[0]];
  for (const h of hits.slice(1)) {
    if (h[0] - cur[cur.length - 1][0] < 2000) cur.push(h);
    else { runs.push(cur); cur = [h]; }
  }
  runs.push(cur);
  const run = runs.reduce((a, r) => (r.length > a.length ? r : a));
  return { towns: run.map(([, t]) => t), first: run[0][0] };
}

/** Single-linkage clusters at radius R, largest first (stable for equal sizes). */
export function cluster(blds: Building[], R: number): number[][] {
  const par = blds.map((_, i) => i);
  const f = (i: number) => {
    while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; }
    return i;
  };
  const grid = new Map<string, number[]>();
  blds.forEach((b, i) => {
    const k = `${Math.floor(b.x / R)},${Math.floor(b.y / R)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  for (const [k, L] of grid) {
    const [gx, gy] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        for (const i of L) {
          if (i < j && (blds[i].x - blds[j].x) ** 2 + (blds[i].y - blds[j].y) ** 2 < R * R) par[f(i)] = f(j);
        }
      }
    }
  }
  const cl = new Map<number, number[]>();
  for (let i = 0; i < blds.length; i++) {
    const r = f(i);
    (cl.get(r) ?? cl.set(r, []).get(r)!).push(i);
  }
  return [...cl.values()].sort((a, z) => z.length - a.length);
}

export type Kind = 'residential' | 'commercial' | 'industrial';
export const KINDS: [Building['kind'], Kind][] = [['r', 'residential'], ['c', 'commercial'], ['i', 'industrial']];

export interface Town {
  id: number;
  name: string;
  buildings: number;
  cluster_radius_m: number;
  centers: Partial<Record<Kind, [number, number]>>;
  capacity: Record<Kind, number>;
  population: number;
  /** cargo wanted by the commercial and industrial districts, most wanted first (not in the Python reference) */
  demand: Record<'commercial' | 'industrial', Demand[]>;
}

/**
 * One cargo a district asks for. In the saves seen, every building of a district lists the same
 * cargos (the town's need list), the first with factor 1 and later ones 0.5 or 0.25.
 * `factor`: the largest factor any building gives it. `buildings`: how many buildings list it.
 * `weight`: Σ capacity × factor, used for ordering; how the game uses the factor is not verified.
 */
export interface Demand { cargo: string; factor: number; buildings: number; weight: number }

function demand(L: Building[]): Demand[] {
  const m = new Map<string, Demand>();
  for (const b of L) {
    for (const [cargo, factor] of b.cargo) {
      const d = m.get(cargo) ?? m.set(cargo, { cargo, factor, buildings: 0, weight: 0 }).get(cargo)!;
      d.factor = Math.max(d.factor, factor);
      d.buildings++;
      d.weight += b.capacity * factor;
    }
  }
  return [...m.values()].sort((a, z) => z.weight - a.weight);
}

const RADII = [180, 150, 210, 120, 250, 100, 300, 80, 400];

export function towns(blds: Building[], tbTowns: number[], ids: number[], names: string[]) {
  const counts = new Map<number, number>();
  for (const t of tbTowns) counts.set(t, (counts.get(t) ?? 0) + 1);
  const want = [...counts.values()].sort((a, z) => z - a);
  const order = [...ids].sort((a, z) => (counts.get(z) ?? 0) - (counts.get(a) ?? 0));
  let cls: number[][] | null = null, R = 0;
  for (R of RADII) {
    const c = cluster(blds, R);
    if (c.length === want.length && c.every((x, i) => x.length === want[i])) { cls = c; break; }
  }
  if (!cls) throw new Error(`cluster sizes never matched TownBuilding counts ${JSON.stringify(want)}`);
  const warning = new Set(want).size !== want.length
    ? 'two towns share a building count; name assignment may be swapped' : undefined;

  const out: Town[] = cls.map((c, n) => {
    const id = order[n];
    const t: Town = {
      id, name: names[1 + ids.indexOf(id)] ?? `Town ${id}`, buildings: c.length, cluster_radius_m: R,
      centers: {}, capacity: { residential: 0, commercial: 0, industrial: 0 }, population: 0,
      demand: { commercial: [], industrial: [] },
    };
    for (const [k, kn] of KINDS) {
      const L = c.map((i) => blds[i]).filter((b) => b.kind === k);
      t.capacity[kn] = Math.trunc(pySum(L.map((b) => b.capacity)));
      if (L.length) {
        t.centers[kn] = [pyRound(pySum(L.map((b) => b.x)) / L.length, 1), pyRound(pySum(L.map((b) => b.y)) / L.length, 1)];
      }
      if (kn !== 'residential') t.demand[kn] = demand(L);
    }
    t.population = t.capacity.residential;
    return t;
  });
  return { towns: out, warning };
}
