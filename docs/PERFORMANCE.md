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

### HUD key glyphs (item 5, costs 77 bytes) — **AWAITING A RULING**

- **Bought:** the HUD's KEY field shows one glyph per slot (`1` `2` `3` for the keys held, `-` for those not)
  instead of the keys bitmask as a decimal, which read "3" for keys 1 and 2 held.
- **Cost:** `program_end` $4DA2 → $4DEF, **77 bytes**; encounter **stationary 15.63 → 15.79** (back to main's
  figure), **dodge 13.03 → 12.96**, **spread 10.40 → 10.29**. Deterministic across repeated runs.
- **NOT an approved baseline.** The PM accepted exactly ONE exception (×8's stationary). Dodge −0.07 and spread
  −0.11 have had no ruling, so they are recorded here as **facts awaiting one**, not folded into a new baseline.
  The ×8 exception and this one are separate entries on purpose.

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

The loader sets the VDG to alphanumeric internal ( = $FD: AG=1, V2..V0=111) and writes one line of cells on
the text page while the level unpacks. It runs BEFORE the engine image exists, so it cannot repeat, and
program_end is unchanged at $4DEF -- **0 engine bytes**, exactly as intended.

The encounter numbers moved again -- stationary 15.63, dodge 12.96, **spread 10.29 -> 10.71** -- and that is the
same phase effect recorded above, not a speed-up: the loader's draw is a single one-off before the game starts.
Every behaviour assertion in the encounter harness is unchanged (hp 92, spreadVictims 2).

bin 9,685 -> 9,741 bytes, all of it loader-side.
