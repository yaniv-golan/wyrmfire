#!/usr/bin/env python3
"""Stage-by-stage digest of the reference converter for every map in a WAD.
Limits are lifted for the grid/region stages so oversized maps are still
compared; the final disk is produced with the real limits (or the error)."""
import hashlib, json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[2] / 'tools' / 'reference'
sys.path.insert(0, str(root))
import levelmap, atlas as atlas_mod
from wad import Wad
from geometry import prepare
from assets import build as build_assets
from convert import convert

h = lambda b: hashlib.sha256(bytes(b)).hexdigest()
wad_bytes = Path(sys.argv[1]).read_bytes()
maps = sys.argv[2:] or Wad(wad_bytes).maps()
wad = Wad(wad_bytes)
out = {}
for name in maps:
    r = {}
    real = levelmap.MAX_GRID
    try:
        levelmap.MAX_GRID = 10 ** 9
        lumps = wad.level(name)
        m = levelmap.build_map(lumps)
        r['grid'] = h(m['grid']); r['objects'] = m['objects']; r['spawn'] = [m['seed'], m['angle'], m['ox'], m['oy']]
        recs, floors = prepare(lumps, m['ox'], m['oy'], m['grid'])
        r['records'] = h(json.dumps(recs).encode()); r['floors'] = h(floors)
        a = atlas_mod.build(recs, m['grid'], floors)
        r['zones'] = h(b''.join(z['packed'] for z in a['zones'])); r['payloads'] = h(b''.join(z['payload'] for z in a['zones']))
        r['groups'] = [[k, v] for k, v in a['groups'].items()]
    except Exception as e:
        r['stageError'] = str(e)
    finally:
        levelmap.MAX_GRID = real
    try:
        disk, assets, info = convert(wad_bytes, name)
        r['disk'] = h(disk); r['wadSha256'] = h(wad_bytes); r['info'] = info
    except Exception as e:
        r['error'] = str(e)
    out[name] = r
    print(name, r.get('disk') or r.get('error'), file=sys.stderr, flush=True)
try:
    out['_assets'] = h(build_assets(wad)[0])
except Exception as e:
    out['_assets'] = 'error: ' + str(e)
print(json.dumps(out, indent=1, sort_keys=True))
