// Terrain images from the raw heightmap: flat water/land (FINDINGS §8 colours) and a hillshaded variant.
import { RAW_PER_M, RAW_ZERO, type Raster } from '../parser';

const LAND = [225, 225, 218];
const WATER = [70, 110, 160];
const WATER_SHALLOW = [104, 144, 190];
const EXAGGERATION = 2;
// light from the north-west, 45° up; x east, y north, z up
const LIGHT = (() => {
  const v = [-1, 1, Math.SQRT2];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

export function terrainPixels(r: Raster, shaded: boolean): Uint8ClampedArray<ArrayBuffer> {
  const { heights: h, width: W, height: H, sample_m } = r;
  const px = new Uint8ClampedArray(W * H * 4);
  const flat = LIGHT[2];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col, o = i * 4, raw = h[i];
      let c: number[];
      if (raw < RAW_ZERO) {
        if (!shaded) c = WATER;
        else {
          const t = Math.min(1, (RAW_ZERO - raw) / RAW_PER_M / 15); // full depth colour at 15 m
          c = WATER_SHALLOW.map((s, k) => s + (WATER[k] - s) * t);
        }
      } else if (!shaded) c = LAND;
      else {
        // central differences in metres; row - 1 is north
        const e = h[row * W + Math.min(W - 1, col + 1)], w = h[row * W + Math.max(0, col - 1)];
        const n = h[Math.max(0, row - 1) * W + col], s = h[Math.min(H - 1, row + 1) * W + col];
        const dzdx = ((e - w) / RAW_PER_M) * EXAGGERATION / (2 * sample_m);
        const dzdy = ((n - s) / RAW_PER_M) * EXAGGERATION / (2 * sample_m);
        const len = Math.hypot(dzdx, dzdy, 1);
        const lum = Math.max(0, (-dzdx * LIGHT[0] - dzdy * LIGHT[1] + LIGHT[2]) / len) / flat;
        const f = 0.55 + 0.45 * Math.min(lum, 1.25);
        c = LAND.map((v) => v * f);
      }
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  return px;
}

export async function terrainPng(r: Raster, shaded: boolean): Promise<Blob> {
  const canvas = new OffscreenCanvas(r.width, r.height);
  canvas.getContext('2d')!.putImageData(new ImageData(terrainPixels(r, shaded), r.width, r.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
