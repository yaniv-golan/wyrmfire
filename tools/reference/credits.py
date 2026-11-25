"""CREDITS.TXT for level disks converted from a Freedoom WAD.

Reference implementation for creditsText/placeCredits in
converter/wyrmfire-convert.js.
"""
from pathlib import Path

COPYING = (Path(__file__).resolve().parents[2] / 'third_party' / 'freedoom' / 'COPYING.adoc').read_text(encoding='utf-8')
DIRECTORY = ((576, 594), (720, 738))
TOTAL = 80 * 36

# Freedoom releases by WAD SHA-256 (tools/versions.env).
FREEDOOM_RELEASES = {
    '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d': ('freedoom1.wad', 'Freedoom Phase 1 0.13.0'),
    'a8772e088847032510d97ba2312406a6998f21cbab44d4ff10696faa9c0ecd4b': ('freedoom2.wad', 'Freedoom Phase 2 0.13.0'),
}


def credits_text(release, file, map_name):
    return '\n'.join([
        'WYRMFIRE level disk: map %s of %s (%s).' % (map_name, file, release),
        '',
        'WYRMFIRE level data is converted from Freedoom (https://freedoom.github.io), Copyright © 2001-2024 Contributors to the Freedoom project, used under the BSD 3-Clause licence (full text: third_party/freedoom/COPYING.adoc). The data has been modified for the Dragon 64. The Freedoom project does not endorse CLOADM or WYRMFIRE.',
        '',
        'Modified: the map, sprites, status-bar faces, sounds and music on this disk were converted by the WYRMFIRE converter and reduced for the Dragon 64 (a cell grid and precomputed wall regions, 1-bit sprites, 6-bit 4 kHz samples, short monophonic note lists).',
        '',
        'DOOM is a registered trademark of ZeniMax Media Inc. CLOADM and WYRMFIRE are independent projects, not affiliated with or endorsed by id Software, ZeniMax Media or Microsoft. References to DOOM describe file compatibility only.',
        '',
        'Freedoom licence (COPYING.adoc):',
        '',
        COPYING,
    ])


def place_credits(text, start):
    """[(first_sector, bytes)] from sector `start`, skipping the directory tracks; None if it does not fit."""
    data = text.encode('utf-8'); count = -(-len(data) // 256)
    extents = []; s = start; k = 0; run = None
    while k < count:
        if s >= TOTAL: return None
        if any(lo <= s < hi for lo, hi in DIRECTORY): run = None; s += 1; continue
        if run is None: run = [s, b'']; extents.append(run)
        run[1] += data[256 * k:256 * k + 256]; k += 1; s += 1
    return [(a, b) for a, b in extents]
