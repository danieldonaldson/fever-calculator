<script lang="ts">
  import type { World } from '../parser';
  import {
    cargoIcon, cargoName, districtHighlight, factorLabel, industryIcon, industryName, roleFn, sameHighlight, townRoleFn,
    type Highlight, type LabelMode,
  } from './industries';
  import { routeLength, type Route } from './plans';
  import { km } from './format';

  interface Props {
    world: World;
    warnings: string[];
    routes: Route[];
    shaded: boolean;
    showContours: boolean;
    /** contour spacing in metres */
    contourM: number;
    /** contours are being traced */
    contoursTracing: boolean;
    showRails: boolean;
    industryLabels: LabelMode;
    preview: Highlight | null;
    pinned: Highlight | null;
    onPin: (h: Highlight | null) => void;
    onOpen: () => void;
    onFly: (x: number, y: number) => void;
    onDraw: () => void;
    onDelete: (id: string) => void;
    onExport: () => void;
    onImport: (f: File) => void;
  }
  let {
    world, warnings, routes = $bindable(), shaded = $bindable(), showContours = $bindable(), contourM = $bindable(), contoursTracing, showRails = $bindable(), industryLabels = $bindable(),
    preview = $bindable(), pinned, onPin, onOpen, onFly, onDraw, onDelete, onExport, onImport,
  }: Props = $props();

  const towns = $derived([...world.towns].sort((a, z) => z.population - a.population));
  const types = $derived.by(() => {
    const m = new Map<string, { x: number; y: number }[]>();
    for (const i of world.industries) (m.get(i.type) ?? m.set(i.type, []).get(i.type)!).push(i);
    return [...m].map(([type, list]) => ({ type, name: industryName(type), list })).sort((a, z) => a.name.localeCompare(z.name));
  });
  const active = $derived(pinned ?? preview);
  const railKm = (rails: World['rails']) =>
    rails.length ? km(rails.reduce((s, e) => s + Math.hypot(e.p[2] - e.p[0], e.p[3] - e.p[1]), 0)) : 'none';
  const industryRole = $derived(roleFn(active));
  const townRole = $derived(townRoleFn(active));
  const total = $derived(routes.reduce((s, r) => s + routeLength(r), 0));

  let importInput: HTMLInputElement;
  // cycle through instances of a type on repeated clicks
  const cursor = new Map<string, number>();
  function flyToType(type: string, list: { x: number; y: number }[]) {
    const n = cursor.get(type) ?? 0;
    cursor.set(type, (n + 1) % list.length);
    onFly(list[n].x, list[n].y);
  }
</script>

<aside>
  <header>
    <div class="brand">
      <svg class="roundel" viewBox="0 0 32 20" width="34" height="21" aria-hidden="true">
        <circle cx="16" cy="10" r="7.5" fill="none" stroke="#ffc300" stroke-width="3.5" />
        <rect x="2" y="7.6" width="28" height="4.8" rx="1" fill="currentColor" />
      </svg>
      <h1>Fever Calculator</h1>
      <button class="open" onclick={onOpen}>Open save…</button>
    </div>
    <div class="file">
      <code title={world.source}>{world.source}</code>
      <span>{world.towns.length} towns</span>
      <span>{world.industries.length} industries</span>
    </div>
  </header>

  {#each warnings as w}
    <p class="warning">{w}</p>
  {/each}

  <section>
    <h2>Map</h2>
    <label><input type="checkbox" bind:checked={shaded} /> Hillshade</label>
    <div class="select">
      <label><input type="checkbox" bind:checked={showContours} /> Contours
        {#if contoursTracing}<span class="muted">tracing…</span>{/if}</label>
      <select bind:value={contourM} disabled={!showContours} aria-label="Contour spacing" title="Spacing; every 5th line is heavier">
        {#each [5, 10, 20, 50] as m}<option value={m}>every {m} m</option>{/each}
      </select>
    </div>
    <label class="rails"><input type="checkbox" bind:checked={showRails} /> Railways <span class="beta">beta</span>
      <span class="muted right">{railKm(world.rails)}</span></label>
    <label class="select">Industry labels
      <select bind:value={industryLabels}>
        <option value="zoom">when zoomed in</option>
        <option value="always">always</option>
        <option value="off">off</option>
      </select>
    </label>
  </section>

  <section>
    <h2>Routes {#if routes.length}<span class="count">{routes.length} · {km(total)}</span>{/if}</h2>
    <div class="buttons">
      <button class="primary" onclick={onDraw}>Draw route</button>
      <button onclick={onExport} disabled={!routes.length}>Export</button>
      <button onclick={() => importInput.click()}>Import</button>
      <input bind:this={importInput} type="file" accept=".json,application/json" hidden
        onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onImport(f); e.currentTarget.value = ''; }} />
    </div>
    {#if !routes.length}
      <p class="hint">Click points on the map; click the last point again to finish. Lines snap to towns and industries.</p>
    {/if}
    <ul>
      {#each routes as r (r.id)}
        <li class="route">
          <label class="swatch" style:--c={r.color} title="Colour">
            <input type="color" bind:value={r.color} aria-label="Route colour" />
          </label>
          <input class="name" bind:value={r.name} aria-label="Route name" />
          <span class="muted">{km(routeLength(r))}</span>
          <button class="icon" onclick={() => onFly(...r.points[0])} title="Show">◎</button>
          <button class="icon" onclick={() => onDelete(r.id)} title="Delete">✕</button>
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>Towns <span class="count">{towns.length}</span></h2>
    <ul class="line">
      {#each towns as t (t.id)}
        {@const c = t.centers.residential ?? Object.values(t.centers)[0]}
        <li class="stop">
          <button class="link role-{townRole(t) ?? 'none'}" onclick={() => c && onFly(...c)}>
            <span>{t.name}</span><span class="muted">{t.population.toLocaleString()}</span>
          </button>
          <div class="needs">
            {#each (['commercial', 'industrial'] as const) as kind}
              {@const needs = t.demand[kind]}
              {@const h = districtHighlight(t, kind)}
              <button class="need" class:active={sameHighlight(preview, h)} class:pinned={sameHighlight(pinned, h)}
                onmouseenter={() => (preview = h)} onmouseleave={() => (preview = null)}
                onclick={() => onPin(h)}
                title={`${kind}: ${needs.map((d) => cargoName(d.cargo) + factorLabel(d.factor)).join(', ') || 'no needs yet'} (click to pin)`}>
                <span class="tag" class:ind={kind === 'industrial'}>{kind === 'commercial' ? 'C' : 'I'}</span>
                {#each needs as d}<span class="cargo">{cargoIcon(d.cargo)}{#if d.factor !== 1}<sub>{factorLabel(d.factor)}</sub>{/if}</span>{:else}<span class="muted">–</span>{/each}
              </button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>Industries <span class="count">{types.length} types</span></h2>
    <ul>
      {#each types as { type, name, list } (type)}
        {@const h: Highlight = { kind: 'industry', type }}
        <li class="industry">
          <button class="link role-{industryRole(type) ?? 'none'}" class:active={sameHighlight(preview, h)}
            class:pinned={sameHighlight(pinned, h)}
            onmouseenter={() => (preview = h)} onmouseleave={() => (preview = null)}
            onclick={() => onPin(h)} title="Click to pin">
            <span><span class="emoji">{industryIcon(type)}</span>{name}</span><span class="muted">{list.length}</span>
          </button>
          <button class="icon locate" onclick={() => flyToType(type, list)} title="Show the next one on the map">◎</button>
        </li>
      {/each}
    </ul>
  </section>
</aside>

<style>
  aside {
    --text: var(--on-navy);
    --muted: var(--on-navy-muted);
    --border: var(--navy-line);
    --hover: var(--navy-2);
    --bg: var(--navy-2);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    background: var(--navy);
    color: var(--on-navy);
    scrollbar-color: var(--navy-3) transparent;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 16px 18px 14px;
    background: var(--navy);
    box-shadow: 0 1px 0 var(--navy-line), 0 6px 12px -6px rgb(0 0 0 / 0.4);
  }
  /* a yellow line along the top edge, like a line-coloured sign band */
  header::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 4px;
    background: var(--signal);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .roundel {
    flex: none;
    color: var(--on-navy);
  }
  .open {
    flex: none;
    margin-left: auto;
    white-space: nowrap;
    font-size: 13px;
  }
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.1;
    text-transform: uppercase;
  }
  .file {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-top: 10px;
    color: var(--muted);
    font-size: 12px;
  }
  .file code {
    overflow: hidden;
    max-width: 100%;
    padding: 1px 6px 0;
    border-radius: 4px;
    background: var(--signal);
    color: var(--signal-ink);
    font-size: 11.5px;
    font-weight: 700;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
    word-break: normal;
  }
  .file span {
    line-height: 19px;
  }
  .file span + span::before {
    content: '·';
    margin-right: 10px;
  }
  section {
    padding: 18px 18px 14px;
  }
  /* section headings as a thick line marker: ━━ MAP ━━━━━━ count */
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    color: var(--on-navy);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1;
  }
  h2::before {
    content: '';
    flex: none;
    width: 18px;
    height: 5px;
    border-radius: 3px;
    background: var(--signal);
  }
  h2::after {
    content: '';
    order: 1;
    flex: 1;
    height: 2px;
    border-radius: 1px;
    background: var(--navy-line);
  }
  .count {
    order: 2;
    color: var(--muted);
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  p {
    margin: 4px 0;
  }
  .hint {
    margin: 10px 0 0;
    padding: 9px 11px 8px;
    border-left: 3px solid var(--signal);
    border-radius: 0 6px 6px 0;
    background: var(--navy-2);
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
  }
  .beta {
    font-size: 0.66em;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.15em 0.5em 0.05em;
    border-radius: 999px;
    background: var(--navy-3);
    color: var(--on-navy-muted);
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .warning {
    margin: 12px 18px 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--warn-bg);
    color: #14213d;
    font-size: 13px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    font-size: 14px;
    cursor: pointer;
  }
  .right {
    margin-left: auto;
  }
  .select {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .select > label {
    min-height: 0;
  }
  select {
    padding: 4px 8px 3px;
    font-size: 13px;
  }
  button:not(.primary, .link, .need) {
    border-color: var(--navy-line);
    background: var(--navy-2);
    color: var(--on-navy);
  }
  button:not(.primary, .link, .need):hover:not(:disabled) {
    background: var(--navy-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  .buttons .primary {
    flex: 1;
  }
  .link {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    width: 100%;
    padding: 5px 8px 4px;
    border: none;
    border-radius: 6px;
    background: none;
    color: inherit;
    font-weight: 500;
    text-align: left;
  }
  .link:hover,
  .link.active {
    background: var(--navy-2);
  }
  .link.pinned,
  .need.pinned {
    background: var(--navy-2);
    box-shadow: inset 0 0 0 2px var(--signal);
  }
  .role-self > span:first-child,
  .role-supplier > span:first-child,
  .role-consumer > span:first-child {
    font-weight: 800;
  }
  .role-self > span:first-child {
    color: var(--role-self);
  }
  .role-supplier > span:first-child {
    color: var(--role-supplier);
  }
  .role-consumer > span:first-child {
    color: var(--role-consumer);
  }
  .role-dim {
    opacity: 0.38;
  }

  /* towns as stops on a line, biggest first */
  .line {
    position: relative;
    padding-left: 22px;
  }
  .line::before {
    content: '';
    position: absolute;
    top: 12px;
    bottom: 22px;
    left: 7px;
    width: 4px;
    border-radius: 2px;
    background: var(--signal);
  }
  .stop {
    position: relative;
  }
  .stop::before {
    content: '';
    position: absolute;
    top: 7px;
    left: -19px;
    width: 10px;
    height: 10px;
    border: 3px solid var(--signal);
    border-radius: 50%;
    background: var(--navy);
  }
  .stop .link > span:first-child {
    font-weight: 700;
  }

  .industry {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .locate {
    border: none !important;
    background: none !important;
    color: var(--muted) !important;
  }
  .locate:hover:not(:disabled) {
    color: var(--signal) !important;
  }
  .needs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 4px;
    padding: 0 4px 8px;
  }
  .need {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 7px 1px 3px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--on-navy);
    font-size: 14px;
    font-weight: 400;
  }
  .need:hover,
  .need.active {
    background: var(--navy-2);
  }
  .tag {
    margin-right: 3px;
    padding: 1px 4px 0;
    border-radius: 3px;
    background: #285adc;
    color: #fff;
    font-size: 9.5px;
    font-weight: 800;
    line-height: 15px;
  }
  .tag.ind {
    background: #f08c14;
  }
  .cargo sub {
    font-size: 9px;
    color: var(--muted);
  }
  .emoji,
  .cargo {
    font-family: var(--emoji);
  }
  .emoji {
    display: inline-block;
    width: 1.6em;
  }

  ul:has(.route) {
    margin-top: 10px;
  }
  .route {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 6px;
    border-radius: 8px;
  }
  .route:hover {
    background: var(--navy-2);
  }
  .route .name {
    flex: 1;
    min-width: 0;
    border-color: transparent;
    background: none;
    font-weight: 700;
  }
  .route .name:hover,
  .route .name:focus {
    border-color: var(--navy-line);
    background: var(--navy);
  }
  .route .icon {
    border-color: transparent;
    background: none;
    color: var(--muted);
  }
  .route .icon:hover:not(:disabled) {
    background: var(--navy-3);
    color: var(--on-navy);
  }
  /* route colour as a thick line swatch; the native picker sits invisibly on top */
  .swatch {
    position: relative;
    flex: none;
    width: 28px;
    min-height: 0;
    height: 8px;
    border-radius: 4px;
    background: var(--c);
  }
  .swatch input {
    position: absolute;
    inset: -8px 0;
    width: 100%;
    height: calc(100% + 16px);
    opacity: 0;
    cursor: pointer;
  }
  .icon {
    padding: 2px 7px;
  }
</style>
