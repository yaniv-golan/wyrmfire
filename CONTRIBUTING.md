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
- **CMOC multiplies two 8-bit values into 8 bits.** With both operands of `*` a `byte` or `signed char`,
  CMOC 0.1.101 emits one unsigned `MUL` and keeps only the low byte, where standard C would promote both to
  `int`: `(sb)8 * (sb)32` gives 0, and a negative operand is wrong even for small products. Make one operand an
  `int`, `(int)a*b`, or use an asm routine (`project()` in `src/native.c` has a signed 8x8 multiply). CI's
  `node tools/check-byte-mul.mjs build/native.s` fails on any such product not listed as known to fit, and
  `test/byte-mul-mutant.sh` checks that it does.
- The engine binary `bin/wyrmfire.bin` must build byte-identically from
  source (`tools/build-engine.sh build`, CI's *Engine build is reproducible*).
