// Traces contour lines off the main thread. The page starts one only when contours are first turned on.
import * as Comlink from 'comlink';
import type { Raster } from '../parser';
import { contours, type ContourLevel } from './contours';

const api = {
  contours(r: Raster, interval_m: number, progress: (fraction: number) => void): ContourLevel[] {
    const out = contours(r, interval_m, progress);
    return Comlink.transfer(out, out.flatMap((l) => l.lines.map((a) => a.buffer)));
  },
};

export type ContourApi = typeof api;
Comlink.expose(api);
