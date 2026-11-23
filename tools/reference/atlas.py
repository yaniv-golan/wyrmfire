"""Raycast wall/portal bands to 96 angular depth samples for each accessible
cell. Pack adjacent 4x4 cells together; only the active region lives in
Dragon RAM.

Reference implementation for converter/wyrmfire-convert.js.
"""
import math
import numpy as np
from lz import encode

ANGLES = 96
MAX_DOOR_GROUPS = 63


def _sin_series(x):
    # Fixed-order Taylor series using only IEEE +, *, / so that Python,
    # NumPy and JavaScript produce bit-identical doubles.
    term = x; s = 0.0
    for n in range(1, 16):
        s += term; term = -term * x * x / ((2 * n) * (2 * n + 1))
    return s


def trig_table():
    """cos and sin of k*tau/96 for k in 0..95, platform independent."""
    step = math.tau / ANGLES
    quarter = ANGLES // 4
    sin_q = [_sin_series(k * step) for k in range(quarter // 2 + 1)]
    cos_q = [_sin_series((quarter - k) * step) for k in range(quarter // 2 + 1)]

    def sin_first(k):  # 0 <= k <= 24
        return sin_q[k] if k <= quarter // 2 else cos_q[quarter - k]

    def cos_first(k):
        return cos_q[k] if k <= quarter // 2 else sin_q[quarter - k]
    cos = []; sin = []
    for k in range(ANGLES):
        q, r = divmod(k, quarter)
        c, s = cos_first(r), sin_first(r)
        if r == 0:
            c, s = 1.0, 0.0
        for _ in range(q):
            c, s = -s, c
        cos.append(c); sin.append(s)
    return cos, sin


def door_groups(grid):
    cells = {i for i, c in enumerate(grid) if c & 16}; groups = {}; ng = 0
    while cells:
        ng += 1; q = [min(cells)]
        while q:
            i = q.pop()
            if i not in cells: continue
            cells.remove(i); groups[i] = ng
            q.extend(i + d for d in (-1, 1, -128, 128))
    return groups, ng


def build(records, grid, floors):
    r = np.array(records, dtype=np.int64); ax, ay, bx, by, lo, hi, kind, doorcell = r.T; u = bx - ax; v = by - ay
    cos, sin = trig_table()
    dx = np.array(cos)[:, None]; dy = np.array(sin)[:, None]
    den = dx * v - dy * u; den = np.where(abs(den) < 1e-8, 1e-9, den)
    region = {}
    groups, ng = door_groups(grid)
    if ng > MAX_DOOR_GROUPS:
        from levelmap import LimitError
        raise LimitError('map has %d door groups; the engine allows %d' % (ng, MAX_DOOR_GROUPS))
    doors = np.array([groups.get(int(i), 0) for i in doorcell])
    for c, flags in enumerate(grid):
        if not flags: continue
        cx, cy = c % 128, c // 128
        wx = ax - (cx * 8 + 4); wy = ay - (cy * 8 + 4)
        t = (wx * v - wy * u) / den; s = (wx * dy - wy * dx) / den
        ok = (s >= 0) & (s <= 1) & (t >= .25); eyes = floors[c] - 128 + 5
        solid = np.where(ok & (kind == 1), t, 1e6); si = solid.argmin(axis=1); st = solid.min(axis=1)
        portal = np.where(ok & (kind != 1) & (t <= st[:, None] + .05), t, 1e6); pi = portal.argmin(axis=1); pt = portal.min(axis=1)

        def screen(z, h): return np.clip(np.rint(79 - (h - eyes) * 128 / np.maximum(z, 1)), 0, 158).astype('u1')

        def dep(t): return np.clip(np.rint(t / 2), 1, 127).astype('u1')
        chunk = bytearray()
        for k in [screen(st, hi[si]), screen(st, lo[si]), screen(pt, hi[pi]), screen(pt, lo[pi]), dep(st), dep(pt),
                  np.where(pt > 99999, 0, np.where(kind[pi] == 3, 1 + doors[pi], 1)).astype('u1'),
                  (np.where(abs(u[si]) > abs(v[si]), 1, 0) | np.where(np.roll(si, 1) != si, 2, 0) | np.where(np.roll(pi, 1) != pi, 4, 0)).astype('u1')]:
            chunk += k.tobytes()
        z = (cx // 4, cy // 4); region.setdefault(z, {})[(cy % 4) * 4 + cx % 4] = chunk
    if len(region) > 255:
        from levelmap import LimitError
        raise LimitError('map has %d regions; HGR2 allows 255' % len(region))
    zones = []; zone_index = bytearray(32 * ((len(grid) // 128 + 3) // 4))
    for zi, (z, cells) in enumerate(sorted(region.items())):
        zone_index[z[1] * 32 + z[0]] = zi + 1
        header = bytearray(16); body = bytearray()
        for j, data in sorted(cells.items()):
            header[j] = len(body) // 768 + 1; body += data
        payload = bytes(header + body)
        zones.append(dict(zone=z, cells=len(cells), payload=payload, packed=encode(payload)))
    return dict(groups=groups, zone_index=bytes(zone_index), zones=zones)
