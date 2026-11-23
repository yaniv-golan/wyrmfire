#!/usr/bin/env node
// Check a release directory before anything is attached.
// SPDX-License-Identifier: GPL-3.0-or-later
//   node tools/check-dist.mjs dist
// Fails unless DIR holds exactly the release files, every checksum matches
// SHA256SUMS, wyrmfire.bin.sha256 and manifest.json, the engine equals the
// committed bin/wyrmfire.bin, and no file carries WAD data.
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '../converter/wyrmfire-convert.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: check-dist.mjs DIR'); process.exit(2); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXPECTED = ['LICENSE', 'SHA256SUMS', 'manifest.json', 'worker.js', 'wyrmfire-convert.js', 'wyrmfire.bin', 'wyrmfire.bin.sha256', 'wyrmfire.sym'];
const fail = (m) => { console.error('check-dist: ' + m); process.exit(1); };
const names = fs.readdirSync(dir).sort();
if (names.join() !== EXPECTED.join()) fail(`files are [${names}], expected [${EXPECTED}]`);
const read = (n) => fs.readFileSync(path.join(dir, n));
const sha = (n) => sha256Hex(new Uint8Array(read(n)));

for (const n of names) {
  const b = read(n), raw = b.toString('latin1');
  const head = raw.slice(0, 4);
  if (head === 'IWAD' || head === 'PWAD' || /PLAYPAL\0/.test(raw) || /(E\dM\d|MAP\d\d)\0{3,4}[\s\S]{8}THINGS\0\0/.test(raw)) fail(`${n} carries WAD data`);
}
const sums = Object.fromEntries(read('SHA256SUMS').toString().trim().split('\n').map((l) => l.split(/\s+\*?/).reverse()));
const listed = Object.keys(sums).sort();
const want = EXPECTED.filter((n) => !['SHA256SUMS', 'wyrmfire.bin.sha256'].includes(n));
if (listed.join() !== want.join()) fail(`SHA256SUMS lists [${listed}], expected [${want}]`);
for (const [n, h] of Object.entries(sums)) if (sha(n) !== h) fail(`${n}: SHA-256 mismatch`);
const single = read('wyrmfire.bin.sha256').toString();
if (single !== `${sha('wyrmfire.bin')}  wyrmfire.bin\n`) fail('wyrmfire.bin.sha256 does not match');
const manifest = JSON.parse(read('manifest.json'));
for (const [n, f] of Object.entries(manifest.files)) {
  if (sha(n) !== f.sha256 || read(n).length !== f.size) fail(`manifest entry ${n} does not match`);
}
if (sha('wyrmfire.bin') !== sha256Hex(new Uint8Array(fs.readFileSync(path.join(root, 'bin/wyrmfire.bin'))))) fail('engine differs from bin/wyrmfire.bin');
console.log(`check-dist: ok, ${names.length} files, engine ${sha('wyrmfire.bin')} (${read('wyrmfire.bin').length} bytes), version ${manifest.version}`);
