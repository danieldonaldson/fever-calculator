// Vector contour lines from the raw heightmap: marching squares per level, segments joined into polylines.
import { RAW_PER_M, RAW_ZERO, type Raster } from '../parser';

export interface ContourLevel {
  /** height above water level */
  level_m: number;
  /** polylines as flat [x0, y0, x1, y1, …] in world metres */
  lines: Float64Array[];
}

/**
 * Contours every `interval_m` metres above water level (the coastline itself is left to the terrain colours).
 * Lines run through the sample grid at sample positions (row 0 = north edge), so they line up with the terrain image
 * to within half a sample. Saddle cells are split by the cell's mean height.
 */
export function contours(r: Raster, interval_m: number, progress?: (fraction: number) => void): ContourLevel[] {
  const h = r.heights;
  let max = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > max) max = h[i];
  const levels: number[] = [];
  for (let level_m = interval_m; RAW_ZERO + level_m * RAW_PER_M < max; level_m += interval_m) levels.push(level_m);
  const out: ContourLevel[] = [];
  levels.forEach((level_m, k) => {
    // half a raw unit off the integer grid so no sample lies exactly on the level
    const lines = trace(r, RAW_ZERO + level_m * RAW_PER_M + 0.5);
    if (lines.length) out.push({ level_m, lines });
    progress?.((k + 1) / levels.length);
  });
  return out;
}

/**
 * Edge ids: the edge east of sample (row, col) is 2·(row·W + col), the edge south of it 2·(row·W + col) + 1.
 * Every crossing sits on one edge and is shared by the (at most two) cells on either side, so joining segments
 * is a matter of following edge ids.
 */
function trace(r: Raster, z: number): Float64Array[] {
  const { heights: h, width: W, height: H } = r;
  // segment endpoints as edge ids, two per segment
  const seg: number[] = [];
  for (let row = 0; row < H - 1; row++) {
    for (let col = 0; col < W - 1; col++) {
      const i = row * W + col;
      const a = h[i], b = h[i + 1], c = h[i + W + 1], d = h[i + W]; // nw, ne, se, sw
      const idx = (a > z ? 8 : 0) | (b > z ? 4 : 0) | (c > z ? 2 : 0) | (d > z ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const n = 2 * i, e = 2 * (i + 1) + 1, s = 2 * (i + W), w = 2 * i + 1;
      switch (idx) {
        case 1: case 14: seg.push(w, s); break;
        case 2: case 13: seg.push(s, e); break;
        case 3: case 12: seg.push(w, e); break;
        case 4: case 11: seg.push(n, e); break;
        case 6: case 9: seg.push(n, s); break;
        case 7: case 8: seg.push(w, n); break;
        case 5: case 10: {
          // saddle: nw/se high (5 is sw/ne high) — the mean decides whether the high corners connect
          const highJoined = (a + b + c + d) / 4 > z;
          if ((idx === 10) === highJoined) seg.push(w, s, n, e);
          else seg.push(w, n, s, e);
          break;
        }
      }
    }
  }
  // simplified to half a sample: well under a pixel at the closest zoom
  return join(seg, (edge) => crossing(r, edge, z), r.sample_m / 2);
}

/** world metres of the crossing of level `z` on an edge */
function crossing(r: Raster, edge: number, z: number): [number, number] {
  const { heights: h, width: W, height: H, x0, y0, sample_m } = r;
  const i = edge >> 1, row = (i / W) | 0, col = i - row * W;
  const a = h[i], b = edge & 1 ? h[i + W] : h[i + 1];
  const t = (z - a) / (b - a);
  const fc = edge & 1 ? col : col + t, fr = edge & 1 ? row + t : row;
  // sample centres: column 0 is half a sample east of x0, row H-1 half a sample north of y0
  return [x0 + (fc + 0.5) * sample_m, y0 + (H - 1 - fr + 0.5) * sample_m];
}

/** chain segments (pairs of edge ids) into polylines; closed rings repeat their first point */
function join(seg: number[], at: (edge: number) => [number, number], tol: number): Float64Array[] {
  const n = seg.length >> 1;
  // each edge id is an endpoint of one or two segments
  const ends = new Map<number, number>(); // edge -> first segment end (2·segment + side)
  const other = new Int32Array(seg.length).fill(-1); // segment end -> the matching end of its neighbour
  for (let k = 0; k < seg.length; k++) {
    const prev = ends.get(seg[k]);
    if (prev === undefined) ends.set(seg[k], k);
    else { other[k] = prev; other[prev] = k; }
  }
  const used = new Uint8Array(n);
  const lines: Float64Array[] = [];
  const pts: number[] = [];
  const push = (edge: number) => { const [x, y] = at(edge); pts.push(x, y); };
  /** walk from segment end `k` outwards through its far side, appending edge ids */
  const walk = (k: number, ids: number[]) => {
    while (true) {
      const s = k >> 1;
      if (used[s]) return;
      used[s] = 1;
      const far = k ^ 1;
      ids.push(seg[far]);
      const next = other[far];
      if (next < 0) return;
      k = next;
    }
  };
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    // forwards from this segment's end 1, backwards from its end 0
    const fwd: number[] = [], back: number[] = [];
    used[s] = 1;
    fwd.push(seg[2 * s + 1]);
    const f = other[2 * s + 1];
    if (f >= 0) walk(f, fwd);
    const b = other[2 * s];
    if (b >= 0) walk(b, back);
    pts.length = 0;
    for (let k = back.length - 1; k >= 0; k--) push(back[k]);
    push(seg[2 * s]);
    for (const e of fwd) push(e);
    lines.push(simplify(pts, tol));
  }
  return lines;
}

/** Douglas–Peucker on flat [x, y, …]; tolerance 0 just copies */
function simplify(pts: number[], tol: number): Float64Array {
  const n = pts.length >> 1;
  if (tol <= 0 || n < 3) return Float64Array.from(pts);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  const t2 = tol * tol;
  while (stack.length) {
    const j = stack.pop()!, i = stack.pop()!;
    const ax = pts[2 * i], ay = pts[2 * i + 1], dx = pts[2 * j] - ax, dy = pts[2 * j + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1, bestD = t2;
    for (let k = i + 1; k < j; k++) {
      const px = pts[2 * k] - ax, py = pts[2 * k + 1] - ay;
      const cr = px * dy - py * dx;
      const d = len2 ? (cr * cr) / len2 : px * px + py * py;
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push(i, best, best, j); }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[2 * k], pts[2 * k + 1]);
  return Float64Array.from(out);
}
