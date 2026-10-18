// Runs the whole pipeline off the main thread: read, decompress, parse, draw terrain.
// The page creates one worker per save and terminates it afterwards to release the decompressed save (~400 MB, GBs for big saves).
import * as Comlink from 'comlink';
import { decompressSave } from '../parser/decompress';
import { parseSave, type Offsets, type Raster, type World } from '../parser';
import { terrainPng } from './render';

export interface Loaded {
  world: World;
  offsets: Offsets;
  warnings: string[];
  /** hillshaded terrain PNG; the flat one is drawn from `raster` on the page when first shown */
  terrain: { shaded: Blob };
  raster: Raster;
  timings: [string, number][];
}

const api = {
  async load(file: File, progress: (step: string) => void): Promise<Loaded> {
    const timings: [string, number][] = [];
    let step = 'Decompressing', t = performance.now();
    const mark = (next: string) => {
      const now = performance.now();
      timings.push([step, Math.round(now - t)]);
      step = next; t = now;
      progress(next);
    };
    progress(step);
    const data = await decompressSave(file);
    mark('Parsing');
    const r = parseSave(data, file.name, (s) => mark(s));
    mark('Drawing terrain');
    const shaded = await terrainPng(r.raster, true);
    mark('Done');
    const out: Loaded = { world: r.world, offsets: r.offsets, warnings: r.warnings, terrain: { shaded }, raster: r.raster, timings };
    return Comlink.transfer(out, [r.raster.heights.buffer]);
  },
};

export type ParseApi = typeof api;
Comlink.expose(api);
