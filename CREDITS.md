# Credits

## WYRMFIRE

Engine, converter and tools: the WYRMFIRE contributors (GPL-3.0-or-later).

The 8x9 font in `src/font.h` was drawn for this project (`tools/mkfont.mjs`).

## Freedoom (reference level disk, not shipped)

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
