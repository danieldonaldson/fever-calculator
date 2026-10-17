// Route plans, stored per game in IndexedDB, with JSON export/import.
import { get, set } from 'idb-keyval';
import type { Offsets, World } from '../parser';

export interface Route { id: string; name: string; color: string; points: [number, number][] }
export interface Plan { app: 'fever-calculator'; version: 1; game: string; routes: Route[] }

export const PALETTE = ['#d6336c', '#1c7ed6', '#f08c00', '#2b8a3e', '#7048e8', '#0c8599', '#e8590c', '#5c940d'];

/**
 * A game, not a file: town ids and map extent don't change as a game is saved over time,
 * so every autosave of one game opens the same plan.
 */
export const gameKey = (world: World, offsets: Offsets) =>
  `towns:${offsets.town_ids.join(',')}|extent:${world.terrain.extent_m.join(',')}`;

export const routeLength = (r: Route) =>
  r.points.slice(1).reduce((m, p, i) => m + Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]), 0);

export async function loadPlan(game: string): Promise<Route[]> {
  try {
    return ((await get(`plan:${game}`)) as Plan | undefined)?.routes ?? [];
  } catch {
    return [];
  }
}

export async function savePlan(game: string, routes: Route[]) {
  const plan: Plan = { app: 'fever-calculator', version: 1, game, routes };
  try {
    await set(`plan:${game}`, JSON.parse(JSON.stringify(plan)));
  } catch (e) {
    console.warn('could not save plan', e);
  }
}

export function exportPlan(game: string, routes: Route[], fileName: string) {
  const plan: Plan = { app: 'fever-calculator', version: 1, game, routes };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 1)], { type: 'application/json' }));
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importPlan(file: File): Promise<Plan> {
  const p = JSON.parse(await file.text());
  const ok = p?.app === 'fever-calculator' && p.version === 1 && Array.isArray(p.routes) &&
    p.routes.every((r: Route) => typeof r.id === 'string' && Array.isArray(r.points) &&
      r.points.every((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)));
  if (!ok) throw new Error('not a Fever Calculator plan file');
  return p as Plan;
}

export const newId = () => crypto.randomUUID();
