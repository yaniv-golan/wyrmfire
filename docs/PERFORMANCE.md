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

### Per-commit measurement, `28d5ff4` (×8) to the branch tip

Every commit built on its own and measured with the same three encounter cases, plus route and regions. This is
the record the entries above refer to; the draw counter is an end-screen count, described under item 4 below.

| commit | what it is | stationary / dodge / spread | route resident | route regions | region stall | end-screen draws in window |
|---|---|---|---|---|---|---|
| `28d5ff4` | ×8 reclaim | 15.63 / 13.03 / 10.40 | 324 fr / 2563 flds | 16 / 717, median 47, max 63 | median 38, max 64 | 0 |
| `61e6084` | + item 5 (HUD glyphs) | **15.79 / 12.96 / 10.29** | 323 / 2695 | 16 / 722, median 46, max 63 | median 38, max 64 | 0 |
| `00a2568` | + item 2, original (`$FD`) | 15.63 / 12.96 / 10.71 | 320 / 2524 | 16 / 710, median 48, max 64 | median 39, max 63 | 0 |
| `5d681e8` | + item 2 **fix** (`$00`) | **15.63 / 12.96 / 10.71** | **320 / 2524** | **16 / 710, median 48, max 64** | **median 39, max 63** | 0 |
| `77b9e02` | + item 4 (end-screen TIME/KILLS) | 15.63 / 12.96 / **10.40** | 324 / 2566 | 16 / 716, median 47, max 63 | median 38, max 64 | **0** |
| `d8787e9` | + docs only | 15.63 / 12.96 / 10.40 | 324 / 2566 | 16 / 716, median 47, max 63 | median 38, max 64 | 0 |

(SHAs are the post-email-rewrite ones; the trees are identical to `2330b31..d8787e9` before it.)

What it says:

- **Item 2's fix costs nothing measurable.** `00a2568` and `5d681e8` are identical on every one of the twelve
  numbers — expected, since the only change is one immediate operand in loader code that runs before the engine.
- **Item 4 costs nothing per frame.** Its end-screen draws are **0 in every measured window** (all three encounter
  cases, on every commit), because `cue()` runs once, at the instant a level is cleared, and the harness windows
  are all mid-level. The spread figure moving 10.71 → 10.40 is a phase change under the amended gate rule, from
  the two `levelTicks++` in the loop and nothing else; stationary and dodge did not move at all. Note it lands back
  on ×8's own 10.40, which is the clearest evidence it is a phase artefact rather than a cost.
- **Route and regions are flat** across the whole branch (resident 320–324 pictures in 2524–2695 fields, regions
  16 pictures every time, stall median 38–39, max 63–64) — the same band main lives in.

So the movement is **the extra drawing work**: three `text()` calls, each writing nine scanlines, where there was
one `number()` call. It is not per-frame, and it is not layout; it is the frame on which the keys change, when the
HUD is repainted. Stationary improves because that encounter's window ends on a different picture once the field
takes longer to draw; dodge and spread each lose a little. This is a real, explained cost — not an artefact.

## On "stalls depend on host load"

**They do not, and my earlier claim that they did was wrong.** Every harness counts emulated PAL fields (`$0200`
incremented by the engine's own frame loop); no wall clock is read anywhere in them. Repeated runs of the same
binary give identical numbers, including under different machine load. The 40 / 37 / 38 figures came from **three
different binaries**, not from load: main measures **40**, item 1 measures **38**, and ×8 measures **38** — each
reproducible. The "37" was a stale `wyrmfire.bin` left in the run directory by an earlier build, so the run I
attributed to ×8 was not ×8 at all.
The lesson is in the harness itself: **the run directory is a cache.** A measurement is only about the binary if
you put that binary there first; this document's commands should always copy the build into the run dir first.

### The loading screen's controls text (item 2, costs the engine 0 bytes)

The loader sets the VDG to alphanumeric internal and writes one line of cells on the text page while the level
unpacks. It runs BEFORE the engine image exists, so it cannot repeat, and program_end is unchanged at $4DEF --
**0 engine bytes**, exactly as intended.

**The mode byte is $00, not $FD.** The first version of this set $FF22 = $FD and put up a blank screen: $FD has
bit 7 (AG) SET, which is a GRAPHICS mode on the MC6847 (GM = 111 is the highest-resolution one), so the page was
painted as an empty colour field. Alphanumeric internal is $00: AG clear is text, INTEXT clear is the chip's own
font. Measured on the rendered frame with the CPU parked at the loader's launch jump: $FD leaves the text row with
**0 ink pixels**, $00 leaves all 24 cells as the glyphs CLOADM's font table gives for the bytes in RAM.

The encounter numbers moved again -- stationary 15.63, dodge 12.96, **spread 10.29 -> 10.71** -- and that is the
same phase effect recorded above, not a speed-up: the loader's draw is a single one-off before the game starts.
Every behaviour assertion in the encounter harness is unchanged (hp 92, spreadVictims 2).

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

### The end screen's TIME and KILLS (item 4, costs 62 engine bytes)

`levelTicks` counts PAL fields, so the LEVEL CLEAR screen can say how long the level took and how many it cost:
"TIME mm:ss  KILLS nn". `program_end` $4DEF -> $4EDD, **62 bytes**.

No per-frame cost, and the counter shows it: an end-screen draw count taken on every encounter window of every
commit is **0**, because `cue()` runs once, at the instant a level is cleared, and every measured window is
mid-level. The two `levelTicks++` in the main loop are the only per-frame addition, and they are an increment on a
word.

Spread moved 10.71 -> 10.40 on this commit while stationary and dodge did not move at all (15.63 / 12.96 either
side), and 10.40 is exactly ×8's own baseline figure — which is what a phase artefact looks like: with the draw
counter at 0, the movement is when pictures land against field boundaries, not extra work. It passes under the
amended gate rule's second arm. See the per-commit table above for the whole branch.

Three defects came out of building it, all measured: `number()` is fixed at three digits (so mm printed 001 and
kills 009); `text()` writes nine scanlines, so the old 72/80/87 rows overlapped and `draw()`'s own
"LEVEL CLEAR. ENTER" at y=76 crossed the TIME row (the end screen is now at 92/101/110); and `cue()` drew to the
page that was already on screen without flipping the SAM, so the row was correct in RAM and the player saw the
other page. The values are checked at two different times and kill counts, read back from the frame's glyphs.

## Harness audit (item 2's follow-up): every claim of "visible"

Each harness that asserts something is on the screen, whether it reads the rendered frame (sound) or RAM text
(blind), and what was done about it.

| harness | assertion | blind? | state |
|---|---|---|---|
| `loading-controls.cjs` | the loader's controls are on the loading screen | **was blind** (`screenText`) | **fixed**: rendered-frame glyph check + mode byte + SAM base |
| `end-screen.cjs` | TIME and KILLS are on the level-clear screen | no (new) | frame glyphs on the page the SAM shows, two value pairs |
| `hud-keys.cjs` | the HUD's KEY field shows one glyph per key | no | reads the page as glyph rows via `font.h`, and matches against both pages because `back` alternates |
| `loader-clear.cjs` | the loader cleared $0400-$05FF | no (not a visibility claim) | reads memory at the loader's `jmp image_start`; the thing under test IS the RAM |
| `encounter.cjs`, `regions.cjs`, `route.cjs`, `media.cjs`, `profile.cjs` | behaviour and timing | no visibility claim | read engine RAM counters (hp, kills, `$0200`), never text-as-visible |
| `swap.cjs` | the replacement disk's spawn is read | no (not a visibility claim) | reads `px`/`py` from RAM |
