// Terrain heightmap (FINDINGS §6).
import { findAll, type Bytes } from './bytes';

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

const FF4 = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

/** Port of the lookahead `(?=\xff{4}.{4}\0{12}(N)(S))`: every overlapping 0xFFFFFFFF is a candidate. */
export function heightmap(b: Bytes): Heightmap {
  for (const at of findAll(b.u8, FF4)) {
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
  if (at < 8 || at + 28 > b.length) return null;
  for (let k = 8; k < 20; k++) if (b.u8[at + k] !== 0) return null;
  const n = b.u32(at + 20), s = b.u32(at + 24);
  const side = Math.round(Math.sqrt(s));
  if (!(n > 0 && n < 100_000 && side * side === s && side > 2)) return null;
  if (b.u32(at - 4) !== n || b.u32(at - 8) !== 0) return null;
  const lst = at - 8 - 12 * n;
  if (lst < 8 || b.u32(lst - 8) !== n || b.u32(lst - 4) !== 2) return null;
  const tiles: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const x = b.i32(lst + 12 * i), y = b.i32(lst + 12 * i + 4);
    if (Math.abs(x) > 4096 || Math.abs(y) > 4096) return null;
    seen.add(`${x},${y}`);
    tiles.push([x, y]);
  }
  if (seen.size !== n) return null;
  let q = at + 24; // first tile's u32 sample count
  const offs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (b.u32(q) !== s) break;
    offs.push(q + 4);
    q += 4 + 2 * s;
  }
  if (offs.length !== n) return null;
  return { tiles, offs, side, list_offset: lst - 8, data_offset: at + 24, end_offset: q };
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
