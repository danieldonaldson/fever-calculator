// zstd decompression behind one function. The WASM decoder is about 3x faster than pure-JS fzstd
// (2.sav: ~600 ms vs ~2 s) and, unlike most WASM builds, streams frames without a content size,
// which TF3 saves leave out.
//
// Big saves decompress to several times their size (2.sav: 99 MB -> 392 MB), so the input is fed
// in slices and each slice's output is appended to one resizable buffer that grows in place.
// The library's own decompress() collects chunks and then concatenates them, which needs twice the
// output in memory, and it refuses output over ~600 MB; per-slice calls stay far below that limit.
import { createDecoder } from 'zstd-wasm-decoder/perf';

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const SLICE = 1 << 20;
/** guessed decompressed/compressed ratio for the first allocation; real saves are ~3.5-4x */
const RATIO = 4;

export const isZstd = (d: Uint8Array) => ZSTD_MAGIC.every((c, i) => d[i] === c);

/** A resizable buffer with the largest maximum this engine accepts (virtual space only). */
function growable(initial: number): ArrayBuffer {
  for (const max of [2 ** 33, 2 ** 32, 2 ** 31 - 1]) {
    try {
      return new ArrayBuffer(Math.min(initial, max), { maxByteLength: max });
    } catch { /* over this engine's limit; try a smaller maximum */ }
  }
  throw new Error('this browser cannot allocate a buffer large enough for the save');
}

async function* slices(src: Blob | Uint8Array): AsyncGenerator<Uint8Array> {
  if (src instanceof Uint8Array) {
    for (let o = 0; o < src.length; o += SLICE) yield src.subarray(o, o + SLICE);
    return;
  }
  // Read the file in slices too, so the compressed bytes are never all in memory at once.
  for (let o = 0; o < src.size; o += SLICE) yield new Uint8Array(await src.slice(o, o + SLICE).arrayBuffer());
}

/** Decompress a .sav; already-decompressed input is returned as is. */
export async function decompressSave(src: Blob | Uint8Array): Promise<Uint8Array> {
  const size = src instanceof Uint8Array ? src.length : src.size;
  const head = src instanceof Uint8Array ? src : new Uint8Array(await src.slice(0, 4).arrayBuffer());
  if (!isZstd(head)) return src instanceof Uint8Array ? src : new Uint8Array(await src.arrayBuffer());

  const decoder = await createDecoder();
  const buf = growable(size * RATIO);
  let out = new Uint8Array(buf), n = 0, first = true;
  for await (const slice of slices(src)) {
    const chunk = decoder.decompressStream(slice, first).buf;
    first = false;
    if (n + chunk.length > buf.byteLength) {
      const want = Math.max(n + chunk.length, Math.ceil(buf.byteLength * 1.5));
      if (n + chunk.length > buf.maxByteLength) throw new Error(`save decompresses to over ${Math.floor(buf.maxByteLength / 2 ** 30)} GB, more than this browser can hold`);
      buf.resize(Math.min(want, buf.maxByteLength));
      out = new Uint8Array(buf);
    }
    out.set(chunk, n);
    n += chunk.length;
  }
  // Browsers reject views of a resizable buffer in TextDecoder.decode() and other web APIs
  // ("The provided ArrayBuffer value must not be resizable"), so hand out a fixed-length one.
  return new Uint8Array(buf.transferToFixedLength(n));
}
