// Golden tests: the TypeScript port must reproduce the Python reference output
// (research/output/<save>/{world,offsets}.json) on both researched saves.
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decompressSave } from '../src/parser/decompress';
import { pyRound, pySum } from '../src/parser/bytes';
import { parseSave } from '../src/parser';
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

describe.skipIf(!savePath('1.sav'))('fzstd', () => {
  it('decompresses like native zstd', () => {
    const c = new Uint8Array(readFileSync(savePath('1.sav')!));
    const a = decompressSave(c), b = new Uint8Array(zstdDecompressSync(c));
    expect(a.length).toBe(b.length);
    expect(Buffer.compare(a, b)).toBe(0);
  });
});
