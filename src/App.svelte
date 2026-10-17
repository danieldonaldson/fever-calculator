<script lang="ts">
  import MapView from './lib/MapView.svelte';
  import Sidebar from './lib/Sidebar.svelte';
  import Landing from './lib/Landing.svelte';
  import { loadContours, loadSave, type ContourLevel, type Loaded } from './lib/load';
  import { terrainPng } from './worker/render';
  import { sameHighlight, type Highlight, type LabelMode } from './lib/industries';
  import { PALETTE, exportPlan, gameKey, importPlan, loadPlan, newId, savePlan, type Route } from './lib/plans';

  type State =
    | { status: 'idle' }
    | { status: 'loading'; step: string; started: number }
    | { status: 'error'; message: string }
    | {
        status: 'ready'; data: Loaded; terrain: { flat?: string; shaded: string }; game: string;
        /** by spacing in metres, traced the first time that spacing is shown; the fraction done while tracing */
        contours: Record<number, ContourLevel[] | number>;
      };

  let s: State = $state({ status: 'idle' });
  let routes: Route[] = $state([]);
  let shaded = $state(true);
  let showContours = $state(false);
  let contourM = $state(10);
  let showRails = $state(false);
  let industryLabels: LabelMode = $state('zoom');
  let preview: Highlight | null = $state(null);
  let pinned: Highlight | null = $state(null);
  /** clicking the pinned thing again unpins it */
  const pin = (h: Highlight | null) => (pinned = h && !sameHighlight(pinned, h) ? h : null);
  let dragging = $state(false);
  let fileInput: HTMLInputElement;
  let mapView: MapView | undefined = $state();

  async function open(file: File) {
    if (s.status === 'ready') {
      if (s.terrain.flat) URL.revokeObjectURL(s.terrain.flat);
      URL.revokeObjectURL(s.terrain.shaded);
    }
    const started = performance.now();
    s = { status: 'loading', step: 'Reading file', started };
    try {
      const data = await loadSave(file, (step) => { if (s.status === 'loading') s.step = step; });
      console.info(`loaded ${file.name}: ` + data.timings.map(([k, ms]) => `${k} ${ms} ms`).join(', '));
      const game = gameKey(data.world, data.offsets);
      routes = await loadPlan(game);
      pinned = preview = null;
      s = {
        status: 'ready', data, game,
        terrain: { shaded: URL.createObjectURL(data.terrain.shaded) }, contours: {},
      };
    } catch (e) {
      console.error(e);
      s = { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  // the flat terrain image is only drawn once hillshade is first turned off
  $effect(() => {
    if (s.status !== 'ready' || shaded || s.terrain.flat) return;
    const ready = s;
    terrainPng(ready.data.raster, false).then((blob) => {
      if (s === ready) ready.terrain.flat = URL.createObjectURL(blob);
    });
  });

  // contours are only traced once they're shown, once per spacing
  $effect(() => {
    if (s.status !== 'ready' || !showContours || s.contours[contourM] !== undefined) return;
    const ready = s, m = contourM;
    ready.contours[m] = 0;
    loadContours($state.snapshot(ready.data.raster), m, (f) => { ready.contours[m] = f; }).then(
      (c) => { ready.contours[m] = c; },
      (e) => { console.error(e); delete ready.contours[m]; if (s === ready) showContours = false; },
    );
  });

  // persist the plan whenever routes change
  $effect(() => {
    const snapshot = $state.snapshot(routes);
    if (s.status === 'ready') savePlan(s.game, snapshot);
  });

  function create(points: [number, number][]): Route {
    const r: Route = { id: newId(), name: `Route ${routes.length + 1}`, color: PALETTE[routes.length % PALETTE.length], points };
    routes.push(r);
    return r;
  }
  function edit(id: string, points: [number, number][]) {
    const r = routes.find((r) => r.id === id);
    if (r) r.points = points;
  }
  function remove(id: string) {
    routes = routes.filter((r) => r.id !== id);
  }

  async function doImport(f: File) {
    if (s.status !== 'ready') return;
    try {
      const plan = await importPlan(f);
      if (plan.game !== s.game && !confirm('This plan was made for a different game. Import anyway?')) return;
      if (routes.length && !confirm(`Replace the ${routes.length} current route(s)?`)) return;
      routes = plan.routes;
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files[0];
    if (f) open(f);
  }

  let now = $state(performance.now());
  $effect(() => {
    if (s.status !== 'loading') return;
    const t = setInterval(() => (now = performance.now()), 100);
    return () => clearInterval(t);
  });
</script>

<svelte:window
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={(e) => { if (!e.relatedTarget) dragging = false; }}
  ondrop={onDrop}
/>

<input bind:this={fileInput} type="file" accept=".sav" hidden
  onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) open(f); e.currentTarget.value = ''; }} />

{#if s.status === 'ready'}
  {@const ready = s}
  {@const traced = ready.contours[contourM]}
  {@const tracing = showContours && typeof traced === 'number' ? traced : null}
  <div class="layout">
    <Sidebar
      world={ready.data.world} warnings={ready.data.warnings}
      bind:routes bind:shaded bind:showContours bind:contourM contoursTracing={tracing !== null} bind:showRails bind:industryLabels bind:preview {pinned} onPin={pin}
      onOpen={() => fileInput.click()}
      onFly={(x, y) => mapView?.flyTo(x, y)}
      onDraw={() => mapView?.drawRoute()}
      onDelete={remove}
      onExport={() => exportPlan(ready.game, $state.snapshot(routes), ready.data.world.source.replace(/\.sav$/, '') + '-plan.json')}
      onImport={doImport}
    />
    <main>
      {#key ready.data}
        <MapView bind:this={mapView}
          world={ready.data.world} terrain={shaded ? ready.terrain.shaded : ready.terrain.flat ?? ready.terrain.shaded} {showRails} {industryLabels} {routes}
          contours={showContours && Array.isArray(traced) ? traced : null} contourIndexM={5 * contourM} {preview} {pinned} onPin={pin}
          onCreate={create} onEdit={edit} onRemove={remove} />
      {/key}
      {#if tracing !== null}
        <div class="map-status" role="status">
          <span class="spinner"></span>Tracing {contourM} m contours… {Math.round(tracing * 100)}%
        </div>
      {/if}
    </main>
  </div>
{:else}
  <Landing
    loading={s.status === 'loading' ? { step: s.step, seconds: (now - s.started) / 1000 } : null}
    error={s.status === 'error' ? s.message : null}
    onOpen={() => fileInput.click()} />
{/if}

{#if dragging}
  <div class="drop">Drop the .sav to open it</div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100vh;
  }
  main {
    position: relative;
    min-width: 0;
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: 60vh 1fr;
    }
    main {
      grid-row: 1;
    }
  }
  .map-status {
    position: absolute;
    top: 12px;
    left: 50%;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--muted);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .drop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: grid;
    place-items: center;
    background: rgb(28 126 214 / 0.25);
    color: #fff;
    font-size: 24px;
    font-weight: 600;
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
    pointer-events: none;
  }
</style>
