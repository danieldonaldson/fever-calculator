// Locates the real saves the golden tests run against. They are ~100 MB each and stay out of the repo:
// set FEVER_SAVE_DIR, or the tests look in the Steam userdata folder for TF3 (app 3493540).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function saveDir(): string | null {
  if (process.env.FEVER_SAVE_DIR) return process.env.FEVER_SAVE_DIR;
  const root = join(homedir(), '.local/share/Steam/userdata');
  if (!existsSync(root)) return null;
  for (const user of readdirSync(root)) {
    const d = join(root, user, '3493540/local/save');
    if (existsSync(d)) return d;
  }
  return null;
}

export function savePath(name: string): string | null {
  const d = saveDir();
  const p = d && join(d, name);
  return p && existsSync(p) ? p : null;
}
