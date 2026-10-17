import * as Comlink from 'comlink';
import type { Loaded, ParseApi } from '../worker/parse.worker';

export type { Loaded };

/** Parse a save in a fresh worker, then terminate it so its memory is freed. */
export async function loadSave(file: File, progress: (step: string) => void): Promise<Loaded> {
  const worker = new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await Comlink.wrap<ParseApi>(worker).load(file, Comlink.proxy(progress));
  } finally {
    worker.terminate();
  }
}
