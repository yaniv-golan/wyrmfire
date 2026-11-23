# Python reference converter

`convert.py` is the reference for `converter/wyrmfire-convert.js`: for the same
WAD and map, both must produce byte-identical disks (and identical results at
every intermediate stage, see `test/parity/`). It stays here until parity is
established and accepted. Parity has been run on every map of Freedoom 0.13.0
`freedoom1.wad` (36 maps) and `freedoom2.wad` (32 maps), only.

    pip install -r requirements.txt     # numpy
    python3 convert.py freedoom1.wad --map E1M1 out/

## Design notes

The reference produces the level disk directly (no generated C headers) and
avoids anything whose result could differ between platforms:

| Choice | Why |
|---|---|
| Assets go into an HGA1 block on the disk (`assets.py`); `levelpack.py` writes the HGR2 pack | The engine binary embeds no WAD data |
| No wall-texture atlas or other unused tables; no Pillow | Only what the engine reads is produced |
| Font, `cosine`, `heights`, `rayOffset` live in the engine (`src/font.h`, `src/tables.h`) | Engine-owned, not WAD data |
| The 96 view-angle cos/sin come from a fixed Taylor series (`atlas.trig_table`) | libm/SIMD results differ across platforms; +,-,*,/ do not |
| `math.sqrt(dx*dx+dy*dy)` rather than `math.hypot` | Same reason |
| Note phases from a 128-entry table computed once at 60 digits | Same reason |
| Nearest-cell searches iterate cells in sorted order | Ties do not depend on set order |
| Any map name; MIDI (Freedoom) as well as MUS music; a cue channel that plays nothing falls back to the lowest melodic channel | Generality |
| Maps taller than the grid trim rows that hold no reachable cell | Lossless; the map plays the same |
| Every level-pack/engine limit raises `LimitError` naming the limit | No silent truncation |
| Lump names end at the first NUL; malformed WADs raise `WadError` | Robustness |

The archive layer (zip, LHA, split self-extractors) runs before this pipeline
and exists only in JavaScript; it is tested against independent encoders
(Python zipfile, Node zlib, jlha) and decoders (lhasa) instead.
