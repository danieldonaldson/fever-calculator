// NAME table: all entity names in entity-id order (FINDINGS §4).
import { ascii, concat, findAll, le32, type Bytes } from './bytes';

const NONAME = concat(le32(7), ascii('no name'));
const strict = new TextDecoder('utf-8', { fatal: true });

/** u32-length UTF-8 string at p, or null if too long, invalid, or containing control chars. */
function strAt(b: Bytes, p: number, maxlen = 400): string | null {
  const n = b.u32(p);
  if (n > maxlen) return null;
  let t: string;
  try {
    t = b.str(strict, p + 4, p + 4 + n);
  } catch {
    return null;
  }
  for (const c of t) if (c.codePointAt(0)! < 32) return null;
  return t;
}

/**
 * Densest run of internal "no name" entries, then walk back to the first string.
 * The u32 just before the first string is the entry count.
 */
export function nameTable(b: Bytes): { names: string[]; offset: number; warning?: string } {
  const hits = findAll(b.u8, NONAME);
  if (!hits.length) throw new Error('NAME table not found (no "no name" entries)');
  const runs: number[][] = [];
  let cur = [hits[0]];
  for (const h of hits.slice(1)) {
    if (h - cur[cur.length - 1] < 8192) cur.push(h);
    else { runs.push(cur); cur = [h]; }
  }
  runs.push(cur);
  const run = runs.reduce((a, r) => (r.length > a.length ? r : a));

  let p = run[0];
  for (;;) {
    // find q with q + 4 + len == p
    let prev: number | null = null;
    for (let q = p - 4; q >= Math.max(p - 404, 0); q--) {
      if (q + 4 + b.u32(q) === p) {
        if (strAt(b, q) !== null) prev = q;
        break;
      }
    }
    if (prev === null) break;
    p = prev;
  }
  const start = p, count = b.u32(p - 4);
  const names: string[] = [];
  let q = start;
  for (let i = 0; i < count; i++) {
    const t = strAt(b, q, 100_000);
    if (t === null) break;
    names.push(t);
    q += 4 + b.u32(q);
  }
  const warning = names.length !== count ? `NAME header says ${count}, read ${names.length}` : undefined;
  return { names, offset: start - 4, warning };
}
