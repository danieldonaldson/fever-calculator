// Runs the whole pipeline off the main thread: read, decompress, parse, draw terrain.
// The page creates one worker per save and terminates it afterwards to release the ~400 MB buffer.
import * as Comlink from 'comlink';
import { decompressSave } from '../parser/decompress';
import { parseSave, type Offsets, type World } from '../parser';
import { terrainPng } from './render';

export interface Loaded {
  world: World;
  offsets: Offsets;
  warnings: string[];
  terrain: { flat: Blob; shaded: Blob };
  timings: [string, number][];
}

const api = {
  async load(file: File, progress: (step: string) => void): Promise<Loaded> {
    const timings: [string, number][] = [];
    let step = 'Reading file', t = performance.now();
    const mark = (next: string) => {
      const now = performance.now();
      timings.push([step, Math.round(now - t)]);
      step = next; t = now;
      progress(next);
    };
    progress(step);
    const input = new Uint8Array(await file.arrayBuffer());
    mark('Decompressing');
    const data = decompressSave(input);
    mark('Parsing');
    const r = parseSave(data, file.name, (s) => mark(s));
    mark('Drawing terrain');
    const [flat, shaded] = await Promise.all([terrainPng(r.raster, false), terrainPng(r.raster, true)]);
    mark('Done');
    return { world: r.world, offsets: r.offsets, warnings: r.warnings, terrain: { flat, shaded }, timings };
  },
};

export type ParseApi = typeof api;
Comlink.expose(api);
