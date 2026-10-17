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

export interface TownBuildingRecord { town: number; footprint: string }

/** Offsets h of `u32 depth(1-4)` with a town id in block (id >>> 8) at h + 8. */
function candidatesIn(b: Bytes, block: number): number[] {
  const out: number[] = [];
  // Search for the id's upper three bytes; the depth is checked after.
  for (const q of findAll(b.u8, le32(block).subarray(0, 3))) {
    const h = q - 9;
    if (h < 0) continue;
    const d = b.u8[h];
    if (d >= 1 && d <= 4 && b.u8[h + 1] === 0 && b.u8[h + 2] === 0 && b.u8[h + 3] === 0) out.push(h);
  }
  return out;
}

function densestRun(b: Bytes, candidates: number[]): [number, number][] {
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
  return runs.reduce((a, r) => (r.length > a.length ? r : a));
}

/**
 * TownBuilding: … u32 nParcels, nParcels × u32 parcel, u32 depth(1-4), f32 height, u32 town, i64 timeBuilt …
 * Port of the regex `[\x01-\x04]\0\0\0.{4}(?:ids)` with finditer's non-overlapping scan,
 * then the height filter. Keeps the densest contiguous run (records are ~45-55 bytes apart).
 * townEntity records exist only for some towns (one of five in a fresh game), so `seeds` only
 * anchor the search. Town ids are consecutive: any id in the seeds' 256-id blocks counts, and a
 * neighbouring block is searched too while the ids found reach a block edge.
 * `footprint` is nParcels x depth, which equals the building path's "WxD".
 */
export function townBuildings(b: Bytes, seeds: number[]): { records: TownBuildingRecord[]; ids: number[]; first: number } {
  const searched = new Map<number, number[]>();
  const search = (block: number) => { if (block >= 0 && !searched.has(block)) searched.set(block, candidatesIn(b, block)); };
  for (let k = Math.min(...seeds) >>> 8; k <= Math.max(...seeds) >>> 8; k++) search(k);
  let run: [number, number][], ids: number[];
  for (;;) {
    run = densestRun(b, [...searched.values()].flat());
    ids = [...new Set(run.map(([, t]) => t))].sort((a, z) => a - z);
    const n = searched.size;
    if (ids[0] % 256 === 0) search((ids[0] >>> 8) - 1);
    if (ids[ids.length - 1] % 256 === 255) search((ids[ids.length - 1] >>> 8) + 1);
    if (searched.size === n) break;
  }
  const records = run.map(([h, town]) => {
    let n = 1;
    while (n <= 16 && b.u32(h - 4 - 4 * n) !== n) n++;
    return { town, footprint: n <= 16 ? `${n}x${b.u8[h]}` : '?' };
  });
  return { records, ids, first: run[0][0] };
}

type Histogram = Map<string, number>;

function histogram(footprints: string[]): Histogram {
  const m: Histogram = new Map();
  for (const f of footprints) m.set(f, (m.get(f) ?? 0) + 1);
  return m;
}

/** Number of buildings that differ between two footprint histograms. */
function distance(a: Histogram, z: Histogram): number {
  let d = 0;
  for (const k of new Set([...a.keys(), ...z.keys()])) d += Math.abs((a.get(k) ?? 0) - (z.get(k) ?? 0));
  return d;
}

/** Pairs each cluster with a town, closest footprint histograms first. Returns town index per cluster. */
function pair(cls: Histogram[], tws: Histogram[]): { town: number[]; cost: number } {
  const pairs = cls.flatMap((c, i) => tws.map((t, j) => [distance(c, t), i, j]));
  pairs.sort((a, z) => a[0] - z[0] || a[1] - z[1] || a[2] - z[2]);
  const town = cls.map(() => -1), taken = new Set<number>();
  let cost = 0;
  for (const [d, i, j] of pairs) {
    if (town[i] >= 0 || taken.has(j)) continue;
    town[i] = j; taken.add(j); cost += d;
  }
  return { town, cost };
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

/**
 * Clusters buildings into towns and pairs each cluster with a town id by footprint histogram
 * (sizes alone tie in fresh games). Tries RADII in order and stops at the first exact match;
 * otherwise keeps the closest radius if few buildings differ (a save written mid-build).
 */
export function towns(blds: Building[], recs: TownBuildingRecord[], ids: number[], names: string[]) {
  const want = ids.map((id) => histogram(recs.filter((r) => r.town === id).map((r) => r.footprint)));
  let best: { cls: number[][]; town: number[]; cost: number; R: number } | null = null;
  for (const R of RADII) {
    const cls = cluster(blds, R);
    if (cls.length !== ids.length) continue;
    const p = pair(cls.map((c) => histogram(c.map((i) => blds[i].footprint))), want);
    if (!best || p.cost < best.cost) best = { cls, ...p, R };
    if (!p.cost) break;
  }
  const tolerance = Math.max(4, Math.ceil(blds.length / 100));
  if (!best || best.cost > tolerance) {
    throw new Error(best
      ? `building clusters differ from the town records by ${best.cost} buildings`
      : `buildings never formed ${ids.length} clusters (towns merged?)`);
  }
  const { cls, town, cost, R } = best;
  const warnings: string[] = [];
  if (cost) warnings.push(`${cost} town buildings don't match the town records (saved mid-build?)`);
  if (want.some((h, i) => want.some((g, j) => i < j && !distance(h, g)))) {
    warnings.push('two towns have identical buildings; their names may be swapped');
  }

  const out: Town[] = cls.map((c, n) => {
    const id = ids[town[n]];
    const t: Town = {
      id, name: names[1 + town[n]] ?? `Town ${id}`, buildings: c.length, cluster_radius_m: R,
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
  return { towns: out, warnings };
}
