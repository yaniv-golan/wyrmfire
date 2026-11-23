"""Convert one Doom-format map to a graph of traversable 64-unit cells.

Reference implementation for converter/wyrmfire-convert.js.
"""
import math, struct, bisect
from collections import deque

DOOR_SPECIALS = (1, 26, 27, 28, 31, 32, 33, 34, 117, 118)
LOCKS = {26: 1, 32: 1, 27: 2, 34: 2, 28: 3, 33: 3}
THING_KINDS = {3004: 1, 9: 2, 3001: 3, 3002: 4, 58: 4, 3003: 5, 16: 5, 2007: 6, 2048: 6,
               2011: 7, 2012: 7, 2001: 8, 5: 9, 6: 10, 13: 11, 2008: 12, 2049: 12,
               2018: 13, 2019: 13}
MAX_OBJECTS = 64       # Thing things[64] in the engine
MAX_GRID = 13312       # GRID $AC00-$DFFF: 104 rows of 128 cells


class LimitError(ValueError):
    pass


def build_map(lumps):
    """Grid for the map's bounding box. If that box is taller than HGR2
    allows, trim rows that hold no reachable cell (lossless; the trimmed map
    plays identically) and rebuild."""
    vs = list(struct.iter_unpack('<hh', lumps['VERTEXES']))
    if not vs:
        raise ValueError('map has no vertices')
    ox = min(x for x, y in vs) - 96; oy = min(y for x, y in vs) - 96
    h = (max(y for x, y in vs) - oy) // 64 + 3
    if 128 * h <= MAX_GRID:
        return _build(lumps, oy, h)
    full = _build(lumps, oy, h)
    rows = [i // 128 for i, c in enumerate(full['grid']) if c]
    top, bottom = min(rows), max(rows)
    trimmed = bottom - top + 3
    if 128 * trimmed > MAX_GRID:
        raise LimitError('map needs %d grid rows (%d after trimming unreachable rows); HGR2 allows %d'
                         % (h, trimmed, MAX_GRID // 128))
    m = _build(lumps, oy + 64 * (top - 1), trimmed)
    m['trimmedRows'] = h - trimmed
    return m


def _build(lumps, oy, h):
    vs = list(struct.iter_unpack('<hh', lumps['VERTEXES']))
    ls = list(struct.iter_unpack('<7H', lumps['LINEDEFS']))
    things = list(struct.iter_unpack('<5h', lumps['THINGS']))
    sides = list(struct.iter_unpack('<hh8s8s8sH', lumps['SIDEDEFS']))
    if not ls:
        raise ValueError('map has no linedefs')
    ox = min(x for x, y in vs) - 96
    w = (max(x for x, y in vs) - ox) // 64 + 3
    if w > 128:
        raise LimitError('map is %d cells wide; HGR2 allows 128' % w)

    def cell(x, y): return ((y - oy) // 64) * 128 + (x - ox) // 64
    start = next((t for t in things if t[3] == 1), None)
    if start is None:
        raise ValueError('map has no player 1 start')
    grid = bytearray(128 * h)
    for y in range(1, h - 1): grid[y * 128 + 1:y * 128 + w - 1] = bytes([15]) * (w - 2)
    walls = {}; exits = []; doors = {}; secret = []
    # Intersect each linedef with horizontal and vertical cell-centre links.
    # A solid line removes both directions of a link. A door stays traversable
    # in the graph and is represented separately in the active cell map.
    for a, b, flags, spec, tag, right, left in ls:
        x1, y1 = vs[a]; x2, y2 = vs[b]; dx = x2 - x1; dy = y2 - y1
        if spec in (11, 51, 52, 124):
            s = max(1, math.sqrt(dx * dx + dy * dy))
            (secret if spec in (51, 124) else exits).append(
                cell((x1 + x2) / 2 + dy / s * 40, (y1 + y2) / 2 - dx / s * 40))
        isdoor = spec in DOOR_SPECIALS
        if left != 65535 and not flags & 1 and not isdoor: continue
        for swap in (False, True):
            a0, b0, da, db, oa, ob = (y1, x1, dy, dx, oy, ox) if swap else (x1, y1, dx, dy, ox, oy)
            if not db: continue
            for k in range(math.ceil((min(b0, b0 + db) - ob - 32) / 64), math.ceil((max(b0, b0 + db) - ob - 32) / 64)):
                p = a0 + da * (ob + 32 + 64 * k - b0) / db
                j = math.floor((p - oa - 32) / 64)
                i = (j * 128 + k) if swap else (k * 128 + j)
                step, bit, opp = (128, 4, 8) if swap else (1, 1, 2)
                if i < 0 or i + step >= len(grid): continue  # outside trimmed rows
                if isdoor and left != 65535: doors[i + step] = LOCKS.get(spec, 0)
                else:
                    grid[i] &= ~bit; grid[i + step] &= ~opp
                    name = sides[right][4]
                    style = 1 if name.startswith((b'COMP', b'TEK', b'PANEL')) else 2 if name.startswith((b'STAR', b'LITE', b'SUPP')) else 3 if name.startswith((b'STONE', b'SKIN', b'MARB')) else 0
                    walls[i] = style; walls[i + step] = style
    # Keep only centres lying inside the one-sided boundaries. This also
    # seals corner gaps produced by sampling diagonal lines on a square grid.
    for y in range(h):
        yy = oy + 32 + 64 * y
        crossings = sorted(vs[a][0] + (yy - vs[a][1]) * (vs[b][0] - vs[a][0]) / (vs[b][1] - vs[a][1])
                           for a, b, _, _, _, _, left in ls if left == 65535 and min(vs[a][1], vs[b][1]) <= yy < max(vs[a][1], vs[b][1]))
        for x in range(w):
            if bisect.bisect_right(crossings, ox + 32 + 64 * x) % 2 == 0: grid[y * 128 + x] = 0
    for i in range(128, len(grid) - 128):
        if grid[i]:
            for bit, off in ((1, 1), (2, -1), (4, 128), (8, -128)):
                if not grid[i + off]: grid[i] &= ~bit
    seed = int(cell(*start[:2]))
    if not 0 <= seed < len(grid) or not grid[seed]:
        raise ValueError('player start lies outside the playable map')
    reached = {seed}; q = deque([seed])
    while q:
        i = q.popleft()
        for bit, off in ((1, 1), (2, -1), (4, 128), (8, -128)):
            if grid[i] & bit and i + off not in reached: reached.add(i + off); q.append(i + off)
    ordered = sorted(reached)

    def closest(i):
        i = int(i)
        if i in reached: return i
        return min(ordered, key=lambda j: (j % 128 - i % 128) ** 2 + (j // 128 - i // 128) ** 2)
    for i in range(len(grid)):
        if i not in reached: grid[i] = 0
    for i in walls.keys() & reached: grid[i] |= walls[i] << 6
    for i in doors.keys() & reached: grid[i] &= 15
    for i in doors.keys() & reached: grid[i] |= 16 | (doors[i] << 6)
    if not exits:
        bosses = [t for t in things if t[3] == 3003]
        exits = [cell(*(bosses[-1] if bosses else start)[:2])]
    for i in exits: grid[closest(i)] = (grid[closest(i)] & 15) | 32
    for i in secret: grid[closest(i)] = (grid[closest(i)] & 15) | 96
    objs = []
    for x, y, ang, kind, flags in things:
        if not flags & 2 or flags & 16: continue
        t = THING_KINDS.get(kind)
        if t and (int(cell(x, y)) in reached or t == 5):
            c = closest(cell(x, y)) if t == 5 else int(cell(x, y)); objs += [c % 128, c // 128, t]
    angle = (4 * (start[2] + 5) // 45) % 32
    return dict(grid=grid, ox=ox, oy=oy, seed=seed, angle=angle, objects=objs,
                cells=len(reached), width=w, height=h, trimmedRows=0)
