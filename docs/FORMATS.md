# Level disk formats

All multi-byte values are big-endian (6809 order). The authoritative
definitions are `tools/reference/levelpack.py`, `assets.py` and `disk.py`,
mirrored by `converter/wyrmfire-convert.js` and read by `src/disk.h`.

## Disk

An 80-track, double-sided, 18-sector DragonDOS VDK (12-byte `dk` header).
Directory copies on tracks 16 and 20 (logical sectors 576-593 and 720-737).

| File | Logical sectors | Contents |
|---|---|---|
| `WYRMFIRE.DAT` | 0-29 | HGA1 asset block (≤ 7,680 bytes) |
| `WYRMFIRE.LVL` | 30-41, then regions from 42 | HGR2 level pack; its directory entry lists one extent per run between directory tracks |
| `CREDITS.TXT` | from the sector after the last region | Freedoom disks only: the Freedoom credit, a note that the data is modified, the trademark line and Freedoom's `COPYING.adoc` verbatim (UTF-8, LF, about 2.5 KB). Written only if it fits; `info.credits` gives its size, `"does not fit"`, or `null` for a non-Freedoom WAD. The engine does not read it |

## Engine RAM map

| Range | Use |
|---|---|
| `$0200-$0207` | picture markers the harnesses read (frame count, angle, cell, health, ammo, level, kills) |
| `$0208-$0387` | renderer column cache (2 pages x 32 columns x 6 bytes) |
| `$0388-$03C7`, `$03C8-$03DF` | door phases; sprite row runs (one byte per source row) |
| `$0400-$1BFF`, `$E000-$F7FF` | screens |
| `$1C00-$4FFF` | engine (code, data, font, tables) |
| `$5000-$6DFF` | ASSETS: HGA1 block (7,680 bytes) |
| `$6E00-$79FF` | PACK: HGR2 header (3,072 bytes) |
| `$7A00-$ABFF` | AREA: unpacked region; the compressed region is read to the top of this window and unpacked in place |
| `$AC00-$DFFF` | GRID: up to 104 rows of 128 cells (13,312 bytes) |
| `$F800-$F97F` | engine arrays outside the image: `wind`, `waitForAttack`, `nearby`, `dirtyCols` (2 x 32), `aimColumn`, `aimDepth` (64 bytes each) |
| `$F980-$F9DF` | scaled-frame cache entries ({source, data, width}, ended by a zero source) |
| `$F9E0-$FCFF` | scaled-frame cache: monster and pickup frames scaled across to 3-15 bytes, 24 rows |
| `$FD00-$FDFF` | stack (from `$FE00` down; lowest seen over a whole level: `$FD9B`) |

The ranges outside the image are not loaded; `main()` zeroes `$0208-$03FD`, and `readLevel()` sets what the
engine reads from `$F800` up before the first picture. `test/harness/boot.cjs` reads their addresses from the
`#define`s in `src/`, so the harnesses can name them like the symbols in the link map.

## HGR2 level pack (`WYRMFIRE.LVL`)

A 3,072-byte header at logical sector 30 (read to `$6E00`). Each region's LZ
stream, padded to whole sectors, sits at the absolute sector listed in the
header; regions start at sector 42 and never span a directory track.

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `HGR2` |
| 4 | 2 | grid bytes (128 × rows, ≤ 13,312) |
| 6 | 1 | object count (≤ 64) |
| 7, 8, 9 | 1 each | spawn cell x, y; angle 0-31 |
| 10 | 1 | door cell count |
| 11 | 1 | region count (≤ 255) |
| 12-27 | 8 × 2 | offsets of: door cells (words), door groups, zone index (32 per 4 rows), region start sectors (words, absolute), region sector counts, region unpacked sizes (words), LZ-packed grid, objects (x, y, kind triples) |
| 28 | 2 | offset of the per-region 16-bit byte-sum checksums |
| 30 | 2 | first region sector (42) |

In-place rule: with the compressed region in the last *n* sectors of the
12,800-byte window, unpacking forward from the window start must never write
past the next unread input byte (checked after every LZ token). The converter
refuses any region that breaks it.

Grid cell bits: 0-3 links east/west/south/north, 4 door, 5 exit, 6-7 wall
style or door lock (secret exits set 5 and 6). A region unpacks to a 16-byte
slot table plus 768 bytes per cell: eight 96-entry planes (wall top and
bottom, portal top and bottom, wall and portal depth, portal kind, edge
flags), one entry per 3.75° of view angle.

## HGA1 asset block (`WYRMFIRE.DAT`)

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `HGA1` |
| 4 | 2 | total length (≤ 7,680; read to `$5000`) |
| 6 | 2 | 16-bit sum of bytes 8 .. length−1 |
| 8 | 20 × 4 | (offset, length) of each entry |

Entries, in order: sprites `guard`, `imp`, `impCast`, `fireball`, `boss`
(16 px wide; mask/ink byte pairs), `fist`, `weapon`, `flash`, `shotgun`
(40 px); faces `marine`, `wounded` (24 × 25, 1 bit); cues `introNotes`,
`interNotes`, `victoryNotes` (phase-high, phase-low, ticks triples ending
0,0,0); sounds `snd_fire`, `snd_blast`, `snd_door`, `snd_hurt`, `snd_pickup`
(4 kHz 6-bit DAC samples); `credits`, the level disk's lines for the
engine's credits screen (each NUL-terminated, ≤ 32 characters, codes 32-90):
`LEVEL DATA: FREEDOOM (BSD)` and `MODIFIED FOR THE DRAGON 64` for a
Freedoom WAD (identified by SHA-256), else `LEVEL DATA: YOUR OWN WAD`.

## LZ

Control byte c: c < 128 copies c + 1 literal bytes; c ≥ 128 copies (c & 127) + 3
bytes from a signed 16-bit negative distance.

## Converter inputs

`convert()`, the CLI and the worker take the WAD as distributed:

| Input | Handling |
|---|---|
| `.wad` | used as is |
| `.zip` | stored (0) and deflated (8) entries, CRC-32 checked; searched for `DOOM1.WAD` (else the only `.wad`), or for split parts / an inner archive |
| self-extracting `.exe` | a stub followed by a zip (or an LHA archive); the zip is found by its end-of-central-directory record, and stored offsets are accepted whether they count from the file or from the start of the archive |
| split parts `NAME.1`, `NAME.2`, ... | joined by plain concatenation in ascending numeric order, then read as a self-extractor; a `.DAT` control file is ignored |
| `.lzh` / `.lha` | header levels 0-2; methods `-lh0-`, `-lh1-`, `-lh4-`..`-lh7-`; CRC-16 checked |

**The shareware download.** `doom19s.zip` holds `DEICE.EXE`,
`DOOMS_19.1`, `DOOMS_19.2`, `DOOMS_19.DAT` and `INSTALL.BAT`. Joined as
`.1` then `.2`, the parts form a PKZIP self-extractor: a 15,769-byte
PKLITE-compressed DOS stub (`MZ`, banner at `0x1E`) followed by a zip of 20
files (2,433,820 bytes compressed, 5,515,076 extracted), `DOOM1.WAD` among
them (the repository owner's measurement with 7-Zip; no id Software file is
used here). The converter joins the parts, finds the zip, and extracts
`DOOM1.WAD`. Its compression method has not been checked here: store and
deflate are supported; any other method stops with
`Unsupported zip method N (name)`.

The joined parts must end exactly with the zip's end record, so a missing or
misordered part is reported, not misread: `DOOMS_19.2 is missing`,
`DOOMS_19.1+2 do not form an archive: a part is missing, damaged or out of
order`. Other errors also name the problem, e.g.
`This zip has no DOOM1.WAD inside`, `Unsupported LHA method -lh3-`.

After extraction the WAD goes through the same checks as a bare one.
`options.sha256` (CLI `--sha256`) pins its hash, and `info.source` reports
its name, container, SHA-256 and, for a known release, which one
(`KNOWN_IWADS`: Doom shareware and registered v1.9 by MD5 and SHA-1 from the
Doom Wiki, Freedoom 0.13.0). Zip deflate uses
`DecompressionStream('deflate-raw')` in `convertAsync` where the platform has
it, and a built-in inflater otherwise.
