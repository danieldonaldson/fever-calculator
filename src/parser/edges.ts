// Street and track edges (the BaseEdge component, engine.d.tl): road and rail network geometry.
//
// Record layout, as found in 2.sav (offsets ~4.9-6.4 MB):
//   u32 len, template   e.g. "infrastructure/track/standard/standard_catenary.street_template"
//   u32 0               (meaning unknown)
//   u32 len, style      e.g. "infrastructure/track/standard/standard.street"
//   u32 node0, u32 node1
//   Vec3f position0, Vec3f position1, Vec3f tangent0, Vec3f tangent1   (Hermite curve, metres)
//   u32 type (0 regular, 1 bridge, 2 tunnel), i32 typeIndex (bridge/tunnel model; -1 for regular)
// Bridge/tunnel verified against the heightmap on 2.sav: type 1 edges sit a median 12.6 m above
// the ground, type 2 a median 24 m below it, type 0 at ground level.
import { ascii, findAll, type Bytes } from './bytes';

export type RailKind = 'standard' | 'simple' | 'industry' | 'other';

export interface Edge {
  /** "track" for rail, "street" for roads */
  network: 'track' | 'street';
  kind: RailKind | string;
  electric: boolean;
  structure: 'bridge' | 'tunnel' | null;
  node0: number;
  node1: number;
  /** x0, y0, x1, y1 */
  p: [number, number, number, number];
  /** height of each end, metres */
  z: [number, number];
  /** tangent at each end: tx0, ty0, tx1, ty1 */
  t: [number, number, number, number];
}

const STREET = ascii('.street');
const TEMPLATE_SUFFIX = ascii('_template');
const latin1 = new TextDecoder('latin1');
const PATH_RE = /^[A-Za-z0-9_\/.]+$/;

/** Length-prefixed ASCII path ending exactly at `end`, or null. */
function stringEndingAt(b: Bytes, end: number, maxLen = 200): [string, number] | null {
  for (let L = 8; L <= maxLen; L++) {
    const q = end - L - 4;
    if (q < 0) return null;
    if (b.u32(q) !== L) continue;
    const s = latin1.decode(b.u8.subarray(q + 4, end));
    return PATH_RE.test(s) ? [s, q] : null;
  }
  return null;
}

function classify(style: string, template: string): Pick<Edge, 'network' | 'kind' | 'electric'> {
  const track = style.includes('/track/') || style.includes('industry_track');
  const kind = style.includes('industry_track') ? 'industry'
    : style.match(/\/track\/([a-z0-9_]+)\//)?.[1] ?? (track ? 'other' : style.match(/\/street\/([a-z0-9_]+)\//)?.[1] ?? 'other');
  return { network: track ? 'track' : 'street', kind, electric: template.includes('catenary') };
}

const finite = (v: number, lim = 1e6) => Number.isFinite(v) && Math.abs(v) < lim;

export function edges(b: Bytes): Edge[] {
  const out: Edge[] = [];
  for (const dot of findAll(b.u8, STREET)) {
    const end = dot + STREET.length;
    // ".street" must end the style string, not be the start of ".street_template"
    // (checking for "_" alone drops edges whose node0 id starts with byte 0x5f)
    if (b.eq(end, TEMPLATE_SUFFIX)) continue;
    try {
      const style = stringEndingAt(b, end);
      if (!style || !style[0].endsWith('.street')) continue;
      if (b.u32(style[1] - 4) !== 0) continue;
      const template = stringEndingAt(b, style[1] - 4);
      if (!template || !template[0].endsWith('.street_template')) continue;
      const f = Array.from({ length: 12 }, (_, k) => b.f32(end + 8 + 4 * k));
      if (!f.every((v) => finite(v))) continue;
      // positions differ and tangents are non-zero, else this is a resource list entry, not an edge
      const chord = Math.hypot(f[3] - f[0], f[4] - f[1]);
      if (chord < 0.01 || chord > 5000 || Math.hypot(f[6], f[7]) < 1e-3) continue;
      const type = b.u32(end + 8 + 48);
      out.push({
        ...classify(style[0], template[0]),
        structure: type === 1 ? 'bridge' : type === 2 ? 'tunnel' : null,
        node0: b.u32(end), node1: b.u32(end + 4),
        p: [f[0], f[1], f[3], f[4]], z: [f[2], f[5]], t: [f[6], f[7], f[9], f[10]],
      });
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
  }
  return out;
}

/** Points along the Hermite curve of an edge, about every `step` metres (endpoints included). */
export function sampleEdge(e: Edge, step = 16): [number, number][] {
  const [x0, y0, x1, y1] = e.p, [tx0, ty0, tx1, ty1] = e.t;
  const n = Math.max(1, Math.min(32, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    pts.push([h00 * x0 + h10 * tx0 + h01 * x1 + h11 * tx1, h00 * y0 + h10 * ty0 + h01 * y1 + h11 * ty1]);
  }
  return pts;
}
