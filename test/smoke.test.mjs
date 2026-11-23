// Smoke test: boot the engine in CLOADM headless with the Freedoom level disk.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   CLOADM=/path/to/CLOADM WYRMFIRE_BUILD=build node --test test/smoke.test.mjs
// WYRMFIRE_BUILD must hold wyrmfire.bin and wyrmfire.vdk. Skips when unset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const boot = require('./harness/boot.cjs');
const repo = process.env.CLOADM, dir = process.env.WYRMFIRE_BUILD;
const FRAME_MARKER = 0x200; // incremented by the engine after every in-game picture

test('engine boots from the level disk and draws an in-game frame', { skip: !(repo && dir) && 'set CLOADM and WYRMFIRE_BUILD' }, async () => {
  const files = boot.layout(dir);
  const s = await boot(repo, files);
  let field = 0;
  while (s.readByte(FRAME_MARKER) === 0) {
    s.machine.setKey('ENTER', field % 50 < 25); // skip the intro cue
    s.runFrames(1);
    if (++field > 3000) throw new Error('no in-game frame within 3000 fields; PC ' + s.machine.cpu.pc.toString(16));
  }
  s.machine.setKey('ENTER', false);
  for (let n = s.readByte(FRAME_MARKER); s.readByte(FRAME_MARKER) < n + 2 && field < 4000; field++) s.runFrames(1);
  const frame = s.machine.render();
  const rgba = s.Emu.frameToRGBA(frame);
  const colours = new Map();
  for (const px of rgba) colours.set(px, (colours.get(px) || 0) + 1);
  const counts = [...colours.values()].sort((a, b) => b - a);
  const minority = rgba.length - counts[0];
  console.log(`first in-game frame after ${field} fields; ${colours.size} colours, ${minority} of ${rgba.length} pixels not background`);
  if (process.env.WYRMFIRE_SHOTS) {
    fs.mkdirSync(process.env.WYRMFIRE_SHOTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.WYRMFIRE_SHOTS, 'smoke.png'), boot.png(repo, s));
  }
  assert.ok(colours.size >= 2, 'screen is a single colour');
  assert.ok(minority > rgba.length / 50, 'screen is nearly blank');
  // The HUD row and the view were drawn: player state is sane.
  assert.equal(s.readByte(0x204), 100, 'health');
});
