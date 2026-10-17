<script lang="ts">
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import '@geoman-io/leaflet-geoman-free';
  import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
  import { onMount } from 'svelte';
  import { sampleEdge, type Edge, type Kind, type World } from '../parser';
  import {
    cargoIcon, cargoName, chainOf, districtHighlight, factorLabel, industryIcon, industryName, partners, producersOf, roleFn, ROLES,
    townRoleFn,
    type District, type Highlight, type LabelMode,
  } from './industries';
  import { routeLength, type Route } from './plans';
  import { km } from './format';

  interface Props {
    world: World;
    /** URL of the terrain image to show */
    terrain: string;
    showRails: boolean;
    industryLabels: LabelMode;
    routes: Route[];
    /** preview from the sidebar (hover) */
    preview: Highlight | null;
    /** pinned highlight: stays while drawing; wins over any hover */
    pinned: Highlight | null;
    /** toggle a pin; null clears it */
    onPin: (h: Highlight | null) => void;
    onCreate: (points: [number, number][]) => Route;
    onEdit: (id: string, points: [number, number][]) => void;
    onRemove: (id: string) => void;
  }
  let { world, terrain, showRails, industryLabels, routes, preview, pinned, onPin, onCreate, onEdit, onRemove }: Props = $props();

  const KIND_COLOR: Record<Kind, string> = { residential: '#28aa3c', commercial: '#285adc', industrial: '#f08c14' };
  const IND = { fill: '#9632c8', supplier: '#e03131', consumer: '#15aabf' };
  const LABEL_MIN_ZOOM = -2;

  let el: HTMLDivElement;
  let map: L.Map;
  let overlay: L.ImageOverlay;
  let rails: L.LayerGroup;
  let hover: Highlight | null = $state(null);
  let drawing = $state(false);
  const industryLayers: { type: string; layer: L.Marker }[] = [];
  const townLabels: { town: World['towns'][number]; label: L.Tooltip }[] = [];
  const districtLayers: { town: number; district: District; cargos: string[]; layer: L.Circle }[] = [];
  const routeLayers = new Map<string, L.Polyline>();

  // world metres -> Leaflet LatLng in CRS.Simple: lat = y (north), lng = x (east)
  const ll = (x: number, y: number) => L.latLng(y, x);
  const pts = (layer: L.Polyline): [number, number][] =>
    (layer.getLatLngs() as L.LatLng[]).map((p) => [Math.round(p.lng * 10) / 10, Math.round(p.lat * 10) / 10]);
  // Geoman's own layer options; the leaflet typings don't know them.
  const fixed = { pmIgnore: true, snapIgnore: false } as object;

  export function flyTo(x: number, y: number, zoom = -1) {
    map.flyTo(ll(x, y), zoom, { duration: 0.6 });
  }
  export function drawRoute() {
    map.pm.enableDraw('Line');
  }

  onMount(() => {
    const [x0, y0, x1, y1] = world.terrain.extent_m;
    const bounds = L.latLngBounds(ll(x0, y0), ll(x1, y1));
    map = L.map(el, {
      crs: L.CRS.Simple, minZoom: -5, maxZoom: 2, zoomSnap: 0.25, zoomDelta: 0.5,
      maxBounds: bounds.pad(0.25), attributionControl: false,
    });
    map.fitBounds(bounds);
    // panes: terrain < rails < town circles (overlayPane, 400) < markers
    map.createPane('terrain').style.zIndex = '200';
    map.createPane('rails').style.zIndex = '300';
    overlay = L.imageOverlay(terrain, bounds, { pane: 'terrain', pmIgnore: true, snapIgnore: true } as object).addTo(map);
    rails = railLayer(world.rails);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    // town names above industry labels (both are tooltips; tooltipPane is z-index 650)
    map.createPane('townLabels').style.zIndex = '655';

    // Town centres: one circle per kind, radius from FINDINGS §8 (8 + 0.75·√capacity px at 4 m/px).
    for (const t of world.towns) {
      for (const [kind, c] of Object.entries(t.centers) as [Kind, [number, number]][]) {
        const circle = L.circle(ll(...c), {
          ...fixed, radius: (8 + 0.75 * Math.sqrt(t.capacity[kind])) * 4,
          color: '#000', weight: 1.5, fillColor: KIND_COLOR[kind], fillOpacity: 0.65, className: 'district',
        }).addTo(map);
        if (kind === 'residential') {
          circle.bindTooltip(`${esc(t.name)} · residential ${t.capacity[kind].toLocaleString()}`);
          continue;
        }
        const needs = t.demand[kind];
        const h = districtHighlight(t, kind);
        districtLayers.push({ town: t.id, district: kind, cargos: needs.map((d) => d.cargo), layer: circle });
        circle
          .bindTooltip(
            `<b>${esc(t.name)}</b> · ${kind} ${t.capacity[kind].toLocaleString()}<br>` +
            (needs.length
              ? 'needs: ' + needs.map((d) => `${cargoIcon(d.cargo)} ${cargoName(d.cargo)}${factorLabel(d.factor)}`).join(', ')
              : 'no cargo needs yet'),
          )
          .on('click', () => onPin(h))
          .on('mouseover', () => (hover = h))
          .on('mouseout', () => (hover = null));
      }
      const home = t.centers.residential ?? Object.values(t.centers)[0];
      if (!home) continue;
      const label = L.tooltip({ permanent: true, direction: 'right', offset: [14, 0], className: 'town-label', interactive: false, pane: 'townLabels' })
        .setLatLng(ll(...home))
        .setContent(`<b>${esc(t.name)}</b> ${t.population.toLocaleString()}<small>res ${t.capacity.residential.toLocaleString()} · com ${t.capacity.commercial.toLocaleString()} · ind ${t.capacity.industrial.toLocaleString()}</small>`)
        .addTo(map);
      townLabels.push({ town: t, label });
    }

    for (const i of world.industries) {
      const h: Highlight = { kind: 'industry', type: i.type };
      const icon = L.divIcon({ className: 'industry-icon', html: `<span>${industryIcon(i.type)}</span>`, iconSize: [26, 26] });
      const layer = L.marker(ll(i.x, i.y), { ...fixed, icon, riseOnHover: true })
        .bindTooltip(industryName(i.type), { permanent: true, direction: 'bottom', offset: [0, 12], className: 'industry-label' })
        .on('click', () => onPin(h))
        .on('mouseover', () => (hover = h))
        .on('mouseout', () => (hover = null))
        .addTo(map);
      industryLayers.push({ type: i.type, layer });
    }

    map.pm.setGlobalOptions({
      snappable: true, snapDistance: 18, continueDrawing: false,
      pathOptions: { weight: 4 }, templineStyle: { weight: 3 }, hintlineStyle: { weight: 2, dashArray: '6,6' },
    } as L.PM.GlobalOptions);
    map.pm.addControls({
      position: 'topleft', drawMarker: false, drawCircleMarker: false, drawPolygon: false, drawRectangle: false,
      drawCircle: false, drawText: false, cutPolygon: false, rotateMode: false, dragMode: false, drawPolyline: true,
    });
    map.on('pm:create', (e) => {
      if (e.shape !== 'Line') { e.layer.remove(); return; }
      const layer = e.layer as L.Polyline;
      const r = onCreate(pts(layer));
      attach(r.id, layer);
    });
    map.on('pm:remove', (e) => {
      for (const [id, l] of routeLayers) if (l === e.layer) { routeLayers.delete(id); onRemove(id); }
    });
    // while drawing, clicks go through markers to the map (snapping still finds them)
    map.on('pm:drawstart', () => { drawing = true; hover = null; });
    map.on('pm:drawend', () => (drawing = false));
    map.on('zoomend', labelsByZoom);
    labelsByZoom();
    return () => map.remove();
  });

  /**
   * Railways in map style: a dark line with white dashes; electrified track in navy;
   * industry sidings thin and plain; bridges get a light casing with dark edges;
   * tunnels are faint and dashed. One multi-polyline per style on a canvas renderer.
   */
  function railLayer(edges: Edge[]): L.LayerGroup {
    const renderer = L.canvas({ pane: 'rails', padding: 0.5 });
    const line = (e: Edge) => sampleEdge(e).map(([x, y]) => ll(x, y));
    const base = { renderer, interactive: false, pmIgnore: true, snapIgnore: true, lineCap: 'butt' } as L.PolylineOptions;
    const group = L.layerGroup();
    const add = (es: Edge[], o: L.PolylineOptions) => { if (es.length) L.polyline(es.map(line), { ...base, ...o }).addTo(group); };
    const colour = (electric: boolean) => (electric ? '#1f4e8c' : '#2b2b2b');
    const tunnels = edges.filter((e) => e.structure === 'tunnel');
    const open = edges.filter((e) => e.structure !== 'tunnel');
    // tunnels first, underneath everything
    for (const electric of [false, true]) {
      add(tunnels.filter((e) => e.electric === electric && e.kind !== 'industry'),
        { color: colour(electric), weight: 3, opacity: 0.45, dashArray: '3 5' });
    }
    add(tunnels.filter((e) => e.kind === 'industry'), { color: '#5c5c5c', weight: 2, opacity: 0.45, dashArray: '3 5' });
    // bridge casing below the track
    const bridges = open.filter((e) => e.structure === 'bridge');
    add(bridges, { color: '#2b2b2b', weight: 10 });
    add(bridges, { color: '#f4f1e8', weight: 7.5 });
    add(open.filter((e) => e.kind === 'industry'), { color: '#5c5c5c', weight: 2 });
    for (const electric of [false, true]) {
      const es = open.filter((e) => e.kind !== 'industry' && e.electric === electric);
      add(es, { color: colour(electric), weight: 4 });
      add(es, { color: '#ffffff', weight: 1.6, dashArray: '6 6' });
    }
    return group;
  }

  function attach(id: string, layer: L.Polyline) {
    routeLayers.set(id, layer);
    layer.on('pm:edit', () => onEdit(id, pts(layer)));
  }

  function labelsByZoom() {
    // zoomed out: only the labels of highlighted industries show
    el.classList.toggle('no-industry-labels', industryLabels === 'off');
    el.classList.toggle('hide-industry-labels', industryLabels === 'zoom' && map.getZoom() < LABEL_MIN_ZOOM);
  }

  // terrain style
  $effect(() => {
    overlay?.setUrl(terrain);
  });
  $effect(() => {
    if (!rails) return;
    if (showRails) rails.addTo(map);
    else rails.remove();
  });
  $effect(() => {
    void industryLabels;
    if (map) labelsByZoom();
  });

  const active = $derived(pinned ?? hover ?? preview);

  // supply chain highlight: an industry with its suppliers and consumers, or a district's producers
  $effect(() => {
    const h = active;
    const roleOf = roleFn(h);
    for (const { type, layer } of industryLayers) {
      const role = roleOf(type);
      for (const e of [layer.getElement(), layer.getTooltip()?.getElement()]) {
        if (e) for (const c of ROLES) e.classList.toggle(c, c === role);
      }
      layer.setZIndexOffset(role && role !== 'dim' ? 1000 : 0);
    }
    // districts: the pinned one itself, or the ones that want an industry's output
    const outputs = h?.kind === 'industry' ? chainOf(h.type).outputs : [];
    for (const d of districtLayers) {
      const self = h?.kind === 'district' && h.town === d.town && h.district === d.district;
      const wants = d.cargos.some((c) => outputs.includes(c));
      d.layer.setStyle(self ? { color: IND.fill, weight: 5 } : wants ? { color: IND.consumer, weight: 5 } : { color: '#000', weight: 1.5 });
      if (self || wants) d.layer.bringToFront();
    }
    const townRole = townRoleFn(h);
    for (const { town, label } of townLabels) {
      const e = label.getElement(), role = townRole(town);
      if (e) for (const c of ROLES) e.classList.toggle(c, c === role);
    }
  });

  $effect(() => {
    el.classList.toggle('drawing', drawing);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && pinned && !drawing) onPin(null);
  }

  // mirror routes state onto the map
  $effect(() => {
    if (!map) return;
    const ids = new Set(routes.map((r) => r.id));
    for (const [id, layer] of routeLayers) if (!ids.has(id)) { layer.remove(); routeLayers.delete(id); }
    for (const r of routes) {
      let layer = routeLayers.get(r.id);
      if (!layer) {
        layer = L.polyline(r.points.map((p) => ll(...p)), { weight: 4 }).addTo(map);
        attach(r.id, layer);
      }
      layer.setStyle({ color: r.color, weight: 4, opacity: 0.9 });
      const tip = `${esc(r.name)} · ${km(routeLength(r))}`;
      if (layer.getTooltip()) layer.setTooltipContent(tip);
      else layer.bindTooltip(tip, { sticky: true });
    }
  });

  function esc(s: string) {
    return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  const countOf = (type: string) => world.industries.filter((i) => i.type === type).length;

  const townById = $derived(new Map(world.towns.map((t) => [t.id, t])));
  const industryList = (types: Iterable<string>) =>
    [...types].filter((p) => countOf(p) > 0).map((p) => `${industryIcon(p)} ${industryName(p)} ×${countOf(p)}`).join(', ');
  /** "Bacoli commercial" for every district that wants one of `cargos` */
  const wantedBy = (cargos: string[]) =>
    world.towns.flatMap((t) => (['commercial', 'industrial'] as const)
      .filter((k) => t.demand[k].some((d) => cargos.includes(d.cargo))).map((k) => `${t.name} ${k}`));
</script>

<svelte:window onkeydown={onKey} />

<div class="map" bind:this={el}></div>
{#if active}
  <div class="legend" class:pinned={active === pinned}>
    {#if active === pinned}
      <button class="close" onclick={() => onPin(null)} title="Unpin (Esc)">✕</button>
    {/if}
    {#if active.kind === 'industry'}
      {@const { inputs, outputs } = chainOf(active.type)}
      {@const p = partners(active.type)}
      {@const towns = wantedBy(outputs)}
      <b>{industryIcon(active.type)} {industryName(active.type)} ×{countOf(active.type)}</b>
      {#if inputs.length}
        <span>in: {inputs.map((c) => `${cargoIcon(c)} ${cargoName(c)}`).join(', ')}</span>
      {/if}
      {#if outputs.length}
        <span>out: {outputs.map((c) => `${cargoIcon(c)} ${cargoName(c)}`).join(', ')}</span>
      {/if}
      <span><i style:background={IND.fill}></i>{industryName(active.type)}</span>
      {@const sup = industryList(p.suppliers)}
      {@const con = industryList(p.consumers)}
      <span><i style:background={IND.supplier}></i>supplies it: {sup || 'none on this map'}</span>
      <span><i style:background={IND.consumer}></i>takes its output: {con || 'none on this map'}</span>
      {#if towns.length}
        <span><i class="ring" style:border-color={IND.consumer}></i>towns: {towns.join(', ')}</span>
      {/if}
    {:else}
      {@const t = townById.get(active.town)}
      {@const needs = t?.demand[active.district] ?? []}
      <b>{active.label} <span class="muted">{t?.capacity[active.district].toLocaleString()}</span></b>
      {#each needs as d}
        <span>{cargoIcon(d.cargo)} <b>{cargoName(d.cargo)}</b>{factorLabel(d.factor)} ← {industryList(producersOf(d.cargo)) || 'no producer'}</span>
      {:else}
        <span>no cargo needs yet</span>
      {/each}
      <span><i style:background={IND.supplier}></i>produces it</span>
    {/if}
    {#if !pinned}
      <span class="muted">click to pin</span>
    {:else if drawing}
      <span class="muted">drawing: click the last point again to finish</span>
    {/if}
  </div>
{/if}

<style>
  .map {
    position: absolute;
    inset: 0;
    background: var(--map-bg);
  }
  .legend {
    position: absolute;
    right: 12px;
    bottom: 24px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
    font-size: 13px;
    max-width: min(380px, calc(100% - 80px));
    pointer-events: none;
  }
  .legend.pinned {
    padding-right: 30px;
    outline: 2px solid var(--accent);
    pointer-events: auto;
  }
  .close {
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 0 6px;
    border: none;
    background: none;
    font-size: 13px;
  }
  .muted {
    color: var(--muted);
    font-weight: normal;
  }
  .legend i.ring {
    background: none;
    border-width: 2px;
  }
  .legend i {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 50%;
    border: 1px solid #000;
  }
  .map :global(.town-label) {
    padding: 2px 6px;
    border: none;
    background: rgb(255 255 255 / 0.85);
    box-shadow: none;
    color: #141414;
    font-size: 15px;
    line-height: 1.2;
  }
  .map :global(.town-label small) {
    display: block;
    color: #444;
    font-size: 11px;
  }
  .map :global(.town-label::before),
  .map :global(.industry-label::before) {
    display: none;
  }
  .map :global(.industry-icon span) {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 2px solid var(--ind);
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
    font-size: 15px;
    line-height: 1;
    transition: opacity 0.15s, transform 0.15s;
  }
  .map :global(.industry-icon) {
    --ind: #9632c8;
  }
  .map :global(.industry-icon.self span),
  .map :global(.industry-icon.supplier span),
  .map :global(.industry-icon.consumer span) {
    border-width: 3px;
    transform: scale(1.25);
  }
  .map :global(.industry-icon.supplier) {
    --ind: #e03131;
  }
  .map :global(.industry-icon.consumer) {
    --ind: #15aabf;
  }
  .map :global(.industry-icon.dim) {
    opacity: 0.25;
  }
  .map :global(.industry-label) {
    padding: 0 3px;
    border: none;
    background: rgb(255 255 255 / 0.7);
    box-shadow: none;
    color: #46146a;
    font-size: 11px;
  }
  .map:global(.drawing) :global(.industry-icon),
  .map:global(.drawing) :global(path.district) {
    pointer-events: none;
  }
  .map:global(.no-industry-labels) :global(.industry-label),
  .map:global(.hide-industry-labels) :global(.industry-label:not(.self, .supplier, .consumer)) {
    display: none;
  }
  .map :global(.industry-label.self),
  .map :global(.industry-label.supplier),
  .map :global(.industry-label.consumer) {
    z-index: 1;
    padding: 1px 5px;
    border-radius: 3px;
    background: #fff;
    font-size: 12px;
    font-weight: 700;
  }
  .map :global(.industry-label.self) {
    color: #6a1b9a;
    box-shadow: 0 0 0 2px #9632c8;
  }
  .map :global(.industry-label.supplier) {
    color: #b02525;
    box-shadow: 0 0 0 2px #e03131;
  }
  .map :global(.industry-label.consumer) {
    color: #0b7285;
    box-shadow: 0 0 0 2px #15aabf;
  }
  .map :global(.industry-label.dim) {
    opacity: 0.3;
  }
  .map :global(.town-label) {
    transition: opacity 0.15s;
  }
  .map :global(.town-label.self) {
    background: #fff;
    box-shadow: 0 0 0 3px #9632c8;
  }
  .map :global(.town-label.consumer) {
    background: #fff;
    box-shadow: 0 0 0 3px #15aabf;
  }
  .map :global(.town-label.dim) {
    opacity: 0.45;
  }
</style>
