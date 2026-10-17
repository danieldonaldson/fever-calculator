#!/usr/bin/env python3
"""Fever Calculator reference extractor: Transport Fever 3 .sav -> world.json + map images.

Usage:
    uv run -q --with zstandard,pillow python -I fever_extract.py SAVE.sav OUTDIR [--hex]

    SAVE.sav  a TF3 save (zstd-compressed) or an already decompressed file
    OUTDIR    receives world.json, offsets.json, water.png, height.png, map.png
              (and HEX_SAMPLES.md with --hex)

Every locator searches by byte structure. Nothing depends on fixed offsets or on
player-editable names. See ../FINDINGS.md for the format description.
"""
import collections, io, json, math, os, re, struct, sys

# ---------------------------------------------------------------- loading
def load(path):
    data = open(path, 'rb').read()
    if data[:4] == b'\x28\xb5\x2f\xfd':  # zstd frame magic
        import zstandard
        data = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data)).read()
    if data[:4] != b'tf**':
        raise SystemExit('not a TF3 save (missing tf** magic after decompression)')
    return data

u32 = lambda d, o: struct.unpack_from('<I', d, o)[0]
i32 = lambda d, o: struct.unpack_from('<i', d, o)[0]
f32 = lambda d, o: struct.unpack_from('<f', d, o)[0]
f64 = lambda d, o: struct.unpack_from('<d', d, o)[0]

# ---------------------------------------------------------------- serialized Lua values (FINDINGS §2)
class Bad(Exception):
    pass

def lua_value(d, p, depth=0):
    tag = u32(d, p); p += 4
    if tag == 1: return bool(d[p]), p + 1
    if tag == 2: return f64(d, p), p + 8
    if tag == 3:
        n = u32(d, p)
        if n > 1_000_000: raise Bad('string too long')
        return d[p + 4:p + 4 + n].decode('utf8', 'replace'), p + 4 + n
    if tag == 4: return lua_table(d, p + 1, depth + 1)  # skip u8 flag
    raise Bad(f'unknown tag {tag} at {p - 4}')

def lua_table(d, p, depth=0):
    """u32 count + count*(key, value). Top-level params tables start here directly."""
    if depth > 32: raise Bad('too deep')
    n = u32(d, p); p += 4
    if n > 1_000_000: raise Bad('table too big')
    out = {}
    for _ in range(n):
        k, p = lua_value(d, p, depth)
        v, p = lua_value(d, p, depth)
        out[k] = v
    return out, p

# ---------------------------------------------------------------- constructions (FINDINGS §3)
CON_RE = re.compile(rb'(?:industries|buildings)/[A-Za-z0-9_/]+\.con')

def is_transform(m):
    return m[15] == 1.0 and abs(m[10] - 1) < 1e-3 and m[3] == 0 and m[7] == 0 and m[11] == 0

def constructions(d):
    inds, blds, first = [], [], {}
    for m in CON_RE.finditer(d):
        s, name = m.start(), m.group()
        if s < 4 or u32(d, s - 4) != len(name):
            continue
        try:
            params, p = lua_table(d, m.end())
        except (Bad, struct.error):
            continue
        t = struct.unpack_from('<16f', d, p)
        if not is_transform(t):
            continue
        path = name.decode()
        rec = {'path': path, 'x': t[12], 'y': t[13], 'z': t[14], 'offset': s - 4, 'params_end': p}
        if path.startswith('industries/'):
            rec['type'] = path.split('/')[1]
            inds.append(rec); first.setdefault('industry', s - 4)
        else:
            # buildings/<era>/<r|c|i><level>/<size>/<file>.con
            seg = path.split('/')[2]
            if seg[:1] not in ('r', 'c', 'i'):
                continue
            rec['kind'] = seg[0]
            rec['capacity'] = float(params.get('capacity', 0))
            blds.append(rec); first.setdefault('building', s - 4)
    return inds, blds, first

# ---------------------------------------------------------------- NAME table (FINDINGS §4)
NONAME = b'\x07\x00\x00\x00no name'

def _str_at(d, p, maxlen=400):
    n = u32(d, p)
    if n > maxlen: return None
    b = d[p + 4:p + 4 + n]
    try:
        t = b.decode('utf8')
    except UnicodeDecodeError:
        return None
    return None if any(ord(c) < 32 for c in t) else t

def name_table(d):
    """Densest run of internal "no name" entries -> walk back to the first string.
    The u32 just before the first string is the entry count."""
    hits = [m.start() for m in re.finditer(re.escape(NONAME), d)]
    if not hits:
        raise SystemExit('NAME table not found (no "no name" entries)')
    runs, cur = [], [hits[0]]
    for h in hits[1:]:
        if h - cur[-1] < 8192: cur.append(h)
        else: runs.append(cur); cur = [h]
    runs.append(cur)
    run = max(runs, key=len)
    p = run[0]
    while True:  # walk backwards: find q with q + 4 + len == p
        prev = None
        for q in range(p - 4, max(p - 404, 0) - 1, -1):
            if q + 4 + u32(d, q) == p:
                if _str_at(d, q) is not None: prev = q
                break
        if prev is None: break
        p = prev
    start, count = p, u32(d, p - 4)
    names, q = [], start
    for _ in range(count):
        t = _str_at(d, q, 100000)
        if t is None: break
        names.append(t); q += 4 + u32(d, q)
    if len(names) != count:
        print(f'warning: NAME header says {count}, read {len(names)}', file=sys.stderr)
    return names, start - 4

# ---------------------------------------------------------------- towns (FINDINGS §5)
TOWN_ENTITY_RE = re.compile(
    rb'townEntity\x04\x00\x00\x00\x01\x02\x00\x00\x00'
    rb'\x03\x00\x00\x00\x06\x00\x00\x00entity\x02\x00\x00\x00(.{8})', re.S)

def town_ids(d):
    ids = sorted({int(struct.unpack('<d', m.group(1))[0]) for m in TOWN_ENTITY_RE.finditer(d)})
    first = next(TOWN_ENTITY_RE.finditer(d)).start() if ids else None
    return ids, first

def town_buildings(d, ids):
    """TownBuilding: ... u32 depth(1-4), f32 height, u32 town, i64 timeBuilt ...
    Keep the densest contiguous run (records are ~45-55 bytes apart)."""
    alt = b'|'.join(re.escape(struct.pack('<I', t)) for t in ids)
    rx = re.compile(rb'[\x01-\x04]\x00\x00\x00.{4}(?:' + alt + rb')', re.S)
    hits = []
    for m in rx.finditer(d):
        h = m.start()
        if 2 < f32(d, h + 4) < 300:
            hits.append((h, u32(d, h + 8)))
    runs, cur = [], [hits[0]]
    for h in hits[1:]:
        if h[0] - cur[-1][0] < 2000: cur.append(h)
        else: runs.append(cur); cur = [h]
    runs.append(cur)
    run = max(runs, key=len)
    return [t for _, t in run], run[0][0]

def cluster(blds, R):
    par = list(range(len(blds)))
    def f(i):
        while par[i] != i:
            par[i] = par[par[i]]; i = par[i]
        return i
    grid = collections.defaultdict(list)
    for i, b in enumerate(blds): grid[(int(b['x'] // R), int(b['y'] // R))].append(i)
    for (gx, gy), L in grid.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    for i in L:
                        if i < j and (blds[i]['x'] - blds[j]['x']) ** 2 + (blds[i]['y'] - blds[j]['y']) ** 2 < R * R:
                            par[f(i)] = f(j)
    cl = collections.defaultdict(list)
    for i in range(len(blds)): cl[f(i)].append(i)
    return sorted(cl.values(), key=len, reverse=True)

def towns(blds, tb_towns, ids, names):
    counts = collections.Counter(tb_towns)
    want = sorted(counts.values(), reverse=True)
    order = sorted(ids, key=lambda t: -counts[t])
    for R in (180, 150, 210, 120, 250, 100, 300, 80, 400):
        cls = cluster(blds, R)
        if [len(c) for c in cls] == want:
            break
    else:
        raise SystemExit(f'cluster sizes never matched TownBuilding counts {want}')
    if len(set(want)) != len(want):
        print('warning: two towns share a building count; name assignment may be swapped', file=sys.stderr)
    out = []
    for c, tid in zip(cls, order):
        t = {'id': tid, 'name': names[1 + ids.index(tid)], 'buildings': len(c),
             'cluster_radius_m': R, 'centers': {}, 'capacity': {}}
        for k, kn in (('r', 'residential'), ('c', 'commercial'), ('i', 'industrial')):
            L = [blds[i] for i in c if blds[i]['kind'] == k]
            t['capacity'][kn] = int(sum(b['capacity'] for b in L))
            if L:
                t['centers'][kn] = [round(sum(b['x'] for b in L) / len(L), 1),
                                    round(sum(b['y'] for b in L) / len(L), 1)]
        t['population'] = t['capacity']['residential']
        out.append(t)
    return out

# ---------------------------------------------------------------- terrain (FINDINGS §6)
# lookahead so overlapping candidates are not skipped
HM_RE = re.compile(rb'(?=\xff\xff\xff\xff.{4}\x00{12}(.{4})(.{4}))', re.S)

def heightmap(d):
    for m in HM_RE.finditer(d):
        n, s = struct.unpack('<II', m.group(1) + m.group(2))
        side = int(round(math.sqrt(s)))
        if not (0 < n < 100000 and side * side == s and side > 2): continue
        b = m.start()  # = the 0xFFFFFFFF; two u32 before it: 0, N
        if u32(d, b - 4) != n or u32(d, b - 8) != 0: continue
        lst = b - 8 - 12 * n
        if u32(d, lst - 8) != n or u32(d, lst - 4) != 2: continue
        tiles = [(i32(d, lst + 12 * i), i32(d, lst + 12 * i + 4)) for i in range(n)]
        # third u32 per tile is a per-tile value (2 for every tile in 2.sav except the last = 0)
        if any(abs(x) > 4096 or abs(y) > 4096 for x, y in tiles) or len(set(tiles)) != n: continue
        q, offs = b + 24, []   # b+24 = first tile's u32 sample count
        for _ in range(n):
            if u32(d, q) != s: break
            offs.append(q + 4); q += 4 + 2 * s
        if len(offs) == n:
            return {'tiles': tiles, 'offs': offs, 'side': side, 'list_offset': lst - 8,
                    'data_offset': b + 24, 'end_offset': q}
    raise SystemExit('heightmap not found')

TILE_M = 256.0          # metres per tile (verified on 2.sav, 4 m sample spacing)
RAW_PER_M, RAW_ZERO = 20, 2000   # height_m = raw/20 - 100 ; water level 0 m == raw 2000

# ---------------------------------------------------------------- images
def raster(d, hm, stride):
    xs = [t[0] for t in hm['tiles']]; ys = [t[1] for t in hm['tiles']]
    x0, y0 = min(xs), min(ys)
    per = hm['side'] - 1
    W = (max(xs) - x0 + 1) * per // stride
    H = (max(ys) - y0 + 1) * per // stride
    grid = [[0] * W for _ in range(H)]
    for (tx, ty), o in zip(hm['tiles'], hm['offs']):
        a = struct.unpack_from(f'<{hm["side"] ** 2}H', d, o)
        for iy in range(0, per, stride):
            row = grid[H - 1 - ((ty - y0) * per + iy) // stride]
            base = ((tx - x0) * per) // stride
            for ix in range(0, per, stride):
                row[base + ix // stride] = a[iy * hm['side'] + ix]
    return grid, W, H, x0 * TILE_M, y0 * TILE_M

def images(d, hm, world, outdir):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print('pillow missing: skipping images', file=sys.stderr); return
    grid, W, H, ox, oy = raster(d, hm, 2)
    mpp = TILE_M / (hm['side'] - 1) * 2
    img = Image.new('L', (W, H)); img.putdata([60 if v < RAW_ZERO else 225 for r in grid for v in r])
    img.save(os.path.join(outdir, 'water.png'))
    lo = min(min(r) for r in grid); hi = max(max(r) for r in grid)
    img = Image.new('L', (W, H)); img.putdata([(v - lo) * 255 // max(1, hi - lo) for r in grid for v in r])
    img.save(os.path.join(outdir, 'height.png'))
    # labelled map, 1 px = 4 m
    grid, W, H, ox, oy = raster(d, hm, 1)
    mpp = TILE_M / (hm['side'] - 1)
    img = Image.new('RGB', (W, H))
    img.putdata([(70, 110, 160) if v < RAW_ZERO else (225, 225, 218) for r in grid for v in r])
    dr = ImageDraw.Draw(img, 'RGBA')
    def font(n, bold):
        for f in ('/usr/share/fonts/noto/NotoSans-%s.ttf' % ('Bold' if bold else 'Regular'),
                  '/usr/share/fonts/TTF/DejaVuSans%s.ttf' % ('-Bold' if bold else '')):
            if os.path.exists(f): return ImageFont.truetype(f, n)
        return ImageFont.load_default()
    big, small = font(34, True), font(20, False)
    w2p = lambda x, y: ((x - ox) / mpp, H - 1 - (y - oy) / mpp)
    COL = {'residential': (40, 170, 60), 'commercial': (40, 90, 220), 'industrial': (240, 140, 20)}
    for t in world['towns']:
        for k, (x, y) in t['centers'].items():
            r = 8 + t['capacity'][k] ** 0.5 * 0.75
            X, Y = w2p(x, y); dr.ellipse([X - r, Y - r, X + r, Y + r], fill=COL[k] + (170,), outline=(0, 0, 0), width=3)
        X, Y = w2p(*t['centers']['residential']); rr = 8 + t['population'] ** 0.5 * 0.75
        left = X > W - 600; LX = X - rr - 6 if left else X + rr + 6; an = 'ra' if left else 'la'
        c = t['capacity']
        dr.text((LX, Y - 40), f"{t['name']}  {t['population']:,}", fill=(20, 20, 20), font=big,
                stroke_width=3, stroke_fill=(255, 255, 255), anchor=an)
        dr.text((LX, Y + 2), f"res {c['residential']:,} · com {c['commercial']:,} · ind {c['industrial']:,}",
                fill=(40, 40, 40), font=small, stroke_width=2, stroke_fill=(255, 255, 255), anchor=an)
    labels = {}
    lp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'industry_names_en.json')
    if os.path.exists(lp): labels = json.load(open(lp))
    for i in world['industries']:
        X, Y = w2p(i['x'], i['y'])
        dr.ellipse([X - 10, Y - 10, X + 10, Y + 10], fill=(150, 50, 200), outline=(0, 0, 0), width=2)
        dr.text((X, Y + 14), labels.get(i['type'], i['type']), fill=(70, 20, 100), font=small, anchor='mt',
                stroke_width=2, stroke_fill=(255, 255, 255))
    img.save(os.path.join(outdir, 'map.png'))

# ---------------------------------------------------------------- hex appendix
def hexdump(d, a, b, mark=None):
    lines = []
    for o in range(a, b, 16):
        chunk = d[o:o + 16]
        hx = ' '.join(f'{c:02x}' for c in chunk)
        tx = ''.join(chr(c) if 32 <= c < 127 else '.' for c in chunk)
        lines.append(f'{o:10d}  {hx:<47}  {tx}' + ('   <==' if mark is not None and o <= mark < o + 16 else ''))
    return '\n'.join(lines)

def hex_appendix(d, off, path, src):
    S = [('File header: magic `tf**`, then the mod list', 0, 0, 192)]
    S.append(('First industry construction record: u32 len + path, params (Lua table), Mat4f',
              off['industry_first'], off['industry_first'] - 16, off['industry_first'] + 240))
    S.append(('First town-building construction record',
              off['building_first'], off['building_first'] - 16, off['building_first'] + 320))
    S.append(('NAME table: header (… , count) then u32-length strings (company, towns, …)',
              off['names_count'], off['names_count'] - 32, off['names_count'] + 160))
    S.append(('First `townEntity` script record (town id as f64 under key `entity`)',
              off['town_entity_first'], off['town_entity_first'] - 32, off['town_entity_first'] + 96))
    S.append(('TownBuilding run: u32 depth, f32 height, u32 town id, i64 timeBuilt (marked = first depth field)',
              off['town_building_first'], off['town_building_first'] - 64, off['town_building_first'] + 160))
    S.append(('Heightmap: count, 2, then (i32 x, i32 y, u32 2) tile list',
              off['heightmap_list'], off['heightmap_list'] - 48, off['heightmap_list'] + 64))
    S.append(('Heightmap: end of tile list, separator, first tile (u32 4225 + u16 samples)',
              off['heightmap_data'], off['heightmap_data'] - 64, off['heightmap_data'] + 64))
    with open(path, 'w') as f:
        f.write(f'# Hex samples from `{src}`\n\nGenerated by `scripts/fever_extract.py --hex`. '
                'Offsets are into the **decompressed** save; `<==` marks the line containing the '
                'structure start.\n\n')
        for title, mark, a, b in S:
            f.write(f'## {title}\n\nstart offset {mark}\n\n```\n{hexdump(d, max(0, a), b, mark)}\n```\n\n')

# ---------------------------------------------------------------- main
def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2: raise SystemExit(__doc__)
    src, outdir = args
    os.makedirs(outdir, exist_ok=True)
    d = load(src)
    print(f'decompressed {len(d):,} bytes')
    inds, blds, first = constructions(d)
    print(f'industries {len(inds)}, town buildings {len(blds)}')
    names, names_off = name_table(d)
    print(f'NAME table: {len(names)} entries at {names_off}')
    ids, te_off = town_ids(d)
    tb_towns, tb_off = town_buildings(d, ids)
    print(f'towns {len(ids)} ids {ids[0]}..{ids[-1]}, TownBuilding records {len(tb_towns)} at {tb_off}')
    if len(tb_towns) != len(blds):
        print(f'warning: TownBuilding count {len(tb_towns)} != building constructions {len(blds)}', file=sys.stderr)
    tw = towns(blds, tb_towns, ids, names)
    hm = heightmap(d)
    xs = [t[0] for t in hm['tiles']]; ys = [t[1] for t in hm['tiles']]
    print(f'heightmap {len(hm["tiles"])} tiles of {hm["side"]}x{hm["side"]} at {hm["list_offset"]}')
    world = {
        'source': os.path.basename(src),
        'coords': 'world metres, origin at map centre, +x east, +y north',
        'terrain': {'tile_m': TILE_M, 'samples_per_tile': hm['side'], 'sample_m': TILE_M / (hm['side'] - 1),
                    'tiles_x': [min(xs), max(xs)], 'tiles_y': [min(ys), max(ys)],
                    'extent_m': [min(xs) * TILE_M, min(ys) * TILE_M, (max(xs) + 1) * TILE_M, (max(ys) + 1) * TILE_M],
                    'height_formula': 'raw / 20 - 100', 'water': 'raw < 2000 (water level 0 m)'},
        'towns': tw,
        'industries': [{'type': i['type'], 'x': round(i['x'], 1), 'y': round(i['y'], 1), 'z': round(i['z'], 2)}
                       for i in inds],
    }
    offsets = {'decompressed_size': len(d), 'industry_first': first.get('industry'),
               'building_first': first.get('building'), 'names_count': names_off,
               'names_entries': len(names), 'town_entity_first': te_off,
               'town_building_first': tb_off, 'heightmap_list': hm['list_offset'],
               'heightmap_data': hm['data_offset'], 'heightmap_end': hm['end_offset'],
               'town_ids': ids}
    json.dump(world, open(os.path.join(outdir, 'world.json'), 'w'), indent=1)
    json.dump(offsets, open(os.path.join(outdir, 'offsets.json'), 'w'), indent=1)
    for t in tw:
        print(f"  {t['name']:<16} id {t['id']}  pop {t['population']:>5}  buildings {t['buildings']}")
    images(d, hm, world, outdir)
    if '--hex' in sys.argv:
        hex_appendix(d, offsets, os.path.join(outdir, 'HEX_SAMPLES.md'), os.path.basename(src))
    print('wrote', outdir)

if __name__ == '__main__':
    main()
