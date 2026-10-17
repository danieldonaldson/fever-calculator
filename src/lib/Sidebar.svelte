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
    <div>
      <h1>Fever Calculator</h1>
      <p class="muted">{world.source} · {world.towns.length} towns · {world.industries.length} industries</p>
    </div>
    <button class="open" onclick={onOpen}>Open save…</button>
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
    <label><input type="checkbox" bind:checked={showRails} /> Railways <span class="beta">beta</span>
      <span class="muted">{railKm(world.rails)}</span></label>
    <label class="select">Industry labels
      <select bind:value={industryLabels}>
        <option value="zoom">when zoomed in</option>
        <option value="always">always</option>
        <option value="off">off</option>
      </select>
    </label>
  </section>

  <section>
    <div class="row">
      <h2>Routes</h2>
      <span class="muted">{routes.length ? km(total) : ''}</span>
    </div>
    <div class="buttons">
      <button class="primary" onclick={onDraw}>Draw route</button>
      <button onclick={onExport} disabled={!routes.length}>Export</button>
      <button onclick={() => importInput.click()}>Import</button>
      <input bind:this={importInput} type="file" accept=".json,application/json" hidden
        onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onImport(f); e.currentTarget.value = ''; }} />
    </div>
    {#if !routes.length}
      <p class="muted">Click points on the map; click the last point again to finish. Lines snap to towns and industries.</p>
    {/if}
    <ul>
      {#each routes as r (r.id)}
        <li class="route">
          <input type="color" bind:value={r.color} title="Colour" />
          <input class="name" bind:value={r.name} aria-label="Route name" />
          <span class="muted">{km(routeLength(r))}</span>
          <button class="icon" onclick={() => onFly(...r.points[0])} title="Show">◎</button>
          <button class="icon" onclick={() => onDelete(r.id)} title="Delete">✕</button>
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>Towns</h2>
    <ul>
      {#each towns as t (t.id)}
        {@const c = t.centers.residential ?? Object.values(t.centers)[0]}
        <li>
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
    <h2>Industries</h2>
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
    display: flex;
    flex-direction: column;
    gap: 18px;
    height: 100%;
    overflow-y: auto;
    padding: 16px;
    background: var(--panel);
    color: var(--text);
    border-right: 1px solid var(--border);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .open {
    flex: none;
    white-space: nowrap;
  }
  h1 {
    margin: 0;
    font-size: 18px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  p {
    margin: 4px 0;
  }
  .beta {
    font-size: 0.7em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.05em 0.4em;
    border: 1px solid var(--accent);
    border-radius: 999px;
    color: var(--accent);
  }

  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .warning {
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--warn-bg);
    font-size: 13px;
  }
  label {
    display: block;
    font-size: 14px;
    padding: 2px 0;
  }
  .select {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  select {
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 14px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .buttons {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }
  .link {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 4px 6px;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    text-align: left;
  }
  .link:hover,
  .link.active {
    background: var(--hover);
  }
  .link.pinned,
  .need.pinned {
    background: var(--hover);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .role-self > span:first-child,
  .role-supplier > span:first-child,
  .role-consumer > span:first-child {
    font-weight: 700;
  }
  .role-self > span:first-child {
    color: #9632c8;
  }
  .role-supplier > span:first-child {
    color: #e03131;
  }
  .role-consumer > span:first-child {
    color: #15aabf;
  }
  .role-dim {
    opacity: 0.45;
  }
  .industry {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .locate {
    border: none;
    background: none;
    color: var(--muted);
  }
  .needs {
    display: flex;
    gap: 4px;
    padding: 0 6px 4px;
  }
  .need {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px 1px 2px;
    border: none;
    border-radius: 4px;
    background: none;
    font-size: 14px;
  }
  .need:hover,
  .need.active {
    background: var(--hover);
  }
  .tag {
    margin-right: 3px;
    padding: 0 4px;
    border-radius: 3px;
    background: #285adc;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
  }
  .tag.ind {
    background: #f08c14;
  }
  .cargo sub {
    font-size: 9px;
    color: var(--muted);
  }
  .emoji {
    display: inline-block;
    width: 1.6em;
  }
  .route {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
  }
  .route .name {
    flex: 1;
    min-width: 0;
  }
  input[type='color'] {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: none;
  }
  .icon {
    padding: 2px 6px;
  }
</style>
