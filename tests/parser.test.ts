// Golden tests: the TypeScript port must reproduce the Python reference output
// (research/output/<save>/{world,offsets}.json) on both researched saves.
import { readFileSync } from 'node:fs';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decompressSave } from '../src/parser/decompress';
import { pyRound, pySum } from '../src/parser/bytes';
import { parseSave } from '../src/parser';
import { Bytes } from '../src/parser/bytes';
import { townBuildings, townIds, towns } from '../src/parser/towns';
import type { Building } from '../src/parser/constructions';
import { savePath } from './saves';

const research = (p: string) => new URL(`../research/${p}`, import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(research(p), 'utf8'));

describe('python numerics', () => {
  it('pyRound rounds ties to even on the exact binary value', () => {
    expect(pyRound(0.25, 1)).toBe(0.2);
    expect(pyRound(0.35, 1)).toBe(0.3); // 0.35 is 0.34999… in binary
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(-49.45, 1)).toBe(-49.5); // -49.45 is -49.4500000000000028…
    expect(pyRound(1.5, 0)).toBe(2);
    expect(pyRound(2.5, 0)).toBe(2);
  });
  it('pySum is compensated like Python 3.12+', () => {
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6);
    expect(pySum([1e100, 1, -1e100])).toBe(1);
  });
});

for (const [save, out] of [['2.sav', '2sav'], ['1.sav', '1sav']] as const) {
  const path = savePath(save);
  describe.skipIf(!path)(`golden ${save}`, () => {
    const raw = path ? new Uint8Array(zstdDecompressSync(readFileSync(path))) : new Uint8Array();
    const r = path ? parseSave(raw, save) : null!;

    it('matches world.json', () => {
      const { rails, ...rest } = r.world; // rails and demand are TS-only
      const towns = rest.towns.map(({ demand, ...t }) => t);
      expect({ ...rest, towns }).toEqual(json(`output/${out}/world.json`));
    });
    it('reads district cargo demand from building params', () => {
      for (const t of r.world.towns) {
        expect(t.demand.commercial.length).toBeGreaterThan(0);
        expect(t.demand.industrial.length).toBeGreaterThan(0);
        for (const d of [...t.demand.commercial, ...t.demand.industrial]) {
          expect(d.cargo).toMatch(/^[a-z_]+$/);
          expect(d.buildings).toBeLessThanOrEqual(t.buildings);
        }
      }
    });
    it('reads railway edges as a connected network', () => {
      const { rails } = r.world;
      expect(rails.length).toBeGreaterThan(1000);
      expect(rails.every((e) => e.network === 'track')).toBe(true);
      const [x0, y0, x1, y1] = r.world.terrain.extent_m;
      for (const e of rails) {
        expect(e.p[0]).toBeGreaterThanOrEqual(x0); expect(e.p[2]).toBeLessThanOrEqual(x1);
        expect(e.p[1]).toBeGreaterThanOrEqual(y0); expect(e.p[3]).toBeLessThanOrEqual(y1);
      }
      // most track nodes join exactly two edges; dead ends and switches are the minority
      const deg = new Map<number, number>();
      for (const e of rails) for (const n of [e.node0, e.node1]) deg.set(n, (deg.get(n) ?? 0) + 1);
      const two = [...deg.values()].filter((d) => d === 2).length;
      expect(two / deg.size).toBeGreaterThan(0.6);
      // bridges sit above the terrain, tunnels below it
      const { heights, width, height, x0: rx, y0: ry, sample_m } = r.raster;
      const above = (e: (typeof rails)[number]) => {
        const x = (e.p[0] + e.p[2]) / 2, y = (e.p[1] + e.p[3]) / 2;
        const g = heights[(height - 1 - Math.round((y - ry) / sample_m)) * width + Math.round((x - rx) / sample_m)] / 20 - 100;
        return (e.z[0] + e.z[1]) / 2 - g;
      };
      const median = (v: number[]) => v.sort((a, z) => a - z)[v.length >> 1];
      const bridges = rails.filter((e) => e.structure === 'bridge').map(above);
      const tunnels = rails.filter((e) => e.structure === 'tunnel').map(above);
      if (bridges.length) expect(median(bridges)).toBeGreaterThan(3);
      if (tunnels.length) expect(median(tunnels)).toBeLessThan(-3);
    });
    it('matches offsets.json', () => expect(r.offsets).toEqual(json(`output/${out}/offsets.json`)));
    it('has no warnings', () => expect(r.warnings).toEqual([]));
    it('rasterises the heightmap north-up, matching industry heights (FINDINGS §6)', () => {
      const { width, height, heights, x0, y0, sample_m } = r.raster;
      expect([width, height]).toEqual([44 * 64, 44 * 64]);
      const land = r.world.industries.filter((i) => i.z !== 0);
      const off = land.filter((i) => {
        const col = Math.round((i.x - x0) / sample_m), row = height - 1 - Math.round((i.y - y0) / sample_m);
        return Math.abs(heights[row * width + col] / 20 - 100 - i.z) > 0.5;
      });
      expect(off).toEqual([]);
    });
  });
}

// Fresh games: most towns have no townEntity record, and some towns share a building count.
for (const [save, n] of [['test3.sav', 5], ['test4.sav', 16], ['test5.sav', 21]] as const) {
  const path = savePath(save);
  describe.skipIf(!path)(save, () => {
    it(`finds all ${n} towns, each paired with its own records`, () => {
      const r = parseSave(new Uint8Array(zstdDecompressSync(readFileSync(path!))), save);
      expect(r.warnings).toEqual([]);
      expect(r.world.towns.length).toBe(n);
      expect(new Set(r.world.towns.map((t) => t.name)).size).toBe(n);
      const ids = r.offsets.town_ids;
      expect(ids).toEqual(ids.map((_, i) => ids[0] + i));
    });
  });
}

describe.skipIf(!savePath('test5.sav'))('town search', () => {
  it('ignores seeds outside the town records', () => {
    const b = new Bytes(new Uint8Array(zstdDecompressSync(readFileSync(savePath('test5.sav')!))));
    const { ids: seeds } = townIds(b);
    const want = townBuildings(b, seeds);
    const got = townBuildings(b, [...seeds, 5_000_000, -1, NaN]);
    expect(got.ids).toEqual(want.ids);
    expect(got.records.length).toBe(want.records.length);
  });
});

// Campaign mission 01: a 32×32 map with an extra block before the heightmap samples, and towns whose
// ids aren't consecutive (names for 15346, 29612, … per the mission's mission_localization_01.tl).
describe.skipIf(!savePath('Saving Mardi Gras1.sav'))('Saving Mardi Gras1.sav', () => {
  it('finds the heightmap and names only the town it can link', () => {
    const path = savePath('Saving Mardi Gras1.sav')!;
    const r = parseSave(new Uint8Array(zstdDecompressSync(readFileSync(path))), 'Saving Mardi Gras1.sav');
    expect(r.world.terrain.tiles_x).toEqual([-16, 15]);
    expect(r.offsets.town_ids).toEqual([13698, 15346, 29612, 38967, 44318]);
    expect(r.world.towns.map((t) => t.name).sort()).toEqual(
      ['New Orleans', 'Town 15346', 'Town 29612', 'Town 38967', 'Town 44318']);
    expect(r.warnings).toContain("4 town names can't be read (town ids aren't consecutive)");
  });
});

describe('town pairing', () => {
  // Footprint histograms: clusters A {p} and B {p:3, r}; towns X {p:2} and Y {p, q:2}.
  // Cheapest pair first (A-X, then B-Y) costs 1 + 5; the best pairing (A-Y, B-X) costs 2 + 2.
  const bld = (footprint: string, x: number): Building =>
    ({ kind: 'r', capacity: 1, cargo: [], footprint, x, y: 0, offset: 0 });
  const blds = [bld('p', 0), ...['p', 'p', 'p', 'r'].map((f, i) => bld(f, 10_000 + 10 * i))];
  const recs = ['p', 'p'].map((footprint) => ({ town: 10, footprint }))
    .concat(['p', 'q', 'q'].map((footprint) => ({ town: 11, footprint })));

  it('minimises the total distance', () => {
    const { towns: out } = towns(blds, recs, [10, 11], ['', 'X', 'Y']);
    expect(out.map((t) => [t.name, t.buildings])).toEqual([['X', 4], ['Y', 1]]);
  });
  it('looks names up by id, so a town missing from the records keeps the right name', () => {
    const { towns: out } = towns(blds, recs.map((r) => ({ ...r, town: r.town === 11 ? 12 : r.town })), [10, 12], ['', 'X', 'Y', 'Z']);
    expect(out.map((t) => t.name)).toEqual(['X', 'Z']);
  });
});

describe('zstd output buffer', () => {
  it('is fixed-length, which browser TextDecoder requires', async () => {
    const raw = new TextEncoder().encode('fever '.repeat(500_000));
    const a = await decompressSave(new Uint8Array(zstdCompressSync(raw)));
    expect((a.buffer as ArrayBuffer).resizable).toBe(false);
    expect(Buffer.compare(a, raw)).toBe(0);
  });
});

describe.skipIf(!savePath('1.sav'))('zstd', () => {
  it('decompresses like native zstd', async () => {
    const c = new Uint8Array(readFileSync(savePath('1.sav')!));
    const a = await decompressSave(c), b = new Uint8Array(zstdDecompressSync(c));
    expect(a.length).toBe(b.length);
    expect(Buffer.compare(a, b)).toBe(0);
  });
});
