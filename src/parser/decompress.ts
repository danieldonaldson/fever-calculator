// zstd decompression behind one function, so the pure-JS decoder can be swapped for a WASM build.
import { decompress } from 'fzstd';

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export const isZstd = (d: Uint8Array) => ZSTD_MAGIC.every((c, i) => d[i] === c);

/** Decompress a .sav; already-decompressed input is returned as is. */
export function decompressSave(d: Uint8Array): Uint8Array {
  return isZstd(d) ? decompress(d) : d;
}
