// Measure CPU cycles retired per drawn picture, deterministically.
//
// The engine bumps $0200 once per drawn picture (src/native.c draw()). The machine's own `cycle` counter is the
// sum of every instruction's cycles (js/machines/machine.js runCycles: `this.cycle += cpu.step()`), so the
// difference across a whole number of pictures is exactly the work the engine did for them. Emulation is
// deterministic -- the same build gives the same number on every run -- so this is a measurement, not a timing.
//
// A picture costs ~4.5 PAL fields, so the first picture after the intro can be hundreds of frames away; the run
// waits for the game to start, then measures from one picture boundary to the next N boundaries.
//
//   node tools/cycles-per-picture.mjs CLOADM_DIR BUILD_DIR [pictures]
//
// BUILD_DIR must hold wyrmfire.bin, engine.map, wyrmfire.vdk (test/harness/boot.cjs layout).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const boot = require('../test/harness/boot.cjs');

const [repo, dir, nArg] = process.argv.slice(2);
const PICTURES = Number(nArg || 50);

const s = await boot(repo, boot.layout(dir));
const m = s.machine;
const r = (a) => s.readByte(a);

// wait for the game to start: $0200 changes for the first time (the intro tune runs before it)
const waitPicture = () => {
  const v = r(0x200);
  for (let n = 0; n < 4000; n++) {
    m.setKey('ENTER', r(0x200) === 0 && n % 25 < 12);
    s.runFrames(1);
    if (r(0x200) !== v) { m.setKey('ENTER', false); return; }
  }
  throw new Error('no picture within 4000 frames; PC ' + m.cpu.pc.toString(16));
};
waitPicture();
waitPicture();
waitPicture();

// measure: from this picture boundary to the (PICTURES+1)th one after it
const startCycle = m.cycle;
let last = r(0x200), pictures = 0;
while (pictures < PICTURES) {
  s.runFrames(1);
  const v = r(0x200);
  if (v !== last) { pictures++; last = v; }
}
const cycles = m.cycle - startCycle;

console.log(JSON.stringify({
  pictures,
  cycles,
  cyclesPerPicture: +(cycles / pictures).toFixed(2),
  fieldCycles: Math.round(m.tickHz / 50),
}, null, 0));
