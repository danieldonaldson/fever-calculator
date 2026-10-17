// zstd decompression behind one function. The WASM decoder is about 3x faster than pure-JS fzstd
// (2.sav: ~600 ms vs ~2 s) and, unlike most WASM builds, streams frames without a content size,
// which TF3 saves leave out.
import { decompress } from 'zstd-wasm-decoder/perf';

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export const isZstd = (d: Uint8Array) => ZSTD_MAGIC.every((c, i) => d[i] === c);

/** Decompress a .sav; already-decompressed input is returned as is. */
export async function decompressSave(d: Uint8Array): Promise<Uint8Array> {
  return isZstd(d) ? decompress(d) : d;
}
