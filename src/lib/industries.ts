// Industry metadata from the base game files (FINDINGS §7).
import chains from '../data/industry_chains.json';
import names from '../data/industry_names_en.json';
import type { Town } from '../parser';

export interface Chain { inputs: string[]; outputs: string[] }

const CHAINS = chains as Record<string, Chain>;
const NAMES = names as Record<string, string>;

// One emoji per base-game industry type: the icon of its main output cargo (see CARGO_ICONS).
const ICONS: Record<string, string> = {
  brewery: '🍾', bricks_works: '🧱', cement_plant: '🪣', chemical_plant: '🎨', clay_pit: '🏺',
  coal_mine: '⚫', cotton_farm: '🧶', farm: '🌾', fishing_grounds: '🐠', food_factory: '🥫',
  forest: '🪵', furniture_factory: '🛋️', glass_works: '🪟', iron_ore_mine: '🟠', livestock_farm: '🥩',
  machine_factory: '⚙️', oil_platform: '💧', oil_refinery: '🔥', oil_well: '💧', paper_mill: '📄',
  printing_press: '📚', quarry: '🪨', rubber_farm: '🌴', sand_excavator: '🏜️', sand_pit: '🏜️',
  saw_mill: '🟫', steel_mill: '🏗️', textile_factory: '👕', tire_factory: '🛞', tool_factory: '🔧',
  vehicle_factory: '🚗', weaving_mill: '🧵',
};

export const industryName = (type: string) => NAMES[type] ?? type.replaceAll('_', ' ');
export type LabelMode = 'zoom' | 'always' | 'off';

export const industryIcon = (type: string) => ICONS[type] ?? '🏭';
export const chainOf = (type: string): Chain => CHAINS[type] ?? { inputs: [], outputs: [] };
export const cargoName = (c: string) => c.replaceAll('_', ' ');

const CARGO_ICONS: Record<string, string> = {
  beverages: '🍾', books: '📚', bricks: '🧱', cement: '🪣', chemicals: '🧪', clay: '🏺', clothes: '👕',
  coal: '⚫', crude_oil: '💧', dyes: '🎨', fabric: '🧵', fertilizer: '🌱', fish: '🐠', fuel: '🔥',
  furniture: '🛋️', glass: '🪟', grain: '🌾', iron_ore: '🟠', logs: '🪵', machines: '⚙️', meat: '🥩',
  paper: '📄', planks: '🟫', plastic: '🟪', rubber: '🌴', sand: '🏜️', sawdust: '🪚', sheet_metal: '🔩',
  steel: '🏗️', stone: '🪨', tinned_food: '🥫', tires: '🛞', tools: '🔧', vegetables: '🥬', vehicles: '🚗',
  wool: '🧶',
};
export const cargoIcon = (c: string) => CARGO_ICONS[c] ?? '📦';

/** Industry types whose output includes `cargo`. */
export const producersOf = (cargo: string) =>
  Object.entries(CHAINS).filter(([, c]) => c.outputs.includes(cargo)).map(([t]) => t);

/** "½" / "¼" suffix for a town need's factor; nothing for 1. */
export const factorLabel = (f: number) => (f === 1 ? '' : f === 0.5 ? '½' : f === 0.25 ? '¼' : `×${f}`);

/**
 * What the map highlights: an industry type with its supply chain, or the cargos a town district needs.
 * `null` role = no highlight active.
 */
export type District = 'commercial' | 'industrial';
export type Highlight =
  | { kind: 'industry'; type: string }
  | { kind: 'district'; town: number; district: District; label: string; cargos: string[] };

export const districtHighlight = (t: Town, district: District): Highlight =>
  ({ kind: 'district', town: t.id, district, label: `${t.name} ${district}`, cargos: t.demand[district].map((d) => d.cargo) });
export type Role = 'self' | 'supplier' | 'consumer' | 'dim' | null;

export function roleFn(h: Highlight | null): (type: string) => Role {
  if (!h) return () => null;
  if (h.kind === 'district') {
    return (type) => (chainOf(type).outputs.some((o) => h.cargos.includes(o)) ? 'supplier' : 'dim');
  }
  const p = partners(h.type);
  return (type) => (type === h.type ? 'self' : p.suppliers.has(type) ? 'supplier' : p.consumers.has(type) ? 'consumer' : 'dim');
}

/** Towns involved in a highlight: the pinned district's town, or towns whose districts want an industry's output. */
export function townRoleFn(h: Highlight | null): (t: Town) => Role {
  if (!h) return () => null;
  if (h.kind === 'district') return (t) => (t.id === h.town ? 'self' : 'dim');
  const outputs = chainOf(h.type).outputs;
  return (t) => ((['commercial', 'industrial'] as const)
    .some((k) => t.demand[k].some((d) => outputs.includes(d.cargo))) ? 'consumer' : 'dim');
}

export const ROLES = ['self', 'supplier', 'consumer', 'dim'] as const;

export const sameHighlight = (a: Highlight | null, b: Highlight | null) => JSON.stringify(a) === JSON.stringify(b);

/** Types that produce one of `type`'s inputs, and types that take one of its outputs. */
export function partners(type: string) {
  const { inputs, outputs } = chainOf(type);
  const suppliers = new Set<string>(), consumers = new Set<string>();
  for (const [t, c] of Object.entries(CHAINS)) {
    if (c.outputs.some((o) => inputs.includes(o))) suppliers.add(t);
    if (c.inputs.some((i) => outputs.includes(i))) consumers.add(t);
  }
  return { suppliers, consumers };
}
