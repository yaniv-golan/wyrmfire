# Performance baselines

The numbers the harnesses are measured against, and every deliberate exception to them. **Re-measure before
claiming a change is free**: a reclaim that frees bytes but costs frames is not free, and a measured exception has
to be written down here or the next change measures against a number nobody can reproduce.

How to measure (all emulated time, so repeat runs are identical — a difference is real, not noise):

    ONE_LEVEL=1 node test/harness/route.cjs   $CLOADM $BUILD      # still and moving fps, resident/region stalls
    node test/harness/regions.cjs $CLOADM $BUILD out.json         # per-region load time (read and unpack)
    node test/harness/encounter.cjs $CLOADM $BUILD                # stationary / dodge / spread fps

`$BUILD` is a `tools/build-engine.sh` directory with the level disk beside the binary.

## Baseline (engine 0.1.0, before the quick wins)

| measure | value |
|---|---|
| route, still (resident) | 6.37 fps — 325 frames in 2,552 fields (median 8, max 11) |
| route, moving (region changes) | 1.11 fps — 16 frames in 719 fields (median 49, max 63) |
| regions, load | median 45 fields (13–68), 149/149 probed |
| regions, stall | **median 40**, max 64 |
| encounter stationary | **15.79 fps** (30 pictures in 95 fields) |
| encounter dodge | 13.04 fps |
| encounter spread | 10.40 fps |
| binary | 10,172 bytes |

## Performance pass (`claude/perf`, from `0493c18`)

The same pictures, drawn with less work. Measured against `0493c18` (sprite scaling) and `2f47134` (main before
it); every row is emulated time and repeats exactly.

| measure | `2f47134` | `0493c18` | this branch |
|---|---|---|---|
| cycles / picture (`cycles-per-picture.mjs`, N=1000 after 3, the still spawn view) | 79,082 | 86,988 | **36,069** (-58.5% / -54.4% against main) |
| the same, turning (`--keys LEFT`, N=300) | 122,274 | 121,483 | 80,389 (-33.8%) |
| the same, walking and turning into new regions (`--keys UP,LEFT`, N=300; disk loads included) | 172,186 | 167,047 | 121,750 (-27.1%) |
| the same, strafing against a wall (`--keys Z`, N=300) | 81,659 | 85,704 | 34,389 (-59.9%) |
| encounter stationary / dodge / spread, fps | 15.63 / 12.14 / 10.29 | 15.66 / 12.00 / 10.00 | **41.67 / 28.08 / 16.94** |
| route, resident | 321 fr / 2,562 flds, median 8, max 11 | 320 / 2,730, median 9, max 17 | 321 / 1,749, median 5, max 13 |
| route, region changes | 16 / 723, median 49, max 63 | 16 / 717, median 50, max 60 | 16 / 681, median 46, max 62 |
| route, the level | 338 pictures, 3,708 fields | 337 pictures, 3,873 fields | 338 pictures, **2,852 fields** |
| regions: the 149 loads, read + unpack = total, fields (`regions.cjs`, see below) | 2,763.4 + 2,076.5 = 4,840.1 | 2,763.5 + 2,076.5 = 4,840.3 | 2,832.4 + 2,077.5 = 4,909.3 |
| regions: one load, median / max | 35.7 / 58.7 | 35.5 / 58.5 | 34.8 / 59.3 |
| a 768-sample effect, fields (`sound.cjs`: fire / blast / door / hurt / pickup) | 26.8 / 26.8 / 30.8 / 28.2 / 27.3 | -- | 26.7 / 27.1 / 26.1 / 27.7 / 26.1 |
| `program_end` / binary | $4FDC / 10,432 bytes | $4FF7 / 10,954 | **$4FE9** (23 bytes below $5000) / 11,145 |

**The gate** (fps >= baseline) passes on all three encounter cases against both commits. The route's 13-field
resident picture (main: 11) is a picture that scales a frame to a new width, which main does not do; `0493c18`'s
worst was 17. The figures are those of the branch head; the profile and the per-commit table below were taken
one commit earlier, before the sound change, which adds 14 cycles a picture (36,054 -> 36,069).

### Region loads: the load is timed, not the pictures round it

`regions.cjs` used to report a "stall": the two pictures around a load minus two resident pictures. That is a
difference against the renderer, so it grows when ordinary pictures get cheaper while the disk does exactly what
it did: with a resident picture down from 6 fields to 3 it read **38 / 63 -> 40 / 68** (median / max) on this
branch, a slowdown that did not happen. The rule "stalls <= baseline" could not be met by making the game faster.

It now times the load itself, from the instruction that enters `diskRead()` to the one after which `currentArea`
is the new region, in two parts:

* **read** -- the seek and the transfer. It waits on the disk's rotation, so a build that reaches the load at a
  different moment gains or loses a revolution (10 fields) on a region: 2,763.4 fields over the 149 regions on
  main, 2,832.4 here (+2.5%, seven revolutions net; the median load is 0.9 field shorter and the longest 0.6
  longer). No code on that path changed.
* **unpack** -- the checksum and the LZ unpack, CPU only: 2,076.5 on main and on `0493c18`, 2,077.5 here (the
  field interrupt's one more instruction).

**The rule:** unpack <= main + 0.5% (2,087) and read <= main + 5% (2,902), as limits `regions.cjs` takes and CI
passes. The 5% is the room rotational phase needs; the unpack limit is what catches a slower loader. Mutant
(`test/pacing-mutants.sh`, in CI): an empty 600-pass loop in `loadArea()` before the unpack fails with "checking
and unpacking the 149 regions took 2229.6 fields in all, more than the 2087 allowed: the load path got slower".
A delay before `diskRead()` is entered is outside the timed window and is the route harness's to see; a small one
inside the read can hide in the 5%.

### Where the time went (cycles a picture, still spawn view, `tools/profile-cycles.mjs`, N=1000)

Inclusive, by phase (the field interrupt is also counted inside whichever phase it lands in, so the rows sum to a
little more than the total):

| phase | `0493c18` | now |
|---|---|---|
| walls (`scene()`: 32 columns, signatures, clear and redraw) | 36,415 | 6,862 |
|   of which clearing columns (`clearColumn`, 7 a picture) | 9,253 | 0 |
| monsters and pickups (`actors()`) | 33,875 | 21,409 |
|   of which the division (`DIV16`, 8 a picture) | 7,831 | in `scaleThing` (about 300 each) |
|   of which 16-bit products and shifts (`MUL16` x44, `shiftLeft` x12) | 5,252 | 96 |
| weapon (`sprite()` + `blit`, then `weaponCols`) | 6,703 | 358 |
| `simulate()` (with `findNearby`) | 6,004 | 4,850 |
| fireballs (`missiles()`) | 321 | 321 |
| keyboard (`key()` x12) | 2,269 | 846 |
| HUD checks, colour set, page flip, markers (`draw()` itself) | 736 | 702 |
| `main()` itself | 614 | 657 |
| field interrupt | 339 | 141 (fewer fields a picture) |
| **total** | **86,988** | **36,054** |

Self time, the top of each list:

| `0493c18` | cycles | now | cycles |
|---|---|---|---|
| `scene` | 19,150 | `scaleThing` (8 calls) | 6,374 |
| `clearColumn` | 9,215 | `project` (11) | 4,030 |
| `DIV16` | 7,798 | `columns` | 3,814 |
| `blit` (weapon) | 5,979 | `blitColumn` (4) | 3,603 |
| `actors` | 5,630 | `findNearby` | 2,710 |
| `drawScaled` | 5,262 | `makeRuns` (2) | 2,218 |
| `MUL16` | 4,229 | `simulate` | 2,120 |
| `project` | 4,031 | `things3d` | 1,748 |
| `blitColumn` | 3,603 | `drawColumns` (7) | 1,637 |
| `band` | 3,157 | `thing` (10) | 1,256 |

### Each change and what it saved (still view; each is one commit, measured on its own)

| commit | change | cycles / picture |
|---|---|---|
| `0493c18` | start | 86,988 |
| `fab08e9` | **Wall columns in assembly**: `scene()`'s loop, `samples()`, `band()`, `eraseBand()` hand-written, same logic | 72,439 (-14,549) |
| `444d3f6` | **Repaint only what changed**: a sprite or a text records the rows it drew over (`DIRT`) and only those are repainted instead of the whole column cleared; a wall band whose edges moved is repainted between the old and the new edge; the weapon is drawn column by column, only where its frame is not already standing | 61,756 (-10,683) |
| `87cca9b` | **`scaleThing()`**: `65535/tz` as a subtraction loop for the high byte and eight shift-and-subtract steps (CMOC's `DIV16`: 975 cycles), the 16-bit products as 8x8 `MUL`s | 52,307 (-9,449) |
| `1361bee` | **`thing()`**: culling and frame choice in assembly; `things+i` as a shift, not `MUL16`; `key()`'s strobe folded at compile time, not `shiftLeft` | 48,059 (-4,248) |
| `83c8cf9` | **The still view**: when the view entries, blend, heading, hatching and door phases are what the last pass used and the page's signatures were made from them, a column is visited only for what a sprite left on it | 40,825 (-7,234) |
| `fd4a04d` | **`things3d()`**: the loop over nearby things in assembly | 38,868 (-1,957) |
| `0a6f2a7` | **`maxRay`** (a thing behind the picture's farthest wall skips the division; nothing in this view) and **the weapon stays** when its rows 124..159 were not touched | 36,747 (-2,121) |
| `a3e7764` | **A leaner painter**: one pass down the column; a hollow band repaints its two edge rows; `DIRT` to `$FE00` | 36,054 (-693); turning 96,164 -> 80,357 |

### One thing in the spawn corridor (cycles a picture, steady; the view without it, then what it adds)

| case | `0493c18`: view + thing | now: view + thing | total, before -> now |
|---|---|---|---|
| guard at 1.5 cells | 49,995 + 37,882 | 8,914 + 46,632 | 87,877 -> 55,546 |
| 2 cells | 44,138 + 26,662 | 8,041 + 29,532 | 70,800 -> 37,573 |
| 3 cells | 44,144 + 16,103 | 8,047 + 19,894 | 60,247 -> 27,941 |
| 4 cells | 44,143 + 13,284 | 8,041 + 15,124 | 57,427 -> 23,165 |
| 6 cells | 44,144 + 8,578 | 8,042 + 8,571 | 52,722 -> 16,613 |
| 8 cells | 44,144 + 7,961 | 8,041 + 7,836 | 52,105 -> 15,877 |
| 12 cells | 44,138 + 7,402 | 8,041 + 7,231 | 51,540 -> 15,272 |
| right edge, (10,20) angle 1 | 44,343 + 18,791 | 8,042 + 12,805 | 63,134 -> 20,847 |
| half behind a pillar, (14,17) angle 27 | 46,136 + 8,663 | 8,049 + 5,511 | 54,799 -> 13,560 |
| beside a nearer wall, (18,25) angle 0 | 44,144 + 8,186 | 8,041 + 5,123 | 52,330 -> 13,164 |
| pickup, 2 cells | 44,144 + 7,681 | 8,041 + 7,579 | 51,825 -> 15,620 |

**Known follow-up, deferred by the owner: the close monster.** A close monster still adds up to about 46,000
cycles a picture: the empty view fell from 44,000 to 8,000, but a monster that stands still is still repainted and
drawn again on every picture (its rows, its columns, and the weapon where it reaches below row 124), and with the
view this cheap that is now most of the picture. The increment is a little larger than before because the old
view already paid for clearing the weapon's five columns. Skipping a sprite that has not changed needs a record
of what was drawn on each column of each page (about 320 bytes) and a second pass over the things; it is not
done. The one-off frame scaled to a new width (`genFrame`, 17,000 cycles plus 9,000 per byte of width) is
unchanged.

### Same pictures: how it is checked

* `test/harness/identity.cjs` plays a scripted run whose inputs change exactly at picture boundaries (the machine
  is stepped one instruction at a time to the `$0200` store) and records a hash of the page on the screen and of
  the game state at every picture: 1,665 pictures -- seeded walking, turning, strafing and firing from the spawn,
  90 cells all over the map, monsters and pickups at every scale, at both edges, casting, in crowds, fireballs,
  the still view, the hatching toggled, alternating views, three doors opened without moving, death, restart and
  the level clear. The game depends on pictures drawn and not on time, so two builds that draw the same thing
  give the same file whatever their speed. Every commit above gives the file `0493c18` gives; its SHA-256 is
  pinned in `test/identity.sha256` and CI checks it.
* `test/harness/sprites.cjs`: the same measurements and the same 12 PNGs as `0493c18`, byte for byte. The harness
  itself changed in one way: it sampled `tdepth`, `c0` and `gW` at the next frame boundary, up to a field into the
  next picture, where `actors()` has already projected the player's own offset and left `tdepth` at 0; once a
  picture took under two fields the nearer-wall case read 0. It now stops on the instruction that stores `$0200`.
  (One reported value differs, the `walls` entry for column 32 at the right edge: that is the byte after
  `rayDistance[]`, not a wall.)
* No rounding changed and nothing is intentionally different. The weapon argument: a mask-and-ink blit W satisfies
  W(f(W(x))) = W(f(x)) for any sequence f of such blits, so a column that still carries the same weapon frame can
  be drawn over and given the frame again, or left alone when nothing touched its rows.

### RAM map

* `DIRT`, 192 bytes at `$FE00-$FEBF`: per page and column, the first row a sprite or a text drew over, the row
  after the last, and the weapon frame standing on the column. Above the stack (which starts at `$FE00` and grows
  down) and below the I/O page; zeroed by `clearSignatures()`. Watched from power-on through 40 region loads, a
  level clear and a restart, and over about 1,700 pictures of play: the only writers are `clearSignatures`, `columns`,
  `markOne`, `weaponCols` and `dirtyAll`; nothing writes `$FEC0-$FEFF`.
* `$F8C0-$F8FF` (the per-column dirty flags) is no longer used.
* Stack: lowest S `$FD91` over the same runs (`0493c18`: `$FD8F`); the scaled-frame cache ends at `$FCFF`.
* Everything else new is in the image's own bss.

### Sound: paced by the field clock

`audioSlice()` is called once a wall column, 32 times a picture, and used to send four samples on every call: 128
a picture, so an effect played as fast as pictures were drawn (18 to 19 fields for a 768-sample effect with one
thing in view on main, 5.5 to 12.4 on this branch before the change). The owner ruled that effects keep their
speed. The pace is now the field interrupt: each field it counts (`fieldTick`, `clock.h`) grants 29 samples of
credit, 28 on every fourth -- **28.75 a field**, which is what 128 a picture came to on main's spawn view (79,082
cycles, 4.45 fields) -- and a call sends its four samples only when four are in credit. One field is taken up a
call; the credit stops at 116 (four fields), so an effect catches up after a slow picture and never runs far
ahead; an effect starts with its first four samples in hand. While IRQ is held (a disk transfer, a cue)
`fieldTick` stands still and so does the effect, as before.

`test/harness/sound.cjs` starts each of the five effects the way the game does, at the spawn with the level's
own things in view, and records every byte `audioSlice()` writes to `$FF20` with its cycle:

| effect (768 samples each) | `2f47134`, fields | this branch, fields | samples sent |
|---|---|---|---|
| fire | 26.8 | 26.7 | the asset's 768, in order, then `$80` |
| blast | 26.8 | 27.1 | the same |
| door (at the first door; main's view there is slower) | 30.8 | 26.1 | the same |
| hurt (a guard beside the player for the hit; a frame is scaled) | 28.2 | 27.7 | the same |
| pickup | 27.3 | 26.1 | the same |

On main the length follows the view (a picture there is 4.45 fields at the spawn, more at the door); here it is
768 / 28.75 = 26.7 fields within a field and a half anywhere. The harness requires the bytes to be the asset's
and the length to be within 2 fields of that. Mutant (`test/pacing-mutants.sh`, in CI): the credit test removed,
so every call sends again -- "fire: 768 samples took 14.7 fields, want 26.7 (28.75 a field): the effect is paced
by the pictures drawn, not by the field clock".

**Cost:** +14 cycles a picture when no effect plays (one `inc` in the field interrupt, twice a picture; the idle
`audioSlice()` is the same three instructions), 36,054 -> 36,069. While an effect plays, a call that sends costs
about 30 cycles more than it did and a call without credit about 25; the samples themselves cost what they
always did, and there are fewer of them a picture. 59 bytes of code (`program_end` $4FAC -> $4FE9). The pictures
and the game state are the same (the identity log does not hash the sound position and its SHA-256 is unchanged);
what a player hears also differs in grain: the four-sample bursts now come at the start of each field instead of
evenly through a picture.

## Measured exceptions

Each is a deliberate trade, with what it bought and what it cost. The rule for a reclaim is fps ≥ baseline and
stalls ≤ baseline; an entry here is a case where that rule was waived by the PM, and why.

**The gate (amended):** a change passes when, over the measured windows, **fps ≥ baseline, OR a measured ±1-field
phase shift where a draw counter shows no added per-frame work**. The second arm is for a one-off draw before the
game starts: it can move a picture across a field boundary either way, and a counter on the new path is what proves
the cost is not per-frame. Baselines in the table above are not restated when an entry here uses that arm.

### `clearColumn` partial unroll, ×8 (frees 599 bytes of engine code)

- **Bought:** `program_end` $4FF9 → $4DA2, **599 bytes** — the space item 5's HUD glyphs need, with headroom over.
- **Cost:** encounter **stationary 15.79 → 15.63 fps** (one field over the window), and dodge 13.04 → 13.03.
  Spread unchanged at 10.40; route resident (8/11) and region changes (49/63) exactly baseline; **region stall
  median 38 / max 64, the same as the commit below it (item 1)** and down from main's 40 — that 40 → 38 drop is
  item 1's, not this commit's. An earlier draft claimed "40 → 37, an improvement" and blamed machine loads: both
  were wrong (a stale binary sat in the run directory; the emulator is deterministic and main reproduces 40).
- **Why it is accepted:** the seek for a variant that keeps the baseline failed on measurement, not on effort. The
  fully unrolled form (baseline speed) is 599 bytes larger than ×8; the fully rolled loop is 26 bytes smaller than
  ×8 but costs 8–10% (14.56 / 11.81 / 9.46). ×4 (615 B freed) and ×16 (567 B) are both worse than ×8 on fps —
  ×4 15.63 / 12.96 / 10.29, ×16 15.63 / 13.03 / 10.40. **All three partial variants give exactly 15.63 on the
  stationary case**, so the cost is a per-call effect rather than per-store: x8's own setup is already minimal
  (`ldx`/`clra`/`ldb #20`, then `decb`+`bne` per eight stores, from `native.lst`), and every address-terminated
  alternative needs Y or U, which CMOC saves and restores around the call — strictly more.

### HUD key glyphs (item 5, costs 77 bytes) — **ACCEPTED**

- **Bought:** the HUD's KEY field shows one glyph per slot (`1` `2` `3` for the keys held, `-` for those not)
  instead of the keys bitmask as a decimal, which read "3" for keys 1 and 2 held.
- **Cost:** `program_end` $4DA2 → $4DEF, **77 bytes**; encounter **stationary 15.63 → 15.79** (back to main's
  figure), **dodge 13.03 → 12.96**, **spread 10.40 → 10.29**. Deterministic across repeated runs.
- **Accepted by the PM** under the amended gate rule below: dodge and spread move by a measured phase shift, and a
  draw counter shows no added per-frame work. **The baseline numbers stay exactly as they are** — this entry
  records the exception, it does not fold the new figures into a baseline.

**Why it moves fps at all, though the field only redraws when the keys change.** Three measurements, each isolating
one variable:

| build | what differs | stationary / dodge / spread |
|---|---|---|
| ×8 (item 5 absent) | — | 15.63 / 13.03 / 10.40 |
| item 5's code **present but never called** (`keysHud` defined, `number()` still called) | code layout only | **15.63 / 13.03 / 10.40** — identical, so layout is NOT the cause |
| `keysHud` called, but drawing exactly what `number()` drew | call path only | **15.63 / 13.03 / 10.40** — identical, so the call is NOT the cause |
| item 5 as shipped | three glyphs drawn instead of one number | 15.79 / 12.96 / 10.29 |

**And the sign is explained by PHASE, not by cost.** A counter on the `keysHud` draw path shows it is called
**exactly twice per boot, on pictures 0 and 1** -- once for each screen page as the HUD is first painted -- and
**never again during any measured window** (0 calls in the stationary, dodge and spread windows, all three).
So item 5 adds no per-frame work at all: two one-off redraws shift when later pictures land relative to field
boundaries, which can move a field count either way. Stationary gaining a field and dodge/spread losing one are
both phase effects of the same two early draws, not a speed difference.

### Field-sync level clock (TIME back on the end screen, costs 0.48% of the CPU) — **ACCEPTED** (2026-11-25)

- **Bought:** the end screen's TIME, counted from real PAL fields and exact across disk loads (details and the
  root cause of the earlier attempt under item 4 below).
- **Cost, at the merged head** (main `775ec6c` merged, review fixes in): a real per-frame cost, so the amended
  gate's phase arm does **not** cover it. The field interrupt takes ~85 cycles a field (8 of them the source
  check), **+376 cycles a picture** (78,706 → 79,082, **+0.48%**). Encounter against main as it now is: **15.63 /
  12.96 / 10.71 → 15.63 / 12.14 / 10.29**; regions stall median 38, max 64 → 63. `program_end` **$4FDC**, 36
  bytes below ASSETS at $5000 (main with the credits screen alone: $4FE0). The clock's code is 328 bytes, the
  source check 12 more; moving the renderer's column cache to low RAM gave back 344, which is what let the
  credits screen and the clock fit together.
  (Before the merge, at `ae892ba`: +341 cycles a picture, 79,047, +0.43%; encounter against main `91abee6`
  15.63 / 12.96 / 10.40 → 15.63 / 12.96 / 10.29; `program_end` $4E50.)
- **Waiver granted by the owner, 2026-11-25**, relayed by the PM: fps ≥ baseline fails on spread (10.71 → 10.29
  against main `775ec6c`, confirmed by the owner for the merged head; first granted as 10.40 → 10.29 against
  `91abee6`) and the clock is a real per-frame cost (+0.48% cycles, +0.43% before the merge), so the phase arm
  does not cover it; the waiver does.
  **The baseline numbers stay exactly as they are** -- this entry records the exception, it does not fold the new
  figures into a baseline.
- **After merging main `775ec6c` (freedoom-credits) and the review fixes -- dodge, accepted 2026-11-25.** Measured
  against main as it now is (15.63 / 12.96 / **10.71**; the credits merge itself moved spread from 10.40), the
  clock build reads **15.63 / 12.14 / 10.29**. Dodge 12.96 → 12.14 was not covered by the first waiver (granted
  for spread); the owner accepted it on 2026-11-25 (below). It is not disk and not the handler's work: the
  WD2797's read log in the dodge run is identical, the handler's non-field-sync branch never runs, and the
  steady-state cost of the fixes is +36 cycles a picture
  (79,046 → 79,082, the source check). What changes is the dodge itself: the player strafes 320 sub-cells instead
  of 256 (X is seen for one more picture), ends a step further along and renders a different view, 173 fields for
  the same 42 pictures instead of 162. The merge without the fixes reads 162, and so do these variants of it:
  +4 or +8 cycles of padding in the handler (after or before the flag clear), and 12 dead bytes giving the fixed
  build's layout. So the step needs the new handler's timing and its layout together; it is an input-phase step in
  the scenario, not a cost per picture. Restoring 12.96 would mean dropping the source check (review item 4).
  **Accepted by the owner, 2026-11-25**, relayed by the PM: the waiver above is extended to dodge 12.96 → 12.14,
  and the source check stays. The baselines stay unrestated.

### Monster and pickup sprites scaled with depth, feet on the floor, occluded per column — **PENDING owner review**

- **Bought** (the owner ruled distance scaling a must): monsters and pickups stand on the floor line of the wall
  projection (79 + 640/z, z in map units) instead of floating above it, are world height × 128 / z rows tall
  (7 map units, the boss 8, pickups 2) with the art's aspect across, are clipped at both screen edges (a monster
  in column 31 used to be culled) and are depth-tested per 8-pixel column, so a monster half behind a pillar shows
  its visible half instead of vanishing or showing whole. Measured by `test/harness/sprites.cjs`.
- **How:** frames are scaled across once into a cache in free RAM above the `$E000` screen (`genFrame`, any width
  3-15 bytes; width 2 is the asset itself and never cached) and down at draw time by repeating or skipping source
  rows (`makeRuns`), one column at a time (`blitColumn`). A thing pays one division (a reciprocal of its depth);
  the row runs and the frame are made only once one of its columns proves visible.
- **Cost, cycles per picture** (`tools/cycles-per-picture.mjs`, N = 1000 after 3; the spawn view has 10 things
  within 18 cells, most behind walls): **79,082 → 86,988 (+7,906, +10.0%)**. Encounter **15.63 / 12.14 / 10.29 →
  15.66 / 12.00 / 10.00**. Route resident **321 fr / 2,562 flds, median 8, max 11 → 320 / 2,730, median 9, max
  17**; region changes 16 / 723, median 49, max 63 → 16 / 717, median 50, max 60; the level 3,708 → 3,873 fields.
  Regions: load median 45 → 46 (max 67 → 71), stall median 38 → 39, max 63 → 63. `program_end` $4FDC → **$4FF7**.
- **Per case** (one guard straight ahead in the spawn corridor unless named; cycles a picture over the same view
  with the thing out of range: old engine **47,096**, new **44,143**, the new one being cheaper with nothing to
  draw because `scene()` no longer stores three unused per-column arrays):

| case | old: + cycles | new: + cycles (steady) | new: first picture at a new width |
|---|---|---|---|
| 1.5 cells | +11,673 | +43,729 | +142,723 |
| 2 cells | +5,828 | +26,656 | +107,916 |
| 3 cells | +5,828 | +16,143 | +80,551 |
| 4 cells | +5,819 | +13,291 | +66,746 |
| 6 cells | +5,830 | +8,580 | (width 2: no scaling) |
| 8 cells | +5,830 | +7,967 | (width 2) |
| 12 cells | +5,819 | +7,396 | (width 2) |
| right edge, (10,20) angle 1 | +2,940 (culled) | +18,945 | +72,421 |
| half behind a pillar, (14,17) angle 27 | +4,820 | +10,652 | (width 2) |
| beside a nearer wall, (18,25) angle 0 | +10,098 | +8,176 | (width 2) |
| pickup, 2 cells | +3,029 | +7,676 | (width 2) |

  The steady cost grows with the area drawn: a close monster covers many columns, and every column a sprite
  touched is cleared and redrawn by `scene()` on that page's next picture. A frame scaled to a new width costs
  about 17,000 cycles plus 9,000 per byte of width, once (measured: widths 4, 5, 7, 9 at 4, 3, 2, 1.5
  cells cost 53,455, 64,408, 81,260, 98,994 cycles over the steady picture); the route made 35 such frames in 337 pictures (3 pictures
  made more than one). The cache holds 800 bytes; when a frame does not fit, it is emptied.
- **Why it is pending:** fps ≥ baseline fails on dodge and spread and the cost is per frame, so the phase arm of
  the gate does not cover it; the owner's ruling makes scaling required, and this entry is for the owner to accept
  or send back. **The baseline numbers stay exactly as they are.**

### Per-commit measurement, `5b2b4c1` (×8) to the branch tip

Every commit built on its own and measured with the same three encounter cases, plus route and regions. This is
the record the entries above refer to; the draw counter is an end-screen count, described under item 4 below.

| commit | what it is | stationary / dodge / spread | route resident | route regions | region stall | end-screen draws in window |
|---|---|---|---|---|---|---|
| `5b2b4c1` | ×8 reclaim | 15.63 / 13.03 / 10.40 | 324 fr / 2563 flds | 16 / 717, median 47, max 63 | median 38, max 64 | 0 |
| `c512619` | + item 5 (HUD glyphs) | **15.79 / 12.96 / 10.29** | 323 / 2695 | 16 / 722, median 46, max 63 | median 38, max 64 | 0 |
| `30d5cd4` | + item 2, original (`$FD`) | 15.63 / 12.96 / 10.71 | 320 / 2524 | 16 / 710, median 48, max 64 | median 39, max 63 | 0 |
| `6fae5b4` | + item 2 **fix** (`$00`) | **15.63 / 12.96 / 10.71** | **320 / 2524** | **16 / 710, median 48, max 64** | **median 39, max 63** | 0 |
| `0eb8ed5` | + item 4 (end-screen TIME/KILLS) | 15.63 / 12.96 / **10.40** | 324 / 2566 | 16 / 716, median 47, max 63 | median 38, max 64 | **0** |
| `7dcb1c1` | + docs only | 15.63 / 12.96 / 10.40 | 324 / 2566 | 16 / 716, median 47, max 63 | median 38, max 64 | 0 |

(These are the SHAs on the branch as pushed. The email rewrite changed every SHA, so the range is `594bbbe..2eae04c`; `2330b31` from an earlier draft no longer exists.)

### CPU cycles per picture

`tools/cycles-per-picture.mjs` steps the machine **one instruction at a time** (`runCycles(end, 1)`, which keeps
the device and event processing) and stops **on the instruction at which `$0200` changed**, so each window boundary
is the exact cycle of that store. Emulation is deterministic and the boundary is exact, so the figure is
independent of the start point; N=250 reads 1.3 cycles/picture higher than N=1000, and the 25-cycle gap between
builds is the same in every column.

**How a row is measured:** from the picture boundary `--after 3` (the game's fourth picture; the intro tune blocks
for hundreds of frames first), across **N = 1000** picture boundaries. Stability, measured on two builds at two
window sizes and two start points:

| build | N=250, after 3 | N=250, after 50 | N=1000, after 3 | N=1000, after 50 |
|---|---|---|---|---|
| `5b2b4c1` | 78,707.3 | 78,707.3 | 78,706.0 | 78,706.0 |
| `0eb8ed5` | 78,732.3 | 78,732.3 | 78,731.0 | 78,731.0 |

(N=250 reads 1.3 cycles/picture higher than N=1000, in both builds. The **25-cycle gap between the two builds is
identical in all four columns**.)

| commit | what | cycles / picture |
|---|---|---|
| `5b2b4c1` | ×8 reclaim | 78,706 |
| `c512619` | + item 5 HUD glyphs | 78,706 |
| `30d5cd4` | + item 2 (`$FD`) | 78,706 |
| `6fae5b4` | + item 2 fix (`$00`) | 78,706 |
| `0eb8ed5` | + item 4 (TIME and KILLS) | **78,731** |
| `d99e225` | + one-picture flash | 78,731 |
| `69f1d2a` | + docs/CI | 78,731 |
| `d91ceea` | + doc corrections | 78,731 |
| `860d5cd` | **TIME dropped, KILLS only** | **78,706** |
| `2eae04c`, `e787fea` | + step-3 docs | 78,706 |
| `ae892ba` | **+ field-sync clock (TIME back), column cache in low RAM** (before the credits merge) | **79,047** |
| `claude/irq-clock` head | + main `775ec6c` (credits) merged, review fixes (IRQ source check) | **79,082** |

What it says:

* **Item 4's clock cost exactly +25 cycles per picture** (`6fae5b4` -> `0eb8ed5`) and dropping it gave exactly
  those 25 back (`d91ceea` -> `860d5cd`). That is the `levelTicks++` — an increment on a word, once per pass.
* **Item 5 costs 0** by this measure (`5b2b4c1` -> `c512619`): the HUD glyph work is not per-frame, which agrees
  with the draw counter (two calls per boot, zero in any measured window). An earlier claim that item 5 cost
  "+90 cycles/picture" is **withdrawn** -- it came from a frame-quantised sampler, not from the engine.
* **Item 2's loader work is 0**: `30d5cd4` and `6fae5b4` are identical, as they must be (loader only).

**An earlier version of this table was quantised by the emulator's frame, not by the instruction.** It sampled
`$0200` only after `runFrames(1)`, so every window was a whole number of `frameCycles` -- **17,784**, which is 11
cycles more than a PAL field (17,773). Its deltas were therefore whole FRAMES: -17,790 and +35,570 are -1 and +2
frames (to within a few cycles of boundary overshoot -- 6 and 2 cycles respectively). That is what made the figures look like field quanta and made the "+354" and "+90" claims
plausible; they are artefacts of the sampling, not properties of the game. The figures in this table replace them
and agree with an independent instruction-stepping measurement, which reports the same -25 cycles per picture.

## On "stalls depend on host load"

**They do not, and my earlier claim that they did was wrong.** Every harness counts the engine's own `$0200`,
which is DRAWN PICTURES, not PAL fields: on this engine a picture costs about **4.4 fields** (measured, 45
pictures in 4.00 s of PAL time), so `$0200` advances about once per 4.4 fields. No wall clock is read anywhere
in them. Repeated runs of the same
binary give identical numbers, including under different machine load. The 40 / 37 / 38 figures came from **three
different binaries**, not from load: main measures **40**, item 1 measures **38**, and ×8 measures **38** — each
reproducible. The "37" was a stale `wyrmfire.bin` left in the run directory by an earlier build, so the run I
attributed to ×8 was not ×8 at all.
The lesson is in the harness itself: **the run directory is a cache.** A measurement is only about the binary if
you put that binary there first; this document's commands should always copy the build into the run dir first.

### The loading screen's controls text (item 2, costs the engine 0 bytes)

The loader sets the VDG to alphanumeric internal and writes one line of cells on the text page. It runs BEFORE
the engine image exists, so it cannot repeat, and program_end is unchanged at $4DEF -- **0 engine bytes**.

**How long it is on screen, exactly:** the harness checks the mode and the page at the loader's own
`launch jmp image_start`, with the CPU parked there so the engine cannot start. It does NOT prove the text stays
up for the whole unpack -- once `image_start` runs, the engine owns the video registers. What it does prove is
that at the last moment the loader has control, the chip is in a mode that shows the page. In practice the text is
visible from the moment the loader writes it until the engine's first `clearScreen` a few pictures later.

**The mode byte is $00, not $FD.** The first version of this set $FF22 = $FD and put up a blank screen: $FD has
bit 7 (AG) SET, which is a GRAPHICS mode on the MC6847 (GM = 111 is the highest-resolution one), so the page was
painted as an empty colour field. Alphanumeric internal is $00: AG clear is text, INTEXT clear is the chip's own
font. Measured on the rendered frame with the CPU parked at the loader's launch jump: $FD leaves the text row with
**0 ink pixels**, $00 leaves all 24 cells as the glyphs CLOADM's font table gives for the bytes in RAM.

The encounter numbers moved -- stationary 15.63, dodge 12.96, **spread 10.29 -> 10.71** -- and the cycles measure
above puts the whole of it at **0 cycles per picture**: the loader's draw is a single one-off before the engine
starts, and item 2's mode fix changes one immediate operand. Every behaviour assertion in the encounter harness is
unchanged (hp 92, spreadVictims 2).

**The spaces were the other half of it.** The message's spaces are written as $60 (this VDG's space cell), not the
ASCII $20 the literal carries: on a $60 field a $20 cell is a dark cell and rendered as a black block between the
words. `loading-controls.cjs` now decodes $20 to '#' rather than to a space, so the regression fails by name
(`ARROWS#TURN##SPACE#FIRES`).

bin 9,685 -> 9,741 bytes, all of it loader-side.

## Harness rule: visible output is proved from the rendered frame

**Any assertion that something is on the screen must read the RENDERED FRAME, not `Session.screenText` alone.**
`screenText` returns the page at $0400 as 16x32 cells whatever mode the VDG is in and wherever the SAM has put
the display. It therefore reports text for a screen a player cannot see — which is exactly how the loading-screen
bug above passed its first harness. A frame check decodes the pixels the VDG produced (against `src/font.h`, the
engine's own glyph data, for text) or counts ink where the row lands; the SAM display base and the `$FF22` mode
byte the chip decodes are part of the evidence, because a correct page in the wrong mode or on the hidden page is
still invisible.

Reading RAM is still right where the thing under test *is* memory (the loader's cleared page, the packed map).
The rule is about claims that something is **visible**.

### The end screen's TIME and KILLS (item 4)

The LEVEL CLEAR screen says how long the level took and how many it cost: "TIME mm:ss  KILLS nn" on row 101,
columns 6..25. The time is real PAL fields, counted from the VDG's field sync (`src/clock.h`); the kill count is
exact. The clock starts when `readLevel()` has the level in play and stops in `use()` the moment the exit is used;
past 99 minutes it reads 99:59.

#### Why the earlier interrupt build never reached the game loop

It was dropped as "the FS interrupt handler installs but the engine then never draws a picture, and masking the
disk reads did not change that". Its source is not in the history, so the cause was found on a reconstruction
(vector at `$010C`, PIA0 CRB bit 0, `ANDCC #$EF`), run in CLOADM at the pinned commit:

* **Installed before the first `loadAssets()`**: no picture. The PC sits at `$3335`, the `@w14` DRQ wait in
  `readTrackPart()`, for ever. The WD2797's status goes `$05` (busy + **Lost Data**) two fields after the IRQ is
  enabled, with X at `$50FE` (byte 254 of the first sector), and then `$14` (Record Not Found + Lost Data, not
  busy) once the multi-sector command runs off the track. The interrupt keeps counting all the while.
* **Installed after `readLevel()`** (so the first loads run masked): it boots, then `regions.cjs` stops at the
  first region stream with "no picture; PC 3307" -- the same wait.
* **The mechanism.** A double-density byte arrives every 32 us, 28.4 CPU cycles (888.6 kHz); the IRQ entry and RTI alone
  cost 34, so an interrupt taken while a byte waits loses it. After Lost Data the WD raises no DRQ for the rest of
  the command (CLOADM's `wd17xx.js` `setDrq`, as MAME), and the fifteen unrolled waits in `readTrackPart()` test DRQ
  only -- not BUSY, no timeout -- so the CPU spins there. That is a hang inside `loadAssets()`, which is why it
  looked like the engine stuck in the load/`waitForDisk()` path.
* **Masking the transfer does work**, contrary to the old note: `PSHS CC; ORCC #$50` round `readTrackPart()`
  boots. But it loses time: 918 of 1000 fields counted from boot, because a masked multi-sector read lasts many
  fields and the PIA's flag holds one.
* The vector is not the problem: the SAM serves `$FFF8` from the firmware's `$BFF8` even in the all-RAM map, and
  CLOADM's firmware points it at `$010C` as Dragon BASIC does (`sam.js` `read()`, `stub.js`).

#### The design

* `fieldIrq()` (vector `$010C`): reads `$FF02`, which is what clears the flag, and calls `clockField()`. About 84
  cycles a field.
* `readTrackPart()` holds IRQ masked for the whole call and polls the flag in its first-DRQ wait. The poll is
  placed so the status is never sampled more than 17 cycles apart, so a first byte is read at most 26 cycles after
  its DRQ (the loop without the poll: 25; the limit is 28.4, so 2.4 cycles of margin). A flag seen while a byte is due is left for the next
  visit. The wait always runs in the gap before each sector's data, so the longest stretch without a poll is one
  sector (8.2 ms) plus its gaps, inside one field. Y counts the fields seen, and they are added to the clock in one
  add at the end. (A first version called `clockField()` once per field there: about ten calls after a whole
  track, enough that `diskRead()` missed the next part's sector by a revolution -- measured as reads that waited
  0.1 field on main and 10.1 here; the single add put those back.)
* `tune()` holds IRQ masked, so the interrupt does not break up the waveform, and polls the flag once a tick
  (57 waves, about 7 ms), outside the wave loop. The clock is stopped whenever a cue plays today, so this only
  keeps the invariant.
* Everything else runs with IRQ enabled. The engine keeps DP at 0 outside `readTrackPart()` and does no stack
  tricks, so the interrupt is safe anywhere else.

#### What it costs

| measure | main (`91abee6`) | clock (`ae892ba`) | main (`775ec6c`, credits) | clock + main + review fixes |
|---|---|---|---|---|
| cycles / picture (`cycles-per-picture.mjs`, N=1000) | 78,706 | **79,047** (+341, +0.43%) | 78,706 | **79,082** (+376, +0.48%) |
| encounter stationary / dodge / spread | 15.63 / 12.96 / 10.40 | 15.63 / 12.96 / 10.29 | 15.63 / 12.96 / 10.71 | 15.63 / **12.14** / 10.29 |
| route: region changes | 16 frames, 710 fields, median 48, max 64 | 16 frames, 728 fields, median 45, max 63 | 16 frames, 714 fields, median 48, max 64 | 16 frames, 723 fields, median 49, max 63 |
| route: campaign clear | 337 pictures, 3654 fields | 340 pictures, 3712 fields | 336 pictures, 3651 fields | 338 pictures, 3708 fields |
| regions: load fields, sum over 149 | 6,095 | 6,155 (+1.0%) | -- | -- |
| regions: load median / max; stall median / max | 44 / 68; 38 / 63 | 45 / 68; 38 / 62 | 45 / 69; 38 / 64 | 45 / 67; 38 / 63 |
| `program_end` / binary | $4E60 / 9,783 bytes | $4E50 / 10,111 bytes | $4FE0 / 10,109 bytes | **$4FDC** (36 bytes below $5000) / 10,432 bytes |

(Dodge in the last column: see the exception entry above -- an input-phase step in that scenario, not a cost;
accepted by the owner on 2026-11-25.)

The cost is the interrupt: ~84 cycles a field, 4.45 fields a picture, about 375 cycles a picture; the column
cache's new address takes about 34 of them back (measured 79,081 before the move). The region loads show no
lost revolution at a part boundary (the WD2797's own command log is identical: 149 `$98`, 134 `$9A`, 75 seeks, no
error status); what remains is rotational phase -- a load that started just in time for its sector on main and
starts 0.5% later here waits a revolution, and the reverse also happens (11 of 283 reads differ by more than half
a revolution, both ways).

#### How it is tested

* `test/harness/clock.cjs`: counts every falling FS edge CLOADM drives onto PIA0 CB1 and requires the clock to
  advance by exactly that many over 500 quiet fields and then a load of every region (149) -- after the merge
  7,557 of 7,557, 3,071 inside a masked transfer -- with no edge ever finding the flag still set. Both ends are
  sampled where IRQ is unmasked and the flag is clear, so nothing is pending. Then three more checks:
  **spacing** -- every status read `readTrackPart()` makes is timed by the emulator, and two in a row with no data
  read between them are at most 17 cycles apart (measured 17); **stray IRQs** -- PIA0's HS interrupt is enabled for
  50 fields and the clock still counts only field sync (50 of 50) while the engine still draws (2 pictures: the
  HS interrupt comes every 57 cycles and takes most of the CPU), then an interrupt is raised in CLOADM's 6551
  each field for 20 fields (20 of 20, 6 pictures, the 6551's interrupt cleared) -- a handler that does not
  acknowledge either source runs back to back and draws nothing; the engine never programs the 6551 itself, so
  that case rests on CLOADM's model of it; **forced phase** -- a field flag is injected at every poll over 24 region
  loads, so the `@fs` path runs back to back and a DRQ lands in every part of it: every flag event counted (103,667
  of 103,667 in the latest run), every read clean, `@d0c` reached 8 times (a natural run reaches it about once in
  150 loads).
* `test/clock-mutants.sh`, seven mutants, each failing the harness by name: the poll removed ("the clock counted
  5210 of 7557 fields"); the transfer left unmasked ("no picture", the original hang); `@d0c` not counting its
  field ("the clock counted 7556 of 7557"); four cycles more on the S4->S1 path ("status reads were 21 cycles
  apart"); the handler counting every IRQ ("with HS IRQ on, the clock counted 10538 for 50 fields"); no PIA0 port A
  read ("no picture drawn in the 50 fields with HS IRQ on"); no 6551 status read ("0 pictures in the 20 fields and
  its interrupt still pending").
* `test/harness/end-screen.cjs`: the row decoded from the rendered page must read exactly the time the clock
  stopped at, at 01:03, 59:59 and past 99 minutes (99:59), with the kills; the clock must be stopped on the end
  screen.

The two older designs stay ruled out: counting drawn pictures (a picture costs 4.5 to 60 fields) and polling the
flag from the main loop (it misses fields whenever the loop goes a field without a poll; best placement 0.86x).

## Harness audit (item 2's follow-up): every claim of "visible"

Each harness that asserts something is on the screen, whether it reads the rendered frame (sound) or RAM text
(blind), and what was done about it.

| harness | assertion | blind? | state |
|---|---|---|---|
| `loading-controls.cjs` | the loader's controls are on the loading screen | **was blind** (`screenText`) | **fixed**: rendered-frame glyph check + mode byte + SAM base |
| `end-screen.cjs` | TIME and KILLS are on the level-clear screen | no | frame glyphs decoded from the page the SAM shows, at three clock values and kill counts; the row must equal the time the clock stopped at |
| `hud-keys.cjs` | the HUD's KEY field shows one glyph per key | no | reads the page as glyph rows via `font.h`, and matches against both pages because `back` alternates |
| `loader-clear.cjs` | the loader cleared $0400-$05FF | no (not a visibility claim) | reads memory at the loader's `jmp image_start`; the thing under test IS the RAM |
| `encounter.cjs` | behaviour, plus the hit flash is exactly one picture and SND_HURT plays | no visibility claim | reads the colour-set bit the VDG decodes and `audioPos` at each exact picture boundary |
| `regions.cjs`, `route.cjs`, `media.cjs`, `profile.cjs` | behaviour and timing | no visibility claim | read engine RAM counters (hp, kills, `$0200`), never text-as-visible |
| `swap.cjs` | the replacement disk's spawn is read | no (not a visibility claim) | reads `px`/`py` from RAM |

### The hit flash (item 1): one picture, and it now actually shows

`hurt()` plays SND_HURT and inverts the VDG's colour set for the picture the hit is drawn in. Two defects, both
measured:

* **It lasted two pictures.** `hurtFlash=2` and the decrement runs *before* `simulate()` on the following pass, so 2
  survived into a second `draw()`. It is 1 now, which covers exactly the picture the hit is drawn on.
* **The sample point matters.** The impact is counted in `simulate()` and the same pass's `draw()` shows the
  flash. This bullet used to say the flash came on the NEXT picture; that was the per-frame sampler, not the
  engine. Sampled at the exact picture boundary (the instruction after the `$0200` store), main and the clock build
  agree: picture 33 is the first that ends with the impact counted, it is the one picture with CSS=0, and 34 has
  it back. A frame boundary can fall between `draw()`'s CSS write and its `$0200` store, so a per-frame sample
  could show the flash one picture early or late, and the clock's 375 cycles a picture moved it by one.

`encounter.cjs` asserts, at the exact picture boundaries, that the colour set is inverted on exactly one picture,
that it is the picture the impact was counted in, and that `audioPos` lies inside the SND_HURT asset on it. The
asset table holds **offsets from $5000**, not addresses (`src/disk.h` `ASSET(i)`), so the check adds them. Mutants
fail by name (re-measured with the exact samples): `hurtFlash=2` ("the flash was on pictures [33,34], want exactly
[33]"), the flash removed ("on pictures [], want exactly [33]") and the SND_HURT call removed ("SND_HURT was not
the sound in flight on the flash picture").

**Cost:** +0 bytes; the cycles measure above shows `d99e225` (this plus the clock fix) is 139 cycles per picture
*cheaper* than `0eb8ed5`, because a second inverted picture costs a picture.
