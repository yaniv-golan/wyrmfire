// Measure CPU cycles retired per drawn picture, deterministically and to the instruction.
//
// The engine bumps $0200 once per drawn picture (src/native.c draw()). The machine's `cycle` counter is the sum of
// every instruction's cycles (js/machines/machine.js runCycles: `this.cycle += cpu.step()`), so the difference
// between two picture boundaries is exactly the work the engine did for the pictures between them.
//
// THE BOUNDARY MUST BE EXACT. Sampling only after a whole frame quantises the window to frameCycles (17,784 on
// this machine), which is 11 cycles MORE than a PAL field -- so a frame-quantised window produces deltas that look
// like whole fields but are whole FRAMES. This script instead steps ONE INSTRUCTION at a time (runCycles(end, 1),
// which keeps the device/event processing) and stops on the instruction at which $0200 changed, so each boundary
// is the exact cycle of that store.
//
//   node tools/cycles-per-picture.mjs CLOADM_DIR BUILD_DIR [pictures] [--after N]
//
//   pictures   how many picture boundaries to measure across (default 1000)
//   --after N  skip N picture boundaries before the window starts (default 3), so the same build can be measured
//              from two different start points; a measure that is real gives the same answer from either.
//
// BUILD_DIR must hold wyrmfire.bin, engine.map, wyrmfire.vdk (test/harness/boot.cjs layout).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const boot = require('../test/harness/boot.cjs');

const args = process.argv.slice(2);
const [repo, dir] = args;
const afterIdx = args.indexOf('--after');
const AFTER = afterIdx >= 0 ? Number(args[afterIdx + 1]) : 3;
const PICTURES = Number(args.filter((a, i) => /^\d+$/.test(a) && i > 1 && a !== args[afterIdx + 1])[0] || 1000);

const s = await boot(repo, boot.layout(dir));
const m = s.machine;
const r = (a) => s.readByte(a);

// Step exactly one instruction, with the machine's own event processing, so `cycle` stays authoritative.
const stepOnce = () => m.runCycles(m.cycle + 0x7FFFFFFF, 1);

// Run until $0200 changes, stopping ON the instruction that changed it; returns the cycle at that boundary.
const nextBoundary = () => {
  const before = r(0x200);
  let guard = 0;
  while (r(0x200) === before) {
    stepOnce();
    if (++guard > 4000000) throw new Error('no picture in 4000000 instructions; PC ' + m.cpu.pc.toString(16));
  }
  return m.cycle;
};

// skip the intro: the first pictures come after the tune, which blocks for hundreds of frames
for (let i = 0; i < AFTER + 1; i++) {
  if (i > 0) m.setKey('ENTER', false);
  nextBoundary();
}

const startCycle = nextBoundary();
let pictures = 0;
while (pictures < PICTURES) { nextBoundary(); pictures++; }
const cycles = m.cycle - startCycle;

console.log(JSON.stringify({
  after: AFTER,
  pictures,
  cycles,
  cyclesPerPicture: +(cycles / pictures).toFixed(2),
  frameCycles: m.frameCycles,
  fieldCycles: Math.round(m.tickHz / 50),
}, null, 0));
