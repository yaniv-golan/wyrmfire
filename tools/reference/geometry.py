"""Bake wall and height-change records from the map's linedefs and sector
heights, and the floor height of every reachable cell.

Reference implementation for converter/wyrmfire-convert.js.
"""
import struct
from levelmap import DOOR_SPECIALS


def prepare(lumps, ox, oy, grid):
    def rec(name, fmt): return list(struct.iter_unpack('<' + fmt, lumps[name]))
    vertices = rec('VERTEXES', 'hh'); lines = rec('LINEDEFS', '7H'); sides = rec('SIDEDEFS', 'hh8s8s8sH'); sectors = rec('SECTORS', 'hh8s8shhh')
    nodes = rec('NODES', 'hhhh8h2H'); subs = rec('SSECTORS', 'HH'); segs = rec('SEGS', '6H')
    if not nodes:
        raise ValueError('map has no BSP nodes (build it with a node builder)')

    def sector(x, y):
        n = len(nodes) - 1
        while n < 32768:
            sx, sy, dx, dy, *_, r, l = nodes[n]
            n = l if (y - sy) * dx >= (x - sx) * dy else r
        _, first = subs[n & 32767]; a, b, ang, line, rev, off = segs[first]
        return sides[lines[line][6 if rev else 5]][-1]
    records = []
    door_cells = [i for i, c in enumerate(grid) if c & 16]

    def cell_for_door(x1, y1, x2, y2):
        cx = int(((x1 + x2) / 2 - ox) // 64); cy = int(((y1 + y2) / 2 - oy) // 64)
        return min(door_cells, key=lambda i: (cx - i % 128) ** 2 + (cy - i // 128) ** 2, default=0)
    for a, b, flags, spec, tag, rs, ls in lines:
        if rs == 65535: continue
        x1, y1 = vertices[a]; x2, y2 = vertices[b]; f, c = sectors[sides[rs][-1]][:2]
        if ls == 65535: lo, hi, kind = f, c, 1
        else:
            of, oc = sectors[sides[ls][-1]][:2]
            if spec in DOOR_SPECIALS: lo, hi, kind = min(f, of), max(c, oc), 3
            elif f != of: lo, hi, kind = min(f, of), max(f, of), 2
            elif c != oc: lo, hi, kind = min(c, oc), max(c, oc), 2
            else: continue
        if hi <= lo: continue
        # Camera + geometry use eight map units per integer.
        records.append((round((x1 - ox) / 8), round((y1 - oy) / 8), round((x2 - ox) / 8), round((y2 - oy) / 8),
                        round(lo / 8), round(hi / 8), kind, cell_for_door(x1, y1, x2, y2) if kind == 3 else 0))
    if not records:
        raise ValueError('map has no walls')
    floors = bytearray(len(grid))
    for i, c in enumerate(grid):
        if c:
            xx = (i % 128) * 64 + 32 + ox; yy = (i // 128) * 64 + 32 + oy
            floors[i] = (sectors[sector(xx, yy)][0] // 8 + 128) & 255
    return records, floors
