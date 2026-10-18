# Fever Calculator

Browser tool for planning cargo routes in Transport Fever 3. Upload a `.sav` to see water,
town centres and industries on a map, then draw routes between them. Saves are parsed
locally in the browser; no game mod is needed.

Research and format notes: [research/FINDINGS.md](research/FINDINGS.md)

Reference extractor: `research/scripts/fever_extract.py` (see FINDINGS §0).

## Development

Vite + Svelte 5 + TypeScript. The parser (`src/parser/`, a port of the Python reference) runs in a
Web Worker (`src/worker/`); the map is Leaflet in `CRS.Simple` with game metres as coordinates, and
routes are drawn with Leaflet-Geoman. Plans are stored per game in IndexedDB, with JSON export/import.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # golden tests: TS parser output == research/output/*/world.json
pnpm check      # svelte-check (TypeScript 7 via --tsgo)
pnpm build      # static site in dist/
```

The golden tests need the real saves `1.sav` and `2.sav` (fresh-game `test3.sav`–`test5.sav` and `big6.sav`–`big8.sav`, and the campaign save `Saving Mardi Gras1.sav`). They look in the Steam userdata folder
for TF3 (app 3493540), or in `$FEVER_SAVE_DIR`, and are skipped when the saves aren't there.
