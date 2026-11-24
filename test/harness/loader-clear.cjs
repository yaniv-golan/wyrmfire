// The loader clears the screen before it unpacks. The engine's first draw only repaints what it knows about, so a
// previous program's leftover page showed through for the first fields after the unpack.
//
// The only honest observation point is the loader's own `jmp image_start`: after that the engine repaints, and any
// later sample is blind to the clear. So this fills $0400-$07FF with a known pattern, runs the loader one
// instruction at a time, and samples BOTH pages exactly at that jump -- read from the build's listing, never
// hard-coded, so a loader that grows cannot move the instruction out from under the test.
//   node test/harness/loader-clear.cjs CLOADM_DIR BUILD_DIR
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);
// A pattern with NO zero byte: a junk value of 0 is indistinguishable from a cleared cell, and the first pattern I
// used produced 0x00 at two indices, which made "junk survived" unfalsifiable there.
const JUNK = (i) => ((i * 37 + 11) & 0x7F) | 1;
const launchAddress = (buildDir) => {
  const lst = path.join(buildDir, 'loader.lst');
  assert.ok(fs.existsSync(lst), `no loader.lst in ${buildDir}: build with tools/build-engine.sh`);
  const m = /^\s*([0-9A-F]{4})\s+[0-9A-F]+\s+\([^)]*loader\.asm\):\d+\s+launch\s+jmp\s+image_start/m.exec(fs.readFileSync(lst, 'utf8'));
  assert.ok(m, `no "launch jmp image_start" in ${lst}`);
  return parseInt(m[1], 16);
};
(async () => {
  const files = boot.layout(dir);
  const { formats } = await import(path.resolve(repo, 'js/media/formats.js'));
  const s = await boot(repo, files);
  const Emu = s.Emu, LAUNCH = launchAddress(dir);
  const t = new Emu.Session({ welcomeMenu: false });
  t.switchMachine('dragon64', { ram: 64 }, { menu: false });
  const fdc = new Emu.devices.dragonfdc(); t.machine.insertCartridge(fdc);
  fdc.mount(0, { bytes: new Uint8Array(fs.readFileSync(files.vdk)), format: 'vdk', name: 'WYRMFIRE.VDK', writeProtected: true });
  t.inject(formats.identify('WYRMFIRE.BIN', new Uint8Array(fs.readFileSync(files.bin))).segments, null);
  // Only $0400-$07FF: 2048 bytes from $0600 would reach $0DFF and overwrite the loader itself at $0C00.
  t.pokeBytes(0x0400, Array.from({ length: 512 }, (_, i) => JUNK(i)));
  t.pokeBytes(0x0600, Array.from({ length: 512 }, (_, i) => JUNK(i)));
  // pcHooks do not fire here (they need stubActive(), false once the SAM maps ROM in), so step and watch the PC.
  let hits = 0, at = null;
  t.machine.cpu.jump(0x0C00);
  for (let i = 0; i < 400000; i++) {
    if (t.machine.cpu.pc === LAUNCH) {
      hits++;
      at = { cycle: t.machine.cycle,
        low: Array.from({ length: 512 }, (_, j) => t.readByte(0x0400 + j)),
        high: Array.from({ length: 512 }, (_, j) => t.readByte(0x0600 + j)) };
      break;
    }
    t.machine.cpu.step();
  }
  // exactly once, or the sample below means nothing (a hook that never fires would make a vacuous green)
  assert.equal(hits, 1, `the launch address $${LAUNCH.toString(16)} was reached ${hits} times`);
  const junkLow = at.low.filter((v, i) => v === JUNK(i)).length;
  const junkHigh = at.high.filter((v, i) => v === JUNK(i)).length;
  console.log(JSON.stringify({ launch: '$' + LAUNCH.toString(16), cycle: at.cycle, junkLow, junkHigh }));
  assert.equal(junkLow, 0, `${junkLow} junk cells survived into $0400-$05FF`);
  // the clear must stop at $05FF: the next page still holds every junk byte
  assert.equal(junkHigh, 512, `the clear touched $0600: only ${junkHigh} of 512 junk bytes remain`);
  console.log('all loader-clear checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
