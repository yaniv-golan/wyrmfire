# Freedoom and the HGR2 limits

Freedoom 0.13.0 (`freedoom1.wad`, SHA-256 `7323bcc1…703d`), measured with
`node tools/fit-report.mjs freedoom1.wad` (every limit lifted, then
compared) and, for stalls, in CLOADM with the committed engine.

## HGR2 limits

- Regions are read to the top of the 12,800-byte AREA window (`$7A00-$ABFF`)
  and unpacked forward in place; the converter checks every region against
  that rule.
- The grid (`$AC00-$DFFF`) holds up to 104 rows of 128 cells.
- The header sits at sector 30, the asset block at 0-29; regions start at
  sector 42 and skip the directory tracks (576-593, 720-737) without spanning
  them: up to 2,802 data sectors.
- Up to 64 objects; a 3,072-byte header; a 7,680-byte asset block
  (`$5000-$6DFF`). Anything larger is refused with a `LimitError` naming the
  overflow.

## Freedoom E1M1

| | Freedoom E1M1 | HGR2 limit |
|---|---|---|
| Reachable cells | 1,598 | – |
| Grid | 66 × 57 (55 rows used) | 128 × 104 |
| Objects | 51 | 64 |
| Regions (4×4-cell clusters) | 149 | 255 |
| Cells per region (min / median / max) | 1 / 12 / 16 | 16 |
| Compressed sectors per region (min / median / mean / max) | 2 / 17 / 16.8 / 33 | in-place rule (≤ 50) |
| Level pack | 2,514 sectors, last sector 2,600 | 2,880 |
| Header | 2,795 bytes | 3,072 |
| Asset block | 6,081 bytes | 7,680 |

E1M1 is the release level disk (`release/expected.json`).

## Region-crossing stalls (E1M1, CLOADM, committed engine)

- **Walking** (`test/harness/route.cjs`, stock spawn to the exit, 342
  pictures in 3,692 PAL fields): 16 region crossings, median **49**, max
  **63** fields (0.98 / 1.26 s); resident pictures median 8 fields.
- **Per region** (`test/harness/regions.cjs`, the player placed in each of
  the 149 regions in turn): the stall beyond a resident picture is median
  **40**, max **64** fields. By compressed size: under 10 sectors median 17
  (max 38); 10-19 median 38 (max 49); 20-29 median 47 (max 63); 30-33
  median 56 (max 64). Least-squares fit: 11.3 + 1.48 × sectors fields.

## Other Freedoom maps

8 of the 36 phase 1 maps fit (E1M1, E1M8, E2M2, E2M8, E3M2, E3M6, E3M7,
E3M8; E3M7 reaches only 4 cells) and 3 of the 32 phase 2 maps (MAP01, MAP30,
MAP31). The rest exceed the object count (most often), the 3,072-byte
header, the disk, the 255-region index, the 104 rows or the 128 columns.
Three phase 1 maps put the player start on a cell the inside/outside test
rejects (E1M2, E4M4, E4M6), a converter limitation with overlapping
one-sided lines.

## Known limit: Doom II-format IWADs

The asset block takes its music cues from `D_E1M1`, `D_INTER` and
`D_VICTOR`, which Doom II-format IWADs (such as Freedoom's `freedoom2.wad`)
do not have, so converting any of their maps stops with
`WAD has no lump D_E1M1`, even where the map itself fits HGR2 (MAP01, MAP30,
MAP31). Supporting them needs a per-IWAD lump fallback in both the converter
and the Python reference; the release map is Freedoom phase 1 E1M1.
