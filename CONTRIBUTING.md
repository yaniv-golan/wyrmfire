# Contributing

- **Never commit a commercial WAD or its converted output.** That means no
  `DOOM.WAD`, `DOOM1.WAD`, `DOOM2.WAD` or any other non-free IWAD/PWAD, and
  nothing made from one: level disks (`.vdk` under any name), `WYRMFIRE.DAT`
  or `WYRMFIRE.LVL` contents, extracted lumps, screenshots or recordings.
  Convert your own copy locally and keep the result on your machine.
- Freedoom is the only level data used in tests, CI and the README media. No
  level disk is committed, Freedoom's included; CI rebuilds it.
- `.gitignore` excludes `*.wad`, `*.WAD` and `*.vdk`. The repository guard
  (`node tools/guard/scan.mjs .`, run in CI) fails on WAD headers and
  directories, level-data file types, and converter output under any name
  (an HGA1 asset block or HGR2 level pack, inside a VDK or bare).
- No BASIC or DOS ROM is used or committed; WYRMFIRE runs on CLOADM's
  built-in firmware.
- The engine binary `bin/wyrmfire.bin` must build byte-identically from
  source (`tools/build-engine.sh build`, CI's *Engine build is reproducible*).
