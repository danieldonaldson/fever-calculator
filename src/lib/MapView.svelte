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
  import type { ContourLevel } from './load';

  interface Props {
    world: World;
    /** URL of the terrain image to show */
    terrain: string;
    /** traced contours, or null to hide them */
    contours: ContourLevel[] | null;
    /** levels that are a multiple of this are drawn heavier */
    contourIndexM: number;
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
  let { world, terrain, contours, contourIndexM, showRails, industryLabels, routes, preview, pinned, onPin, onCreate, onEdit, onRemove }: Props = $props();

  const KIND_COLOR: Record<Kind, string> = { residential: '#28aa3c', commercial: '#285adc', industrial: '#f08c14' };
  const IND = { fill: '#9632c8', supplier: '#e03131', consumer: '#15aabf' };
  const LABEL_MIN_ZOOM = -2;
  /** district tooltips open above the circle: the town's name label sits to its right */
  const HOVER_TIP: L.TooltipOptions = { pane: 'hoverTips', direction: 'top' };
  /** emoji size inside an industry marker */
  const GLYPH_PX = 15;
  /** zoomed further out, only index contours show: minor ones run together in the hills */
  const MINOR_CONTOUR_MIN_ZOOM = -2;

  let el: HTMLDivElement;
  let map: L.Map;
  let overlay: L.ImageOverlay;
  let rails: L.LayerGroup;
  let contourLayer: L.LayerGroup | null = null;
  /** the levels `contourLayer` was built from */
  let contourSrc: ContourLevel[] | null = null;
  let minorContours: L.Polyline | null = null;
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
    // panes: terrain < contours < rails < town circles (overlayPane, 400) < markers
    map.createPane('terrain').style.zIndex = '200';
    map.createPane('contours').style.zIndex = '250';
    map.createPane('rails').style.zIndex = '300';
    overlay = L.imageOverlay(terrain, bounds, { pane: 'terrain', className: 'terrain', pmIgnore: true, snapIgnore: true } as object).addTo(map);
    rails = railLayer(world.rails);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    // town names above industry labels (both are tooltips; tooltipPane is z-index 650)
    map.createPane('townLabels').style.zIndex = '655';
    // hover tooltips above every permanent label, so a town's name never covers its districts' details
    map.createPane('hoverTips').style.zIndex = '700';

    // Town centres: one circle per kind, radius from FINDINGS §8 (8 + 0.75·√capacity px at 4 m/px).
    for (const t of world.towns) {
      for (const [kind, c] of Object.entries(t.centers) as [Kind, [number, number]][]) {
        const circle = L.circle(ll(...c), {
          ...fixed, radius: (8 + 0.75 * Math.sqrt(t.capacity[kind])) * 4,
          color: '#000', weight: 1.5, fillColor: KIND_COLOR[kind], fillOpacity: 0.65, className: 'district',
        }).addTo(map);
        if (kind === 'residential') {
          circle.bindTooltip(`${esc(t.name)} · residential ${t.capacity[kind].toLocaleString()}`, HOVER_TIP);
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
            HOVER_TIP,
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
      const icon = L.divIcon({ className: 'industry-icon', html: `<span>${glyph(industryIcon(i.type))}</span>`, iconSize: [26, 26] });
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
    map.on('zoomend', contoursByZoom);
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

  /** Contours as two multi-polylines on a canvas renderer: thin minor lines, heavier index lines. */
  function contourLayerOf(levels: ContourLevel[]): L.LayerGroup {
    const renderer = L.canvas({ pane: 'contours', padding: 0.5 });
    const base = { renderer, interactive: false, pmIgnore: true, snapIgnore: true, color: '#7a5230', smoothFactor: 1.5 } as L.PolylineOptions;
    const lines = (index: boolean) => levels
      .filter((l) => (l.level_m % contourIndexM === 0) === index)
      .flatMap((l) => l.lines.map((a) => {
        const out: L.LatLng[] = [];
        for (let k = 0; k < a.length; k += 2) out.push(ll(a[k], a[k + 1]));
        return out;
      }));
    const group = L.layerGroup();
    minorContours = L.polyline(lines(false), { ...base, weight: 0.8, opacity: 0.45 });
    L.polyline(lines(true), { ...base, weight: 1.5, opacity: 0.7 }).addTo(group);
    return group;
  }

  function contoursByZoom() {
    if (!minorContours) return;
    const show = !!contours && map.getZoom() >= MINOR_CONTOUR_MIN_ZOOM;
    if (show) minorContours.addTo(map);
    else minorContours.remove();
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
    if (!map) return;
    if (contours !== contourSrc) {
      contourLayer?.remove();
      minorContours?.remove();
      contourLayer = minorContours = null;
      if (contours) contourLayer = contourLayerOf(contours).addTo(map);
      contourSrc = contours;
    }
    contoursByZoom();
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
      else layer.bindTooltip(tip, { ...HOVER_TIP, sticky: true });
    }
  });

  /**
   * An emoji drawn so its ink, not its line box, is centred in the marker. Emoji fonts disagree on
   * ascent and descent, so CSS centring leaves them a pixel or two high or low depending on the browser.
   */
  const glyphs = new Map<string, string>();
  let measure: OffscreenCanvasRenderingContext2D | null = null;
  function glyph(e: string): string {
    let svg = glyphs.get(e);
    if (svg) return svg;
    if (!measure) {
      measure = new OffscreenCanvas(1, 1).getContext('2d')!;
      measure.font = `${GLYPH_PX}px ${getComputedStyle(el).getPropertyValue('--emoji').trim() || 'sans-serif'}`;
    }
    const m = measure.measureText(e);
    // alphabetic baseline at y, text starting at x: ink spans x - left .. x + right and y - ascent .. y + descent
    const x = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
    const y = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    svg = `<svg viewBox="-11 -11 22 22" aria-hidden="true"><text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${GLYPH_PX}">${e}</text></svg>`;
    glyphs.set(e, svg);
    return svg;
  }

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
      <button class="close" onclick={() => onPin(null)} title="Unpin (Esc)" aria-label="Unpin">✕</button>
    {/if}
    {#if active.kind === 'industry'}
      {@const { inputs, outputs } = chainOf(active.type)}
      {@const p = partners(active.type)}
      {@const towns = wantedBy(outputs)}
      {@const sup = industryList(p.suppliers)}
      {@const con = industryList(p.consumers)}
      <div class="title"><span class="emoji">{industryIcon(active.type)}</span>{industryName(active.type)} <span class="muted">×{countOf(active.type)}</span></div>
      {#if inputs.length || outputs.length}
        <dl class="flow">
          {#if inputs.length}
            <dt>In</dt><dd>{inputs.map((c) => `${cargoIcon(c)} ${cargoName(c)}`).join(', ')}</dd>
          {/if}
          {#if outputs.length}
            <dt>Out</dt><dd>{outputs.map((c) => `${cargoIcon(c)} ${cargoName(c)}`).join(', ')}</dd>
          {/if}
        </dl>
      {/if}
      <ul class="key">
        <li><i style:background={IND.fill}></i><span>{industryName(active.type)}</span></li>
        <li><i style:background={IND.supplier}></i><span><b>Supplies it</b> {sup || 'none on this map'}</span></li>
        <li><i style:background={IND.consumer}></i><span><b>Takes its output</b> {con || 'none on this map'}</span></li>
        {#if towns.length}
          <li><i class="ring" style:border-color={IND.consumer}></i><span><b>Towns</b> {towns.join(', ')}</span></li>
        {/if}
      </ul>
    {:else}
      {@const t = townById.get(active.town)}
      {@const needs = t?.demand[active.district] ?? []}
      <div class="title">{active.label} <span class="muted">{t?.capacity[active.district].toLocaleString()}</span></div>
      <ul class="key">
        {#each needs as d}
          <li><span class="emoji">{cargoIcon(d.cargo)}</span><span><b>{cargoName(d.cargo)}{factorLabel(d.factor)}</b> ← {industryList(producersOf(d.cargo)) || 'no producer'}</span></li>
        {:else}
          <li class="muted">No cargo needs yet</li>
        {/each}
        <li><i style:background={IND.supplier}></i><span>Produces it</span></li>
      </ul>
    {/if}
    {#if !pinned}
      <div class="foot">Click to pin</div>
    {:else if drawing}
      <div class="foot">Drawing: click the last point again to finish</div>
    {/if}
  </div>
{/if}

<style>
  .map {
    position: absolute;
    inset: 0;
    background: var(--map-bg);
  }
  /* the world as a sheet lifted off the background: a navy keyline and a soft shadow */
  .map :global(img.terrain) {
    outline: 2px solid var(--navy);
    box-shadow: 0 4px 12px rgb(10 20 40 / 0.3), 0 20px 56px rgb(10 20 40 / 0.45);
  }
  @media (prefers-color-scheme: dark) {
    .map :global(img.terrain) {
      outline: 1.5px solid rgb(241 243 248 / 0.3);
      box-shadow: 0 4px 12px rgb(0 0 0 / 0.5), 0 20px 56px rgb(0 0 0 / 0.7);
    }
  }
  .legend {
    position: absolute;
    right: 12px;
    bottom: 24px;
    z-index: 1000;
    width: max-content;
    max-width: min(380px, calc(100% - 80px));
    --muted: var(--on-navy-muted);
    --border: var(--navy-line);
    overflow: hidden;
    padding: 16px 16px 12px;
    border: none;
    border-radius: 12px;
    background: var(--navy);
    color: var(--on-navy);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    line-height: 1.4;
    pointer-events: none;
  }
  /* line-coloured band along the top, solid when pinned */
  .legend::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 4px;
    background: repeating-linear-gradient(90deg, var(--signal) 0 10px, transparent 10px 16px);
  }
  .legend.pinned {
    padding-right: 36px;
    pointer-events: auto;
  }
  .legend.pinned::before {
    background: var(--signal);
  }
  @media (max-width: 720px) {
    .legend {
      right: 8px;
      bottom: 8px;
      left: 8px;
      width: auto;
      max-width: none;
      max-height: 45%;
      overflow-y: auto;
    }
  }
  .title {
    font-size: 15px;
    font-weight: 800;
  }
  .emoji {
    display: inline-block;
    width: 1.5em;
    font-family: var(--emoji);
    flex: none;
  }
  .close {
    position: absolute;
    top: 10px;
    right: 8px;
    padding: 2px 7px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 13px;
  }
  .close:hover:not(:disabled) {
    background: var(--navy-3);
    color: var(--on-navy);
  }
  .muted {
    color: var(--muted);
    font-weight: normal;
    font-variant-numeric: tabular-nums;
  }
  .flow {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 8px 0 0;
  }
  .flow dt {
    color: var(--muted);
    color: var(--signal);
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    line-height: 19px;
  }
  .flow dd {
    margin: 0;
  }
  .key {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 10px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--border);
    list-style: none;
  }
  .key li {
    display: flex;
    align-items: baseline;
  }
  .key b {
    font-weight: 750;
  }
  .foot {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
  }
  .legend i.ring {
    background: none;
    border-width: 2px;
  }
  .legend i {
    display: inline-block;
    flex: none;
    width: 10px;
    height: 10px;
    margin: 0 8px 0 2px;
    border-radius: 50%;
    border: 1.5px solid rgb(255 255 255 / 0.85);
  }
  .map :global(.town-label) {
    padding: 4px 8px 2px;
    border: none;
    border-radius: 6px;
    background: rgb(20 33 61 / 0.92);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    color: #f1f3f8;
    font-size: 15px;
    line-height: 1.15;
  }
  .map :global(.town-label small) {
    display: block;
    color: #aab4cc;
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
    transition: opacity 0.15s, transform 0.15s;
  }
  .map :global(.industry-icon svg) {
    width: 100%;
    height: 100%;
    overflow: visible;
    font-family: var(--emoji);
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
    padding: 0 4px;
    border: none;
    border-radius: 3px;
    background: rgb(255 255 255 / 0.75);
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
    background: #14213d;
    box-shadow: 0 0 0 3px #9632c8;
  }
  .map :global(.town-label.consumer) {
    background: #14213d;
    box-shadow: 0 0 0 3px #15aabf;
  }
  .map :global(.town-label.dim) {
    opacity: 0.45;
  }
</style>
