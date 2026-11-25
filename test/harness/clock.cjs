// The level clock counts every PAL field, disk transfers included.
//
// The oracle is the emulator's own field sync: every falling edge CLOADM drives onto PIA0 CB1 is counted here,
// and over a known run the engine's clock (clockSeconds*50 + clockTicks) must advance by exactly that many.
// The run has a quiet stretch and then a load of every disk region of the level (the player is moved onto each
// region, as regions.cjs does), so it crosses many sector transfers, which hold IRQ masked and count their fields
// by polling (src/floppy.h). The harness also requires that fields really did fall inside readTrackPart with IRQ
// masked -- a run that never exercised that path proves nothing about it.
//
// Both ends of the run are sampled at a frame boundary where IRQ is unmasked and the field flag is clear, so no
// field is pending in the flag or in readTrackPart's Y. A real falling edge that finds the flag still set is a
// field the engine lost (the flag is one deep), so the unforced run also requires none.
//
// Three more checks, each with its own exact count:
//   * spacing -- every status read ($FF40) readTrackPart makes is timed by the emulator; two in a row with no
//     data read or command between them must be at most 17 cycles apart (src/floppy.h's bound; a DD byte gives
//     28.4). This is what keeps a poll from costing a byte, measured rather than argued.
//   * stray IRQs -- the two other sources on the IRQ line, each for a window of play: PIA0's HS interrupt (15,625
//     a second, enabled for 50 fields) and the 6551 ACIA (an interrupt raised in CLOADM's 6551 every field for 20
//     fields; the engine never programs the ACIA to raise one itself). Only field sync may count, so the clock
//     must still match the field flag's events exactly; and the handler must acknowledge the other source, or
//     the IRQ line stays down, the handler runs back to back and the engine never draws -- so the window must
//     see a picture drawn ($0200 advance), and the ACIA's interrupt must be clear at the end.
//   * forced phase -- a field flag is injected every time the wait loop polls it, over a run of region loads,
//     so the @fs path runs back to back and a DRQ lands in every part of it, including @d0c (a byte due just
//     after the flag is cleared), which a natural run reaches about once in 150 loads. The clock must equal the
//     flag-set events (real and injected), every read must succeed, and @d0c must actually be reached.
//   node test/harness/clock.cjs CLOADM_DIR BUILD_DIR [--verbose]
const assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);
const VERBOSE = process.argv.includes('--verbose');
const FIELD_HZ = 50, QUIET = 500;

(async () => {
  const files = boot.layout(dir), sym = boot.symbols(files.map);
  for (const k of ['clockOn', 'clockTicks', 'clockSeconds', 'readTrackPart', 'seekTrack', 'currentArea', 'diskError', 'px', 'py']) assert.ok(sym[k] !== undefined, `no symbol _${k} in ${files.map}`);
  const s = await boot(repo, files);
  const m = s.machine, r = (a) => s.readByte(a), w = (a) => r(a) * 256 + r(a + 1), pia = m.pia0;
  // seekTrack is the function after readTrackPart in floppy.h, so it bounds it in the image
  const inTransfer = (pc) => pc >= sym.readTrackPart && pc < sym.seekTrack;
  assert.ok(sym.seekTrack > sym.readTrackPart, 'seekTrack no longer follows readTrackPart');

  // FS falling edges, as the VDG timing drives them; how many fell inside a masked transfer; how many found the
  // flag already set (merged: a lost field, unless the set was injected); and every false->true of the flag
  let falls = 0, maskedInTransfer = 0, merged = 0, events = 0, injected = 0;
  const setC1 = pia.setC1.bind(pia);
  pia.setC1 = (side, level) => {
    const fall = side === 'b' && !level && pia.b.c1, wasSet = pia.b.irq1;
    if (fall) { falls++; if (wasSet) merged++; if ((m.cpu.cc & 0x10) && inTransfer(m.cpu.pc)) maskedInTransfer++; }
    setC1(side, level);
    if (side === 'b' && !wasSet && pia.b.irq1) events++;
  };
  // status-read spacing inside readTrackPart, timed by the emulator's own access clock
  let lastStatus = -1, maxGap = 0, gapAt = 0;
  const read = m.read.bind(m), write = m.write.bind(m);
  m.read = (a) => {
    if ((a === 0xff40 || a === 0xff43) && inTransfer(m.cpu.pc)) {
      const t = m.ioTime();
      if (a === 0xff43) lastStatus = -1;
      else { if (lastStatus >= 0 && t - lastStatus > maxGap) { maxGap = t - lastStatus; gapAt = m.cpu.pc; } lastStatus = t; }
    }
    return read(a);
  };
  m.write = (a, v) => { if (a === 0xff40) lastStatus = -1; return write(a, v); };
  const clock = () => w(sym.clockSeconds) * FIELD_HZ + r(sym.clockTicks);
  const settle = () => { for (let k = 0; (m.cpu.cc & 0x10) || pia.b.irq1; k++) { if (k > 500) throw Error('IRQ never unmasked with the flag clear; PC ' + m.cpu.pc.toString(16)); s.runFrames(1); } };
  const next = () => { const v = r(0x200); let n = 0; while (r(0x200) === v) { m.setKey('ENTER', r(0x200) === 0 && n % 50 < 25); s.runFrames(1); if (++n > 3000) throw Error('no picture; PC ' + m.cpu.pc.toString(16)); } m.setKey('ENTER', false); return n; };

  next(); next();
  assert.equal(r(sym.clockOn), 1, 'the clock is not running once the level is in play');
  // the engine is unpacked now: find the flag poll (LDA <$03; BMI) and @d0c (LDA <$43; STA ,X+; LEAY 1,Y) in it
  const find = (bytes) => { for (let a = sym.readTrackPart; a < sym.seekTrack; a++) if (bytes.every((b, i) => r(a + i) === b)) return a; return -1; };
  const pollAt = find([0x96, 0x03, 0x2b]), d0cAt = find([0x96, 0x43, 0xa7, 0x80, 0x31, 0x21]);
  let forcing = false, d0cHits = 0;
  m.pcWatch = (pc) => {
    if (pc === d0cAt) d0cHits++;
    if (forcing && pc === pollAt && !pia.b.irq1) { pia.b.irq1 = true; pia.notifyIrq(); injected++; events++; }
  };
  settle();
  const c0 = clock(), f0 = falls, m0 = merged;   // (the loader leaves the flag latched while it unpacks: not ours)

  for (let k = 0; k < QUIET; k++) s.runFrames(1);
  settle();
  const quiet = { fields: falls - f0, counted: clock() - c0 };

  // every region of the level, as regions.cjs finds them
  const PACK = boot.PACK, size = w(PACK + 4), zone = PACK + w(PACK + 16), first = new Map();
  for (let i = 0; i < size; i++) { const c = r(boot.GRID + i); if (!(c & 15) || (c & 16)) continue; const z = r(zone + ((i >> 9) << 5) + ((i & 127) >> 2)); if (z && !first.has(z)) first.set(z, i); }
  let loads = 0;
  for (const [z, cell] of [...first.entries()].sort((a, b) => a[0] - b[0])) {
    s.pokeBytes(sym.px, [cell & 127, 128]); s.pokeBytes(sym.py, [cell >> 7, 128]);
    next(); next();
    if (r(sym.currentArea) === z) loads++;
  }
  settle();
  const fields = falls - f0, counted = clock() - c0, maskedUnforced = maskedInTransfer;
  if (VERBOSE) console.log(JSON.stringify({ quiet, regions: first.size, loads, fields, counted, maskedInTransfer, merged: merged - m0, maxGap, seconds: w(sym.clockSeconds) }));
  assert.equal(quiet.counted, quiet.fields, `quiet play: the clock counted ${quiet.counted} of ${quiet.fields} fields`);
  assert.ok(loads >= 2 && loads === first.size, `only ${loads} of ${first.size} regions loaded`);
  assert.ok(maskedInTransfer > 0, 'no field fell inside a masked sector transfer: the run did not exercise the polled path');
  assert.equal(counted, fields, `the clock counted ${counted} of ${fields} fields over ${loads} region loads (${maskedInTransfer} fields fell inside masked transfers)`);
  assert.equal(merged - m0, 0, `${merged - m0} field edges found the flag still set: fields lost to the one-deep flag`);
  assert.ok(maxGap > 0 && maxGap <= 17, `readTrackPart's status reads were ${maxGap} cycles apart (at $${gapAt.toString(16)}): more than 17 can cost a byte`);

  // stray IRQs. HS: PIA0's CA1 interrupt on (CRA bit 0) for 50 fields, then off again. The interrupt comes every
  // 57 cycles and the acknowledged handler takes most of them, so the engine draws only a couple of pictures in
  // the window (measured 2); unacknowledged, it draws none.
  const pictures = (p0) => (r(0x200) - p0 + 256) & 255;
  settle();
  const c1 = clock(), e1 = events, p1 = r(0x200);
  pia.write(1, pia.a.cr | 1);
  for (let k = 0; k < 50; k++) s.runFrames(1);
  const hsPictures = pictures(p1);
  pia.write(1, pia.a.cr & ~1);
  settle();
  const stray = { events: events - e1, counted: clock() - c1, pictures: hsPictures };
  // ACIA: the 6551's receive interrupt raised in CLOADM's model each field for 20 fields; a STATUS read clears it,
  // as on the chip
  assert.ok(m.acia && m.acia.chip, 'this machine has no 6551 (the Dragon 64 has one)');
  const c3 = clock(), e3 = events, p3 = r(0x200);
  for (let k = 0; k < 20; k++) { m.acia.chip.irqState |= 4; m.acia.chip.updateIrq(); s.runFrames(1); }
  const aciaPictures = pictures(p3), aciaLeft = m.acia.chip.irqState;
  settle();
  const acia = { events: events - e3, counted: clock() - c3, pictures: aciaPictures, left: aciaLeft };
  if (VERBOSE) console.log(JSON.stringify({ stray, acia }));
  assert.ok(stray.events >= 50, 'the HS window saw too few fields');
  assert.equal(stray.counted, stray.events, `with HS IRQ on, the clock counted ${stray.counted} for ${stray.events} fields: a non-FS interrupt was counted as a field`);
  assert.ok(stray.pictures >= 1, `no picture drawn in the 50 fields with HS IRQ on: the handler does not acknowledge PIA0's HS interrupt, so it runs back to back`);
  assert.equal(acia.counted, acia.events, `with the ACIA's IRQ raised, the clock counted ${acia.counted} for ${acia.events} fields: a non-FS interrupt was counted as a field`);
  assert.ok(acia.pictures >= 1 && acia.left === 0, `with the ACIA's IRQ raised, ${acia.pictures} pictures in the 20 fields and its interrupt still pending: the handler does not acknowledge the 6551`);

  // forced phase: a flag injected at every poll, over a run of region loads
  assert.ok(pollAt >= 0, 'no field-flag poll (LDA <$03; BMI) in readTrackPart to force');
  settle();
  const c2 = clock(), e2 = events, h2 = d0cHits, regions = [...first.entries()].sort((a, b) => a[0] - b[0]).slice(0, 24);
  let forcedLoads = 0;
  forcing = true;
  for (const [z, cell] of regions) {
    s.pokeBytes(sym.px, [cell & 127, 128]); s.pokeBytes(sym.py, [cell >> 7, 128]);
    next(); next();
    if (r(sym.currentArea) === z && r(sym.diskError) === 0) forcedLoads++;
  }
  forcing = false;
  settle();
  const forced = { loads: forcedLoads, of: regions.length, injected, events: events - e2, counted: clock() - c2, d0c: d0cHits - h2, maxGap };
  if (VERBOSE) console.log(JSON.stringify({ forced }));
  assert.equal(forcedLoads, regions.length, `with the flag forced at every poll, only ${forcedLoads} of ${regions.length} region loads read cleanly`);
  assert.ok(forced.d0c > 0, 'the forced run never reached @d0c (a byte due just after the flag is cleared)');
  assert.equal(forced.counted, forced.events, `forced phase: the clock counted ${forced.counted} of ${forced.events} flag events (${injected} injected, @d0c reached ${forced.d0c} times)`);
  assert.ok(maxGap <= 17, `under the forced phase readTrackPart's status reads were ${maxGap} cycles apart (at $${gapAt.toString(16)}): more than 17 can cost a byte`);
  console.log(`clock exact: ${counted} of ${fields} fields, ${loads} region loads, ${maskedUnforced} inside masked transfers; status reads at most ${maxGap} cycles apart; HS IRQ on: ${stray.counted} of ${stray.events}, ${stray.pictures} pictures; ACIA IRQ raised: ${acia.counted} of ${acia.events}, ${acia.pictures} pictures; forced phase ${forced.counted} of ${forced.events} over ${forcedLoads} loads, @d0c ${forced.d0c} times`);
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
