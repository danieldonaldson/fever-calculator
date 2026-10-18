// Constructions: industries and town buildings (FINDINGS §3).
import { ascii, findAll, type Bytes } from './bytes';
import { isParseError, luaTable, type LuaValue } from './lua';

export interface Industry { type: string; x: number; y: number; z: number; offset: number }
export type BuildingKind = 'r' | 'c' | 'i';
/** Cargo a town building asks for (params.cargoTypes): cargo name and the game's factor (1, 0.5, 0.25 seen). */
export type CargoNeed = [cargo: string, factor: number];
/** `footprint`: "<width>x<depth>" in parcels, from the path (`3x4_03` -> "3x4"); pairs buildings with TownBuilding records. */
export interface Building {
  kind: BuildingKind; capacity: number; cargo: CargoNeed[]; footprint: string; x: number; y: number; offset: number;
}

// "::/cargos/fish/fish.cargo" -> "fish"
const cargoId = (path: string) => path.match(/cargos\/([^/]+)\//)?.[1] ?? path;

function cargoNeeds(v: LuaValue | undefined): CargoNeed[] {
  if (!(v instanceof Map)) return [];
  const out: CargoNeed[] = [];
  for (const e of v.values()) {
    if (!(e instanceof Map)) continue;
    const [path, factor] = [e.get(1), e.get(2)];
    if (typeof path === 'string') out.push([cargoId(path), typeof factor === 'number' ? factor : 1]);
  }
  return out;
}

const PREFIXES = [ascii('industries/'), ascii('buildings/')];
const DOT_CON = ascii('.con');

// [A-Za-z0-9_/]
const PATH_CHAR = new Uint8Array(256);
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/') PATH_CHAR[c.charCodeAt(0)] = 1;

/**
 * Matches of `(?:industries|buildings)/[A-Za-z0-9_/]+\.con`, non-overlapping and left to right
 * like Python's finditer. The class has no '.', so the path run ends at the first non-class byte.
 */
function pathMatches(b: Bytes): [number, number][] {
  const starts = PREFIXES.flatMap((pre) => findAll(b.u8, pre).map((s) => [s, pre.length]));
  starts.sort((a, z) => a[0] - z[0]);
  const out: [number, number][] = [];
  let lastEnd = 0;
  for (const [s, plen] of starts) {
    if (s < lastEnd) continue;
    let e = s + plen;
    while (e < b.length && PATH_CHAR[b.u8[e]]) e++;
    if (e === s + plen || !b.eq(e, DOT_CON)) continue;
    out.push([s, e + 4]);
    lastEnd = e + 4;
  }
  return out;
}

const isTransform = (m: number[]) =>
  m[15] === 1 && Math.abs(m[10] - 1) < 1e-3 && m[3] === 0 && m[7] === 0 && m[11] === 0;

export function constructions(b: Bytes) {
  const industries: Industry[] = [], buildings: Building[] = [];
  const first: { industry?: number; building?: number } = {};
  const latin1 = new TextDecoder('latin1');
  for (const [s, end] of pathMatches(b)) {
    const len = end - s;
    if (s < 4 || b.u32(s - 4) !== len) continue;
    let params, p: number, t: number[];
    try {
      [params, p] = luaTable(b, end);
      t = Array.from({ length: 16 }, (_, k) => b.f32(p + 4 * k));
    } catch (e) {
      if (isParseError(e)) continue;
      throw e;
    }
    if (!isTransform(t)) continue;
    const path = b.str(latin1, s, end);
    const seg = path.split('/');
    if (path.startsWith('industries/')) {
      industries.push({ type: seg[1], x: t[12], y: t[13], z: t[14], offset: s - 4 });
      first.industry ??= s - 4;
    } else {
      // buildings/<era>/<r|c|i><level>/<size>/<file>.con
      const kind = seg[2]?.[0];
      if (kind !== 'r' && kind !== 'c' && kind !== 'i') continue;
      const cap = params.get('capacity');
      buildings.push({
        kind, capacity: typeof cap === 'number' ? cap : Number(cap ?? 0), cargo: cargoNeeds(params.get('cargoTypes')),
        footprint: seg[3]?.match(/^(\d+x\d+)_/)?.[1] ?? '?', x: t[12], y: t[13], offset: s - 4,
      });
      first.building ??= s - 4;
    }
  }
  return { industries, buildings, first };
}
