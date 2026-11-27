// Sound effects: the samples sent to the DAC and how long each effect lasts, in PAL fields.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   node test/harness/sound.cjs CLOADM_DIR RUN_DIR [--report]
//
// Each of the five effects is started the way the game starts it (a pistol shot, a shotgun blast, a pickup under
// the player, a guard's hit, a door), at the spawn with the level's own things in view (the door: at the first door). Every byte audioSlice()
// writes to the DAC ($FF20) is recorded with its cycle. Two things are required:
//   * the bytes are the effect's asset, in order, each once, then the $80 that ends it;
//   * the effect lasts length / RATE fields, RATE = 28.75 samples a field, whatever the picture rate. That is the
//     rate the effects had when a picture of this view cost 79,082 cycles (128 samples a picture, 4.45 fields:
//     main at 2f47134). An engine that paces the samples by the pictures it draws plays them faster as it draws
//     faster: this build draws the view in about 2 fields, and per-picture pacing would end a 1,000-sample effect in
//     16 fields instead of 35.
// --report prints the table and asserts nothing (to measure another build).
const fs = require('fs'), assert = require('assert/strict');
const [repo, dir] = process.argv.slice(2), REPORT = process.argv.includes('--report');
const boot = require('./boot.cjs'), files = boot.layout(dir), sym = boot.symbols(files.map);
const RATE = 28.75, ASSETS = 0x5000;
const EFFECTS = { fire: 14, blast: 15, door: 16, hurt: 17, pickup: 18 };
(async () => {
  const rows = {};
  for (const [name, index] of Object.entries(EFFECTS)) {
    const s = await boot(repo, files), m = s.machine, cpu = m.cpu;
    const read = (a) => s.readByte(a), put = (k, ...v) => s.pokeBytes(sym[k], v);
    const picture = () => { const n = read(0x200); let g = 0; while (read(0x200) === n) { m.runCycles(m.cycle + 0x7FFFFFFF, 1); if (++g > 60e6) throw Error('no picture; PC ' + cpu.pc.toString(16)); } };
    for (let i = 0; i < 4; i++) picture();
    // the DAC writes made from inside audioSlice (its code runs from its symbol to the next one in the map)
    const all = Object.values(sym).filter((a) => a > sym.audioSlice).sort((a, b) => a - b), end = all[0];
    const dac = []; let pcNow = 0;
    const w = cpu.write8.bind(cpu);
    cpu.write8 = (a, v) => { if ((a & 0xffff) === 0xff20 && pcNow >= sym.audioSlice && pcNow < end) dac.push([m.cycle, v & 0xff]); w(a, v); };
    const step = m.runCycles.bind(m);
    m.pcWatch = (pc) => { pcNow = pc; };
    // the level's own things stay where they are (ten of them near the spawn): one more is added for the pickup and the hit
    const sx = read(boot.PACK + 7), sy = read(boot.PACK + 8), n = read(sym.count), extra = (...v) => { s.pokeBytes(sym.things + 4 * n, v); s.pokeBytes(sym.waitForAttack + n, [0]); s.pokeBytes(sym.wind + n, [0]); put('count', n + 1); };
    picture(); picture();
    if (name === 'fire') { put('gun', 0); put('ammo', 50); m.setKey('SPACE', true); picture(); m.setKey('SPACE', false); }
    if (name === 'blast') { put('gun', 1); put('ownedShotgun', 1); put('shells', 8); m.setKey('SPACE', true); picture(); m.setKey('SPACE', false); }
    if (name === 'pickup') { extra(sx, sy, 6, 4); picture(); }
    if (name === 'hurt') { extra(sx + 1, sy, 1, 4); for (let i = 0; i < 12 && read(sym.health) === 100; i++) picture(); put('count', n); put('health', 100); }
    if (name === 'door') {
      const rows = Math.floor((read(boot.PACK + 4) * 256 + read(boot.PACK + 5)) / 128), G = (x, y) => read(boot.GRID + 128 * y + x);
      let found = false;
      for (let y = 2; y < rows - 2 && !found; y++) for (let x = 2; x < 126 && !found; x++) {
        if (!(G(x, y) & 16) || (G(x, y) >> 6)) continue;
        for (const [dx, dy, angle, bit] of [[-1, 0, 0, 1], [1, 0, 16, 2], [0, -1, 8, 4], [0, 1, 24, 8]]) {
          const c = G(x + dx, y + dy); if (!(c & 15) || (c & 0x30) || !(c & bit)) continue;
          put('px', x + dx, 128); put('py', y + dy, 128); put('angle', angle); picture(); picture(); picture();
          m.setKey('E', true); picture(); m.setKey('E', false); found = true; break;
        }
      }
      assert.ok(found, 'no door in this map');
    }
    const word = (a) => read(a) * 256 + read(a + 1), at = ASSETS + word(ASSETS + 8 + index * 4), len = word(ASSETS + 10 + index * 4);
    for (let i = 0; i < 400 && (word(sym.audioPos) || !dac.length); i++) picture();
    m.pcWatch = null;
    assert.ok(dac.length, `${name}: no sample reached the DAC`);
    const want = Array.from({ length: len }, (_, i) => read(at + i)), got = dac.map((d) => d[1]);
    const fields = (dac[dac.length - 1][0] - dac[0][0]) / Math.round(m.tickHz / 50);
    rows[name] = { samples: got.length - 1, length: len, fields: +fields.toFixed(1), expected: +(len / RATE).toFixed(1), samplesAField: +((got.length - 1) / fields).toFixed(2), same: got.length === len + 1 && got[len] === 128 && want.every((v, i) => v === got[i]) };
  }
  console.log(JSON.stringify(rows, null, 1));
  if (REPORT) return;
  for (const [name, r] of Object.entries(rows)) {
    assert.ok(r.same, `${name}: the DAC did not get the asset's ${r.length} samples in order and then $80 (${r.samples} samples sent)`);
    // door: the view at the door is not the spawn view, and the door moves; allow it the same tolerance
    assert.ok(Math.abs(r.fields - r.expected) <= Math.max(2, r.expected * 0.06), `${name}: ${r.length} samples took ${r.fields} fields, want ${r.expected} (${RATE} a field): the effect is paced by the pictures drawn, not by the field clock`);
  }
  console.log('Sound PASS');
})().catch((e) => { console.error(e); process.exitCode = 1; });
