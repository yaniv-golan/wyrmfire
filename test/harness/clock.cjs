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
// field is pending in the flag or in readTrackPart's Y.
//   node test/harness/clock.cjs CLOADM_DIR BUILD_DIR [--verbose]
const assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);
const VERBOSE = process.argv.includes('--verbose');
const FIELD_HZ = 50, QUIET = 500;

(async () => {
  const files = boot.layout(dir), sym = boot.symbols(files.map);
  for (const k of ['clockOn', 'clockTicks', 'clockSeconds', 'readTrackPart', 'seekTrack', 'currentArea', 'px', 'py']) assert.ok(sym[k] !== undefined, `no symbol _${k} in ${files.map}`);
  const s = await boot(repo, files);
  const m = s.machine, r = (a) => s.readByte(a), w = (a) => r(a) * 256 + r(a + 1), pia = m.pia0;
  // seekTrack is the function after readTrackPart in floppy.h, so it bounds it in the image
  const inTransfer = (pc) => pc >= sym.readTrackPart && pc < sym.seekTrack;
  assert.ok(sym.seekTrack > sym.readTrackPart, 'seekTrack no longer follows readTrackPart');

  // FS falling edges, as the VDG timing drives them, and how many of them fell inside a masked transfer
  let falls = 0, maskedInTransfer = 0;
  const setC1 = pia.setC1.bind(pia);
  pia.setC1 = (side, level) => {
    if (side === 'b' && !level && pia.b.c1) { falls++; if ((m.cpu.cc & 0x10) && inTransfer(m.cpu.pc)) maskedInTransfer++; }
    setC1(side, level);
  };
  const clock = () => w(sym.clockSeconds) * FIELD_HZ + r(sym.clockTicks);
  const settle = () => { for (let k = 0; (m.cpu.cc & 0x10) || pia.b.irq1; k++) { if (k > 500) throw Error('IRQ never unmasked with the flag clear; PC ' + m.cpu.pc.toString(16)); s.runFrames(1); } };
  const next = () => { const v = r(0x200); let n = 0; while (r(0x200) === v) { m.setKey('ENTER', r(0x200) === 0 && n % 50 < 25); s.runFrames(1); if (++n > 3000) throw Error('no picture; PC ' + m.cpu.pc.toString(16)); } m.setKey('ENTER', false); return n; };

  next(); next();
  assert.equal(r(sym.clockOn), 1, 'the clock is not running once the level is in play');
  settle();
  const c0 = clock(), f0 = falls;

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
  const fields = falls - f0, counted = clock() - c0;
  if (VERBOSE) console.log(JSON.stringify({ quiet, regions: first.size, loads, fields, counted, maskedInTransfer, seconds: w(sym.clockSeconds) }));
  assert.equal(quiet.counted, quiet.fields, `quiet play: the clock counted ${quiet.counted} of ${quiet.fields} fields`);
  assert.ok(loads >= 2 && loads === first.size, `only ${loads} of ${first.size} regions loaded`);
  assert.ok(maskedInTransfer > 0, 'no field fell inside a masked sector transfer: the run did not exercise the polled path');
  assert.equal(counted, fields, `the clock counted ${counted} of ${fields} fields over ${loads} region loads (${maskedInTransfer} fields fell inside masked transfers)`);
  console.log(`clock exact: ${counted} of ${fields} fields, ${loads} region loads, ${maskedInTransfer} fields inside masked transfers`);
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
