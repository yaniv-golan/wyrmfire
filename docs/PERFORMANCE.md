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

### The end screen's KILLS (item 4, and why there is no TIME)

The LEVEL CLEAR screen says how many the level cost: "KILLS nn". `program_end` $4DEF -> $4E60: **113 bytes**,
which is 125 fewer than the TIME version it replaces ($4EDD).

**There is no time, and that is a ruling, not an omission.** The clock went through two designs and both were
wrong:

* **counting drawn pictures** -- bumped once per pass of the frame loop, divided by a "pictures per second"
  constant. But a picture costs 4.5 fields in a quiet room and the rate swings by more than an order of
  magnitude under load (measured: 13 pictures in 60 frames at the spawn, 1 in 60 under forced zone reloads),
  so no constant can be right. The first version divided by 50 (the field rate) while counting pictures, so it
read about **4.4x slow** (measured: 113 pictures in 500 fields = 10.0 s of real time, displayed as 2.26 s); dividing
  by a measured 11 was still wrong in any scene busier or quieter than the one it was calibrated in.
* **counting real PAL fields** -- correct in principle, and eight attempts were made. The 6821 clears the field
  latch only on a read of its DATA register (not a CRB read, not a CRB write -- measured, and a version that
  wrote CRB counted 7x high). Polling it missed fields whenever the engine went longer than a field (17,773
  cycles) without a poll: best placement reached 0.86x. An FS interrupt handler installs (the ROM vector at
  $FFE0-$FFFF points through a RAM word at $010C, which the engine can own) but the engine then never draws a
  picture at all -- 0 in 2000 frames against 95 for the build without it -- and masking the disk reads did not
  change that, so the cause is not the transfer. That is a separate item, not solved here.

An approximate clock presented as real was ruled out, so the number is dropped rather than shown wrong. **The
kill count is exact**, so it is what the player gets.

No per-frame cost to argue about: the end-screen work in `cue()` runs once, at the instant a level is cleared.
Removing the clock gave back exactly the 25 cycles a picture that adding it cost (see the table above). The end
screen sits at rows 92/101/110, which do not overlap (`text()` writes nine scanlines, and `draw()`'s own
"LEVEL CLEAR. ENTER" at y=76 covers 76..84).

Three defects came out of building the row, all measured and all still fixed: `number()` is fixed at three digits
(so kills printed 009, and `twodigits()` draws two); `text()` writes nine scanlines, so the old 72/80/87 spacing
overlapped itself and the draw() band; and `cue()` drew to the page that was already on screen without flipping
the SAM, so the row was correct in RAM while the player saw the other page.

## Harness audit (item 2's follow-up): every claim of "visible"

Each harness that asserts something is on the screen, whether it reads the rendered frame (sound) or RAM text
(blind), and what was done about it.

| harness | assertion | blind? | state |
|---|---|---|---|
| `loading-controls.cjs` | the loader's controls are on the loading screen | **was blind** (`screenText`) | **fixed**: rendered-frame glyph check + mode byte + SAM base |
| `end-screen.cjs` | KILLS is on the level-clear screen, and no TIME is | no | frame glyphs decoded from the page the SAM shows, at two kill counts; asserts no "TIME" and no mm:ss anywhere in the end-screen band |
| `hud-keys.cjs` | the HUD's KEY field shows one glyph per key | no | reads the page as glyph rows via `font.h`, and matches against both pages because `back` alternates |
| `loader-clear.cjs` | the loader cleared $0400-$05FF | no (not a visibility claim) | reads memory at the loader's `jmp image_start`; the thing under test IS the RAM |
| `encounter.cjs` | behaviour, plus the hit flash is exactly one picture and SND_HURT plays | no visibility claim | reads the colour-set bit the VDG decodes and `audioPos`, per picture |
| `regions.cjs`, `route.cjs`, `media.cjs`, `profile.cjs` | behaviour and timing | no visibility claim | read engine RAM counters (hp, kills, `$0200`), never text-as-visible |
| `swap.cjs` | the replacement disk's spawn is read | no (not a visibility claim) | reads `px`/`py` from RAM |

### The hit flash (item 1): one picture, and it now actually shows

`hurt()` plays SND_HURT and inverts the VDG's colour set for the picture the hit is drawn in. Two defects, both
measured:

* **It lasted two pictures.** `hurtFlash=2` and the decrement runs *before* `simulate()` on the following pass, so 2
  survived into a second `draw()`. It is 1 now, which covers exactly the picture the hit is drawn on.
* **The sample point matters.** The impact is counted in `simulate()`; the flash is drawn by the `draw()` of the
  NEXT picture. Measured on the real engine: the impact picture has CSS=1, the next has CSS=0, the one after has it
  back. Anyone sampling only up to the impact picture sees no flash at all — which is what made this look broken.

`encounter.cjs` asserts the colour set is inverted on exactly one picture, that it is the picture after the
impact, and that `audioPos` lies inside the SND_HURT asset on it. The asset table holds **offsets from $5000**, not
addresses (`src/disk.h` `ASSET(i)`), so the check adds them. Mutants fail by name: `hurtFlash=2` ("the border
flash lasted 2 pictures (33,34), want exactly 1") and the SND_HURT call removed ("SND_HURT was not the sound in
flight ... audioPos=$0").

**Cost:** +0 bytes; the cycles measure above shows `d99e225` (this plus the clock fix) is 139 cycles per picture
*cheaper* than `0eb8ed5`, because a second inverted picture costs a picture.
