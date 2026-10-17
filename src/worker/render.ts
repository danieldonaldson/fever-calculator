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

/**
 * RGBA pixels, north up. Hot loop over ~8M samples: no per-pixel allocation, water colours come
 * from a table by raw height, and pixels are written as one u32 each (RGBA little-endian).
 */
export function terrainPixels(r: Raster, shaded: boolean): Uint8ClampedArray<ArrayBuffer> {
  const { heights: h, width: W, height: H, sample_m } = r;
  const px = new Uint8ClampedArray(W * H * 4);
  const out = new Uint32Array(px.buffer);
  const rgba = (c: number[], f = 1) => {
    const ch = new Uint8ClampedArray([c[0] * f, c[1] * f, c[2] * f, 255]);
    return new Uint32Array(ch.buffer)[0];
  };
  const land = rgba(LAND);
  if (!shaded) {
    const water = rgba(WATER);
    for (let i = 0; i < W * H; i++) out[i] = h[i] < RAW_ZERO ? water : land;
    return px;
  }
  // water: shallow to deep over the first 15 m
  const water = new Uint32Array(RAW_ZERO);
  for (let raw = 0; raw < RAW_ZERO; raw++) {
    const t = Math.min(1, (RAW_ZERO - raw) / RAW_PER_M / 15);
    water[raw] = rgba(WATER_SHALLOW.map((s, k) => s + (WATER[k] - s) * t));
  }
  const [L0, L1, L2] = LIGHT, flat = L2;
  const k = EXAGGERATION / (RAW_PER_M * 2 * sample_m);
  const [R, G, B] = LAND;
  for (let row = 0; row < H; row++) {
    const rn = Math.max(0, row - 1) * W, rs = Math.min(H - 1, row + 1) * W, rc = row * W;
    for (let col = 0; col < W; col++) {
      const i = rc + col, raw = h[i];
      if (raw < RAW_ZERO) { out[i] = water[raw]; continue; }
      // central differences in metres; row - 1 is north
      const dzdx = (h[rc + Math.min(W - 1, col + 1)] - h[rc + Math.max(0, col - 1)]) * k;
      const dzdy = (h[rn + col] - h[rs + col]) * k;
      const lum = Math.max(0, (-dzdx * L0 - dzdy * L1 + L2) / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1)) / flat;
      const f = 0.55 + 0.45 * Math.min(lum, 1.25);
      const o = i * 4;
      px[o] = R * f; px[o + 1] = G * f; px[o + 2] = B * f; px[o + 3] = 255;
    }
  }
  return px;
}

export async function terrainPng(r: Raster, shaded: boolean): Promise<Blob> {
  const canvas = new OffscreenCanvas(r.width, r.height);
  canvas.getContext('2d')!.putImageData(new ImageData(terrainPixels(r, shaded), r.width, r.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
