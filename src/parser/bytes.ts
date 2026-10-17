// Little-endian readers and byte search over the decompressed save.
// Readers throw RangeError past the end, which callers treat like Python's struct.error.

export class Bytes {
  readonly u8: Uint8Array;
  readonly dv: DataView;
  readonly length: number;

  constructor(u8: Uint8Array) {
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.length = u8.length;
  }

  u32(o: number): number { return this.dv.getUint32(o, true); }
  i32(o: number): number { return this.dv.getInt32(o, true); }
  f32(o: number): number { return this.dv.getFloat32(o, true); }
  f64(o: number): number { return this.dv.getFloat64(o, true); }

  /** Byte-for-byte comparison of `needle` at offset `o`. */
  eq(o: number, needle: Uint8Array): boolean {
    if (o < 0 || o + needle.length > this.length) return false;
    for (let k = 0; k < needle.length; k++) if (this.u8[o + k] !== needle[k]) return false;
    return true;
  }
}

export const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

export const le32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

export const concat = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/**
 * Every start offset of `needle`, overlapping matches included (like a regex lookahead).
 * Uses the native single-byte indexOf for the first byte, then checks the rest:
 * about 2 GB/s in V8, several times faster than a plain loop.
 */
export function findAll(h: Uint8Array, needle: Uint8Array): number[] {
  const out: number[] = [];
  const f = needle[0], L = needle.length, end = h.length - L;
  let i = h.indexOf(f);
  while (i !== -1 && i <= end) {
    let k = 1;
    while (k < L && h[i + k] === needle[k]) k++;
    if (k === L) out.push(i);
    i = h.indexOf(f, i + 1);
  }
  return out;
}

/** Python's round(x, nd): correctly rounded, ties to even, on the exact binary value. */
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const [ip, fp] = Math.abs(x).toFixed(100).split('.');
  const keep = fp.slice(0, nd), rest = fp.slice(nd);
  let n = BigInt(ip + keep);
  const tie = rest[0] === '5' && /^0*$/.test(rest.slice(1));
  if (rest[0] > '5' || (rest[0] === '5' && !tie) || (tie && n % 2n === 1n)) n += 1n;
  const s = n.toString().padStart(nd + 1, '0');
  const v = parseFloat(nd ? `${s.slice(0, -nd)}.${s.slice(-nd)}` : s);
  return neg ? -v : v;
}

/** Python 3.12+ sum() of floats: Neumaier compensated summation. */
export function pySum(xs: Iterable<number>): number {
  let s = 0, c = 0;
  for (const x of xs) {
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += (s - t) + x;
    else c += (x - t) + s;
    s = t;
  }
  return c && Number.isFinite(c) ? s + c : s;
}
