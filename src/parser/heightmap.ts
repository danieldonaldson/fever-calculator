// Terrain heightmap (FINDINGS §6).
import { findAll, le32, type Bytes } from './bytes';

export const TILE_M = 256;
export const RAW_PER_M = 20;
export const RAW_ZERO = 2000; // height_m = raw/20 - 100; water level 0 m == raw 2000

export interface Heightmap {
  tiles: [number, number][];
  offs: number[];
  side: number;
  list_offset: number;
  data_offset: number;
  end_offset: number;
}

// `u32 14, 0, 0, 0` just before `u32 N, u32 S` and the samples. The u32 before it is
// 0xFFFFFFFF in 1.sav/2.sav but 38 in the campaign save, so it isn't checked.
const SAMPLES_HEAD = new Uint8Array([14, 0, 0, 0, ...new Array(12).fill(0)]);

/** Every `u32 14, 0, 0, 0, N, S` is a candidate; the first that validates wins. */
export function heightmap(b: Bytes): Heightmap {
  for (const at of findAll(b.u8, SAMPLES_HEAD)) {
    try {
      const hm = tryAt(b, at);
      if (hm) return hm;
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
  }
  throw new Error('heightmap not found');
}

function tryAt(b: Bytes, at: number): Heightmap | null {
  const n = b.u32(at + 16), s = b.u32(at + 20);
  const side = Math.round(Math.sqrt(s));
  if (!(n > 0 && n < 100_000 && side * side === s && side > 2)) return null;
  let q = at + 20; // first tile's u32 sample count
  const offs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (b.u32(q) !== s) break;
    offs.push(q + 4);
    q += 4 + 2 * s;
  }
  if (offs.length !== n) return null;
  const lst = tileList(b, n, at);
  if (lst === null) return null;
  const tiles: [number, number][] = [];
  for (let i = 0; i < n; i++) tiles.push([b.i32(lst + 12 * i), b.i32(lst + 12 * i + 4)]);
  return { tiles, offs, side, list_offset: lst - 8, data_offset: at + 20, end_offset: q };
}

/**
 * The nearest `u32 N, u32 2, N × (i32 x, i32 y, u32 v), u32 0, u32 N` before the samples.
 * In 1.sav/2.sav it ends 8 bytes before the 0xFFFFFFFF; the campaign save has a ~4 MB
 * block in between (FINDINGS §6).
 */
function tileList(b: Bytes, n: number, before: number): number | null {
  const head = new Uint8Array([...le32(n), 2, 0, 0, 0]);
  const cands = findAll(b.u8.subarray(0, before), head);
  for (let c = cands.length - 1; c >= 0; c--) {
    const lst = cands[c] + 8, end = lst + 12 * n;
    if (end + 8 > before || b.u32(end) !== 0 || b.u32(end + 4) !== n) continue;
    const seen = new Set<string>();
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const x = b.i32(lst + 12 * i), y = b.i32(lst + 12 * i + 4);
      ok = Math.abs(x) <= 4096 && Math.abs(y) <= 4096;
      seen.add(`${x},${y}`);
    }
    if (ok && seen.size === n) return lst;
  }
  return null;
}

export interface Raster {
  /** raw heights, row-major, row 0 = north edge */
  heights: Uint16Array;
  width: number;
  height: number;
  /** world metres of the south-west corner */
  x0: number;
  y0: number;
  /** metres per sample */
  sample_m: number;
}

/** Full-resolution raster, north up. Shared tile edges are dropped (each tile contributes side-1 samples). */
export function raster(b: Bytes, hm: Heightmap): Raster {
  const xs = hm.tiles.map((t) => t[0]), ys = hm.tiles.map((t) => t[1]);
  const tx0 = Math.min(...xs), ty0 = Math.min(...ys);
  const per = hm.side - 1;
  const W = (Math.max(...xs) - tx0 + 1) * per;
  const H = (Math.max(...ys) - ty0 + 1) * per;
  const heights = new Uint16Array(W * H);
  hm.tiles.forEach(([tx, ty], n) => {
    const o = hm.offs[n];
    for (let iy = 0; iy < per; iy++) {
      const row = (H - 1 - ((ty - ty0) * per + iy)) * W + (tx - tx0) * per;
      const src = o + 2 * iy * hm.side;
      for (let ix = 0; ix < per; ix++) heights[row + ix] = b.dv.getUint16(src + 2 * ix, true);
    }
  });
  return { heights, width: W, height: H, x0: tx0 * TILE_M, y0: ty0 * TILE_M, sample_m: TILE_M / per };
}
