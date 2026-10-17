import { describe, expect, it } from 'vitest';
import { RAW_PER_M, RAW_ZERO, type Raster } from '../src/parser';
import { contours } from '../src/worker/contours';

/** a cone 100 m high and 100 m in radius at the centre of a 101×101 grid of 2 m samples */
function cone(): Raster {
  const W = 101, heights = new Uint16Array(W * W);
  for (let row = 0; row < W; row++) {
    for (let col = 0; col < W; col++) {
      const d = Math.hypot(row - 50, col - 50) * 2;
      heights[row * W + col] = RAW_ZERO + Math.max(0, 100 - d) * RAW_PER_M;
    }
  }
  return { heights, width: W, height: W, x0: 0, y0: 0, sample_m: 2 };
}

describe('contours', () => {
  it('rings a cone once per level, at the right radius', () => {
    const levels = contours(cone(), 20);
    expect(levels.map((l) => l.level_m)).toEqual([20, 40, 60, 80]);
    // sample (50, 50) sits at the centre of its pixel: (101 m, 101 m)
    for (const { level_m, lines } of levels) {
      expect(lines).toHaveLength(1);
      const a = lines[0];
      expect([a[0], a[1]]).toEqual([a[a.length - 2], a[a.length - 1]]); // closed
      for (let k = 0; k < a.length; k += 2) {
        expect(Math.hypot(a[k] - 101, a[k + 1] - 101)).toBeCloseTo(100 - level_m, 0);
      }
    }
  });
  it('draws nothing on flat land', () => {
    const r = cone();
    r.heights.fill(RAW_ZERO + 10 * RAW_PER_M);
    expect(contours(r, 5)).toEqual([]);
  });
});
