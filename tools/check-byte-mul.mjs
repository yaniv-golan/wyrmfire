// Guard against CMOC's 8-bit products. CMOC 0.1.101 compiles `a * b` with BOTH operands 8 bits wide (byte or
// signed char) as one 6809 MUL and keeps only B: the product is truncated to 8 bits, and MUL is unsigned, so a
// negative operand is wrong even when the product is small. Standard C would promote both to int. CMOC marks each
// such MUL in its assembly output with "result of type byte in B"; this lists them, finds the source line of
// each from the "* Line file:N" comments, and fails on any that is not in ALLOWED (products known to fit).
// The workaround is to make one operand an int: (int)a*b.
//
//   node tools/check-byte-mul.mjs build/native.s
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// [source file, text of the source line]: each one checked to fit in a byte.
const ALLOWED = [
  ['scene.h', 'start=angle*3'],   // angle is 0..31: at most 93
];

const asm = readFileSync(process.argv[2], 'utf8').split('\n');
let line = null, bad = 0, ok = 0;
const sources = new Map();
const text = (file, n) => {
  if (!sources.has(file)) sources.set(file, readFileSync(file, 'utf8').split('\n'));
  return sources.get(file)[n - 1] || '';
};
for (const l of asm) {
  const m = /^\* Line (.+):(\d+):/.exec(l);
  if (m) { line = [m[1], +m[2]]; continue; }
  if (!/^\s+MUL\s.*result of type byte/.test(l)) continue;
  const [file, n] = line || ['?', 0], src = line ? text(file, n) : '';
  const where = `${basename(file)}:${n}`;
  if (ALLOWED.some(([f, t]) => f === basename(file) && src.includes(t))) { ok++; console.log(`allowed  ${where}: ${src.trim()}`); continue; }
  bad++;
  console.log(`8-BIT PRODUCT ${where}: ${src.trim()}`);
}
if (bad) {
  console.log(`${bad} product(s) of two 8-bit operands, which CMOC truncates to 8 bits (unsigned). Cast one operand to int,`);
  console.log('(int)a*b, or, if the product is known to fit in a byte, add it to ALLOWED in tools/check-byte-mul.mjs.');
  process.exit(1);
}
console.log(`no unchecked 8-bit products (${ok} allowed)`);
