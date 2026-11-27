// Cycle profile per function over the same window as tools/cycles-per-picture.mjs (N pictures after --after).
//
// Steps ONE INSTRUCTION at a time and charges each instruction's cycles to the symbol its PC is in (self), and to
// every function on the call stack (inclusive). The call stack is followed from the stack pointer: an instruction
// that starts at a function's first byte is a call, and the function has returned once S is above the S it was
// entered with. Interrupts are charged the same way (fieldIrq shows up as its own entry).
//
//   node tools/profile-cycles.mjs CLOADM_DIR BUILD_DIR [pictures] [--after N]
//
// BUILD_DIR must hold wyrmfire.bin, engine.map, wyrmfire.vdk. Output: cycles per picture, self and inclusive.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const boot = require('../test/harness/boot.cjs');

const args = process.argv.slice(2);
const [repo, dir] = args;
const afterIdx = args.indexOf('--after');
const AFTER = afterIdx >= 0 ? Number(args[afterIdx + 1]) : 3;
const PICTURES = Number(args.filter((a, i) => /^\d+$/.test(a) && i > 1 && a !== args[afterIdx + 1])[0] || 1000);

const files = boot.layout(dir);
const s = await boot(repo, files);
const m = s.machine, cpu = m.cpu;
const r = (a) => s.readByte(a);

// function entry points: the engine's own (_name in native.o) and CMOC's runtime (DIV16, MUL16, ...)
const syms = [];
for (const x of readFileSync(files.map, 'utf8').matchAll(/^Symbol: (\w+) \((\w+)\.\w+\) = ([0-9A-F]+)/gm)) {
  const [, name, obj, hex] = x;
  if (obj === 'native' ? /^_/.test(name) : name === obj) syms.push([parseInt(hex, 16), name.replace(/^_/, '')]);
}
syms.sort((a, b) => a[0] - b[0]);
const end = parseInt(/^Section: rodata \(native\.o\) load at ([0-9A-F]+)/m.exec(readFileSync(files.map, 'utf8'))[1], 16);
const owner = new Int16Array(0x10000).fill(-1), entry = new Int16Array(0x10000).fill(-1);
syms.forEach(([a], i) => { if (a < end) { entry[a] = i; for (let p = a; p < (syms[i + 1] ? Math.min(syms[i + 1][0], end) : end); p++) owner[p] = i; } });
const self = new Float64Array(syms.length + 1), incl = new Float64Array(syms.length + 1), calls = new Float64Array(syms.length + 1);
const OTHER = syms.length;

const stack = [];        // [symbol, S at entry]
const onStack = new Int32Array(syms.length + 1);
let counting = false;
const step = () => {
  const pc = cpu.pc, sp = cpu.s;
  while (stack.length && sp > stack[stack.length - 1][1]) onStack[stack.pop()[0]]--;
  const e = entry[pc];
  if (e >= 0) { stack.push([e, sp]); onStack[e]++; if (counting) calls[e]++; }
  const before = m.cycle;
  m.runCycles(m.cycle + 0x7FFFFFFF, 1);
  if (!counting) return;
  const n = m.cycle - before, o = owner[pc] >= 0 ? owner[pc] : OTHER;
  self[o] += n;
  for (let i = 0; i < stack.length; i++) { const f = stack[i][0]; if (onStack[f] > 0 && stack.findIndex((x) => x[0] === f) === i) incl[f] += n; }
};
const nextBoundary = () => { const before = r(0x200); let guard = 0; while (r(0x200) === before) { step(); if (++guard > 4000000) throw new Error('no picture'); } return m.cycle; };

for (let i = 0; i < AFTER + 1; i++) { if (i > 0) m.setKey('ENTER', false); nextBoundary(); }
const startCycle = nextBoundary();
counting = true;
for (let p = 0; p < PICTURES; p++) nextBoundary();
const total = m.cycle - startCycle;

const per = (v) => (v / PICTURES).toFixed(0).padStart(8);
const pct = (v) => (100 * v / total).toFixed(1).padStart(5) + '%';
console.log(`${PICTURES} pictures after ${AFTER}: ${(total / PICTURES).toFixed(2)} cycles per picture`);
console.log('    self      %     incl      %   calls/pic  function');
const rows = [...syms.map(([, n], i) => [n, self[i], incl[i], calls[i]]), ['(outside the image)', self[OTHER], self[OTHER], 0]];
for (const [n, sf, ic, c] of rows.filter((x) => x[1] || x[2]).sort((a, b) => b[1] - a[1]))
  console.log(`${per(sf)} ${pct(sf)} ${per(ic)} ${pct(ic)} ${(c / PICTURES).toFixed(2).padStart(10)}  ${n}`);
