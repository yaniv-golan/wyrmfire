#!/usr/bin/env python3
"""Reference converter: Doom-format IWAD map -> WYRMFIRE level disk (VDK).

    python3 tools/reference/convert.py WAD [--map E1M1] OUTDIR

Writes OUTDIR/wyrmfire.vdk, assets.dat and info.json. The
JavaScript converter (converter/wyrmfire-convert.js) must produce the same
bytes; see test/parity.test.mjs.
"""
import argparse, hashlib, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from wad import Wad
from levelmap import build_map
from geometry import prepare
from atlas import build as build_atlas
from levelpack import pack_level, HEADER_SECTOR
from assets import build as build_assets, ASSET_SECTOR, ENTRY_NAMES
from disk import build_vdk
from credits import FREEDOOM_RELEASES, credits_text, place_credits


def convert(wad_bytes, map_name='E1M1'):
    wad = Wad(wad_bytes)
    lumps = wad.level(map_name)
    m = build_map(lumps)
    records, floors = prepare(lumps, m['ox'], m['oy'], m['grid'])
    atlas = build_atlas(records, m['grid'], floors)
    extents, lv = pack_level(m, atlas)
    freedoom = FREEDOOM_RELEASES.get(hashlib.sha256(wad_bytes).hexdigest())
    assets, sizes = build_assets(wad, bool(freedoom))
    files = [('WYRMFIRE', 'DAT', [(ASSET_SECTOR, assets)]), ('WYRMFIRE', 'LVL', extents)]
    credits = place_credits(credits_text(freedoom[1], freedoom[0], map_name.upper()), lv['end']) if freedoom else None
    if credits: files.append(('CREDITS', 'TXT', credits))
    disk = build_vdk(files)
    zones = atlas['zones']
    info = {
        'map': map_name.upper(),
        'cells': m['cells'],
        'gridWidth': m['width'], 'gridHeight': m['height'],
        'objects': len(m['objects']) // 3,
        'spawn': [m['seed'] % 128, m['seed'] // 128, m['angle']],
        'doorCells': len(atlas['groups']),
        'doorGroups': max(atlas['groups'].values(), default=0),
        'walls': len(records),
        'regions': len(zones),
        'regionCells': [z['cells'] for z in zones],
        'regionBytes': [len(z['payload']) for z in zones],
        'regionSectors': lv['sectors'],
        'regionStart': lv['start'],
        'headerBytes': lv['header_bytes'],
        'levelBytes': sum(len(b) for _, b in extents),
        'lastSector': lv['end'],
        'assetBytes': len(assets),
        'credits': (sum(len(b) for _, b in credits) if credits else 'does not fit') if freedoom else None,
        'assetSizes': dict(zip(ENTRY_NAMES, sizes)),
        'diskBytes': len(disk),
        'sha256': hashlib.sha256(disk).hexdigest(),
    }
    return disk, assets, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wad'); ap.add_argument('out')
    ap.add_argument('--map', default='E1M1')
    a = ap.parse_args()
    disk, assets, info = convert(Path(a.wad).read_bytes(), a.map)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    (out / 'wyrmfire.vdk').write_bytes(disk)
    (out / 'assets.dat').write_bytes(assets)
    (out / 'info.json').write_text(json.dumps(info, indent=1) + '\n')
    print(json.dumps({k: v for k, v in info.items() if not isinstance(v, (list, dict))}))


if __name__ == '__main__':
    main()
