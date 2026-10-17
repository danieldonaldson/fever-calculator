import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { it } from 'vitest';
import { Bytes, ascii, findAll } from '../src/parser/bytes';
import { savePath } from './saves';
const w = (s: string) => process.stderr.write(s + '\n');
const latin1 = new TextDecoder('latin1');
it('logbooks', () => {
  const b = new Bytes(new Uint8Array(zstdDecompressSync(readFileSync(savePath('2.sav')!))));
  // a log at q: u32 len, name [A-Za-z0-9_], u32 n, n×i64, u32 n, n×i64
  const logAt = (q: number): { name: string; end: number; n: number } | null => {
    const L = b.u32(q); if (L < 2 || L > 64) return null;
    const name = latin1.decode(b.u8.subarray(q + 4, q + 4 + L)); if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return null;
    const p = q + 4 + L, n = b.u32(p); if (n > 100000) return null;
    const v = p + 4 + 8 * n; if (v + 4 > b.length || b.u32(v) !== n) return null;
    return { name, end: v + 4 + 8 * n, n };
  };
  const prod = findAll(b.u8, ascii('itemsProduced')).map((h) => h - 4).filter((q) => logAt(q)?.name.startsWith('itemsProduced'));
  const YEAR = 730500;
  const rates: string[] = [];
  for (const q of prod) {
    const l = logAt(q)!; const L = b.u32(q); const p = q + 4 + L, n = l.n;
    const t = (i: number) => Number(b.dv.getBigInt64(p + 4 + 8 * i, true));
    const v = (i: number) => Number(b.dv.getBigInt64(p + 4 + 8 * n + 4 + 8 * i, true));
    const tN = t(n - 1); let j = n - 1; while (j > 0 && t(j) > tN - YEAR) j--;
    const rate = (v(n - 1) - v(j)) * YEAR / Math.max(1, tN - t(j));
    rates.push(`${rate.toFixed(0).padStart(6)}/yr  ${l.name.padEnd(16)} @${q} n=${n}`);
  }
  rates.sort((a, z) => parseFloat(z) - parseFloat(a));
  const around = (lo: number, hi: number) => {
    w(`--- logs in ${lo}..${hi}`);
    for (let q = lo; q < hi; q++) {
      const l = logAt(q); if (!l || l.n < 2) continue;
      const L = b.u32(q); const p = q + 4 + L, n = l.n;
      const t = (i: number) => Number(b.dv.getBigInt64(p + 4 + 8 * i, true));
      const v = (i: number) => Number(b.dv.getBigInt64(p + 4 + 8 * n + 4 + 8 * i, true));
      const tN = t(n - 1); let j = n - 1; while (j > 0 && t(j) > tN - YEAR) j--;
      const rate = (v(n - 1) - v(j)) * YEAR / Math.max(1, tN - t(j));
      w(`  @${q} ${l.name.padEnd(22)} n=${String(n).padStart(4)} rate ${(2 * rate).toFixed(0).padStart(6)}/yr  pre=${[...b.u8.subarray(q - 20, q)].map((c) => c.toString(16).padStart(2, '0')).join(' ')}`);
      q = l.end - 1;
    }
  };
  around(30276000, 30340000);
  // separator between the previous entity's last log and this entity's first
  const prevEnd = logAt(30276771)!.end;
  w(`gap ${prevEnd}..30279942 (${30279942 - prevEnd} bytes): ` + Array.from({ length: (30279942 - prevEnd) / 4 + 1 }, (_, i) => b.u32(prevEnd + 4 * i)).join(' '));
  const lastEnd = logAt(30326729)!.end;
  w(`after itemsConsumed: ` + Array.from({ length: 24 }, (_, i) => b.u32(lastEnd + 4 * i)).join(' '));
  for (const r of rates.filter((r) => { const x = parseFloat(r); return (x > 500 && x < 650) || (x > 780 && x < 900) || (x > 250 && x < 320); })) w('RATE ' + r);
  return;
  w(`itemsProduced logs: ${prod.length}`);
  const keyset: string[] = [];
  for (const q of prod) {
    const l = logAt(q)!;
    const pre = Array.from({ length: 6 }, (_, i) => b.u32(q - 24 + 4 * i));
    // yearly rate: last value minus value one year earlier (time unit unknown: print last times)
    const p = q + 4 + 13, n = l.n;
    const t = (i: number) => Number(b.dv.getBigInt64(p + 4 + 8 * i, true));
    const v = (i: number) => Number(b.dv.getBigInt64(p + 4 + 8 * n + 4 + 8 * i, true));
    keyset.push(`@${q} pre[${pre.join(' ')}] n=${n} t0=${t(0)} tN=${t(n - 1)} v0=${v(0)} vN=${v(n - 1)}`);
  }
  for (const k of keyset) w(k);
  return;
  const starts = new Set<number>();
  for (const pre of ['items', 'happiness', 'capacity']) for (const h of findAll(b.u8, ascii(pre))) if (logAt(h - 4)) starts.add(h - 4);
  const sorted = [...starts].sort((a, z) => a - z);
  const isEnd = new Set<number>(); const ends = new Map<number, number>();
  for (const q of sorted) { const l = logAt(q)!; ends.set(q, l.end); isEnd.add(l.end); }
  // book starts: logs not preceded by another log's end
  const books = sorted.filter((q) => !isEnd.has(q));
  w(`logs ${sorted.length}, books ${books.length}`);
  for (const q0 of books.slice(0, 12)) {
    const names: string[] = []; let q = q0;
    while (ends.has(q)) { const l = logAt(q)!; names.push(`${l.name}(${l.n})`); q = l.end; }
    const before = Array.from({ length: 8 }, (_, i) => b.u32(q0 - 32 + 4 * i)).join(' ');
    w(`@${q0} [${before}] ${names.join(', ')}`);
  }
});
