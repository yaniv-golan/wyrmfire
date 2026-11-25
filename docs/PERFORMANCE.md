# Performance baselines

The numbers the harnesses are measured against, and every deliberate exception to them. **Re-measure before
claiming a change is free**: a reclaim that frees bytes but costs frames is not free, and a measured exception has
to be written down here or the next change measures against a number nobody can reproduce.

How to measure (all emulated time, so repeat runs are identical — a difference is real, not noise):

    ONE_LEVEL=1 node test/harness/route.cjs   $CLOADM $BUILD      # still and moving fps, resident/region stalls
    node test/harness/regions.cjs $CLOADM $BUILD out.json         # per-region load and stall
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
