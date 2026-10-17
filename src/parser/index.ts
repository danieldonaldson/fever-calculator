// Fever Calculator save parser: decompressed TF3 .sav -> world. Port of research/scripts/fever_extract.py.
import { Bytes, pyRound } from './bytes';
import { constructions } from './constructions';
import { edges, type Edge } from './edges';
import { heightmap, raster, TILE_M, type Raster } from './heightmap';
import { nameTable } from './names';
import { townBuildings, townIds, towns, type Town } from './towns';

export type { Raster } from './heightmap';
export type { Town, Kind } from './towns';
export type { Edge } from './edges';
export { sampleEdge } from './edges';
export { RAW_ZERO, RAW_PER_M } from './heightmap';

export interface WorldIndustry { type: string; x: number; y: number; z: number }

/** Same schema as research/output/<save>/world.json. */
export interface World {
  source: string;
  coords: string;
  terrain: {
    tile_m: number;
    samples_per_tile: number;
    sample_m: number;
    tiles_x: [number, number];
    tiles_y: [number, number];
    extent_m: [number, number, number, number];
    height_formula: string;
    water: string;
  };
  towns: Town[];
  industries: WorldIndustry[];
  /** railway track edges (not in the Python reference) */
  rails: Edge[];
}

export interface Offsets {
  decompressed_size: number;
  industry_first: number | null;
  building_first: number | null;
  names_count: number;
  names_entries: number;
  town_entity_first: number | null;
  town_building_first: number;
  heightmap_list: number;
  heightmap_data: number;
  heightmap_end: number;
  town_ids: number[];
}

export interface ParseResult { world: World; offsets: Offsets; raster: Raster; warnings: string[] }

export type Progress = (step: string) => void;

const MAGIC = [0x74, 0x66, 0x2a, 0x2a]; // tf**

export function isDecompressedSave(d: Uint8Array): boolean {
  return MAGIC.every((c, i) => d[i] === c);
}

export function parseSave(data: Uint8Array, source: string, progress: Progress = () => {}): ParseResult {
  if (!isDecompressedSave(data)) throw new Error('not a TF3 save (missing tf** magic after decompression)');
  const b = new Bytes(data);
  const warnings: string[] = [];

  progress('Reading industries and buildings');
  const { industries, buildings, first } = constructions(b);

  progress('Reading names');
  const nt = nameTable(b);
  if (nt.warning) warnings.push(nt.warning);

  progress('Finding towns');
  const { ids, first: teOff } = townIds(b);
  if (!ids.length) throw new Error('no town ids found (no townEntity records)');
  const tb = townBuildings(b, ids);
  if (tb.towns.length !== buildings.length) {
    warnings.push(`TownBuilding count ${tb.towns.length} != building constructions ${buildings.length}`);
  }
  const tw = towns(buildings, tb.towns, ids, nt.names);
  if (tw.warning) warnings.push(tw.warning);

  progress('Reading railways');
  const rails = edges(b).filter((e) => e.network === 'track');

  progress('Reading terrain');
  const hm = heightmap(b);
  const xs = hm.tiles.map((t) => t[0]), ys = hm.tiles.map((t) => t[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  const world: World = {
    source,
    coords: 'world metres, origin at map centre, +x east, +y north',
    terrain: {
      tile_m: TILE_M, samples_per_tile: hm.side, sample_m: TILE_M / (hm.side - 1),
      tiles_x: [x0, x1], tiles_y: [y0, y1],
      extent_m: [x0 * TILE_M, y0 * TILE_M, (x1 + 1) * TILE_M, (y1 + 1) * TILE_M],
      height_formula: 'raw / 20 - 100', water: 'raw < 2000 (water level 0 m)',
    },
    towns: tw.towns,
    industries: industries.map((i) => ({ type: i.type, x: pyRound(i.x, 1), y: pyRound(i.y, 1), z: pyRound(i.z, 2) })),
    rails,
  };
  const offsets: Offsets = {
    decompressed_size: data.length,
    industry_first: first.industry ?? null, building_first: first.building ?? null,
    names_count: nt.offset, names_entries: nt.names.length,
    town_entity_first: teOff, town_building_first: tb.first,
    heightmap_list: hm.list_offset, heightmap_data: hm.data_offset, heightmap_end: hm.end_offset,
    town_ids: ids,
  };
  return { world, offsets, raster: raster(b, hm), warnings };
}
