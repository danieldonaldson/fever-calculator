// Serialized Lua values (FINDINGS §2).
import type { Bytes } from './bytes';

export type LuaValue = boolean | number | string | LuaTable;
export type LuaTable = Map<LuaValue, LuaValue>;

export class Bad extends Error {}

const utf8 = new TextDecoder('utf-8'); // non-fatal: invalid bytes become U+FFFD, like 'replace'

export function luaValue(b: Bytes, p: number, depth = 0): [LuaValue, number] {
  const tag = b.u32(p); p += 4;
  switch (tag) {
    case 1:
      if (p >= b.length) throw new Bad('bool past end');
      return [b.u8[p] !== 0, p + 1];
    case 2:
      return [b.f64(p), p + 8];
    case 3: {
      const n = b.u32(p);
      if (n > 1_000_000) throw new Bad('string too long');
      return [utf8.decode(b.u8.subarray(p + 4, p + 4 + n)), p + 4 + n];
    }
    case 4:
      return luaTable(b, p + 1, depth + 1); // skip u8 flag
    default:
      throw new Bad(`unknown tag ${tag} at ${p - 4}`);
  }
}

/** u32 count + count × (key, value). Top-level params tables start here directly. */
export function luaTable(b: Bytes, p: number, depth = 0): [LuaTable, number] {
  if (depth > 32) throw new Bad('too deep');
  const n = b.u32(p); p += 4;
  if (n > 1_000_000) throw new Bad('table too big');
  const out: LuaTable = new Map();
  for (let i = 0; i < n; i++) {
    const [k, p1] = luaValue(b, p, depth);
    const [v, p2] = luaValue(b, p1, depth);
    out.set(k, v);
    p = p2;
  }
  return [out, p];
}

/** True for errors that mean "not a valid record here": parse failures and reads past the end. */
export const isParseError = (e: unknown): boolean => e instanceof Bad || e instanceof RangeError;
