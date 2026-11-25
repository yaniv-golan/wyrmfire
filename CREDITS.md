# Credits

## WYRMFIRE

Engine, converter and tools: the WYRMFIRE contributors (GPL-3.0-or-later).

The 8x9 font in `src/font.h` was drawn for this project (`tools/mkfont.mjs`).

## Freedoom (reference level disk, not shipped)

WYRMFIRE level data is converted from Freedoom (https://freedoom.github.io), Copyright © 2001-2024 Contributors to the Freedoom project, used under the BSD 3-Clause licence (full text: third_party/freedoom/COPYING.adoc). The data has been modified for the Dragon 64. The Freedoom project does not endorse CLOADM or WYRMFIRE.

DOOM is a registered trademark of ZeniMax Media Inc. CLOADM and WYRMFIRE are independent projects, not affiliated with or endorsed by id Software, ZeniMax Media or Microsoft. References to DOOM describe file compatibility only.

The verbatim Freedoom 0.13.0 `COPYING.adoc`, `CREDITS` and `CREDITS-MUSIC`,
with a version and licence note, are in [`third_party/freedoom/`](third_party/freedoom).

No level disk is committed or attached to a release. The reference level
disk `wyrmfire-freedoom-e1m1.vdk` (pinned in `release/expected.json`), which
CI and players build with the converter, is converted from
`freedoom1.wad` of [Freedoom](https://freedoom.github.io) 0.13.0,
Copyright © 2001-2024 Contributors to the Freedoom project, under the
BSD-3-Clause licence in [LICENSES/freedoom.txt](LICENSES/freedoom.txt).
The full contributor lists are in
[LICENSES/freedoom-CREDITS.txt](LICENSES/freedoom-CREDITS.txt) and
[LICENSES/freedoom-CREDITS-MUSIC.txt](LICENSES/freedoom-CREDITS-MUSIC.txt).

That disk contains, reduced to 1-bit sprites, 6-bit 4 kHz samples and short
monophonic note lists: map E1M1; the zombie, imp, imp attack, fireball and
boss sprites; the fist, pistol, pistol flash and shotgun weapon sprites; two
status-bar faces; the pistol, shotgun, door, pain and pickup sounds; and the
opening seconds of three tracks:

- Title cue (`D_E1M1`): "Stanky Leg Specialist" by Lola "BlueWorrior" Harvey
- Level-complete cue (`D_INTER`): "YOU LIVE!!!!" by Stratos
- Clear cue (`D_VICTOR`): "Distance" by Korp

## Development dependencies (not redistributed)

- [CMOC](http://sarrazip.com/dev/cmoc.html) by Pierre Sarrazin
- [LWTOOLS](http://www.lwtools.ca/) by William Astle
- [CLOADM](https://github.com/yaniv-golan/CLOADM) for headless tests
