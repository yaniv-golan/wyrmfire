#!/usr/bin/env node
// README screenshots and gameplay GIF, recorded headless in CLOADM from the
// Freedoom E1M1 level disk only.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   node tools/readme-media.cjs CLOADM_DIR freedoom1.wad [OUT_DIR=docs/media]
//
// Refuses any WAD other than the Freedoom 0.13.0 freedoom1.wad pinned in
// tools/versions.env, and any level disk other than the one pinned in
// release/expected.json. The level disk is written to a temporary directory
// and deleted afterwards. The engine is the committed bin/wyrmfire.bin, on
// CLOADM's built-in firmware (no BASIC or DOS ROM), driven by keyboard input
// from a scripted autopilot. Emulated time is counted in PAL fields, so every
// run with the same CLOADM commit gives byte-identical files.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const boot = require('../test/harness/boot.cjs');

const ROOT = path.resolve(__dirname, '..');
const [cloadm, wadPath, out = path.join(ROOT, 'docs/media')] = process.argv.slice(2);
if (!cloadm || !wadPath) { console.error('usage: readme-media.cjs CLOADM_DIR freedoom1.wad [OUT_DIR]'); process.exit(2); }

// Shots: picture number -> file. GIF: from GIF_FROM picture, GIF_SECONDS of emulated time.
const SHOTS = { 3: 'spawn.png', 90: 'zombies.png', 131: 'hall.png', 141: 'fireball.png' };
const GIF_FROM = 84, GIF_SECONDS = 7.9, SCALE = 2;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pins = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'tools/versions.env'), 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => l.split('=')));
const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'release/expected.json'), 'utf8'));

// Nearest-neighbour upscale of a CLOADM frame to 0xBBGGRR pixels.
function pixels(s) {
  const f = s.machine.render(), src = s.Emu.frameToRGBA(f), w = f.width * SCALE, h = f.height * SCALE, px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = src[((y / SCALE) | 0) * f.width + ((x / SCALE) | 0)] & 0xffffff;
  return { w, h, px };
}

// Minimal GIF89a encoder: one global palette, LZW, looping.
function lzw(indices, minBits) {
  const out = [], clear = 1 << minBits, eoi = clear + 1;
  let bits = minBits + 1, next = eoi + 1, dict = new Map(), acc = 0, n = 0;
  const emit = (code) => { acc |= code << n; n += bits; while (n >= 8) { out.push(acc & 255); acc >>>= 8; n -= 8; } };
  emit(clear);
  let w = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = w * 4096 + k;
    if (dict.has(key)) { w = dict.get(key); continue; }
    emit(w);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << bits) && bits < 12) bits++; }
    else { emit(clear); dict = new Map(); bits = minBits + 1; next = eoi + 1; }
    w = k;
  }
  emit(w); emit(eoi);
  if (n) out.push(acc & 255);
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) blocks.push(out.length - i < 255 ? out.length - i : 255, ...out.slice(i, i + 255));
  return Buffer.from([minBits, ...blocks, 0]);
}
function gif(frames) {
  const { w, h } = frames[0], colours = [];
  for (const f of frames) for (const c of f.px) if (!colours.includes(c)) colours.push(c);
  colours.sort((a, b) => a - b);
  let depth = 1; while ((1 << depth) < colours.length) depth++;
  const index = new Map(colours.map((c, i) => [c, i])), table = Buffer.alloc(3 << depth);
  colours.forEach((c, i) => { table[3 * i] = c & 255; table[3 * i + 1] = (c >> 8) & 255; table[3 * i + 2] = (c >> 16) & 255; });
  const u16 = (v) => [v & 255, v >> 8];
  const parts = [Buffer.from('GIF89a'), Buffer.from([...u16(w), ...u16(h), 0xf0 | (depth - 1), 0, 0]), table,
    Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])];
  for (const f of frames) {
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, ...u16(f.delay), 0, 0, 0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0]));
    parts.push(lzw(Uint8Array.from(f.px, (c) => index.get(c)), Math.max(2, depth)));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

(async () => {
  const wad = fs.readFileSync(wadPath);
  if (sha256(wad) !== pins.FREEDOOM1_WAD_SHA256) throw Error(`${wadPath} is not Freedoom ${pins.FREEDOOM_VERSION} freedoom1.wad (SHA-256 mismatch); only Freedoom is used for media`);
  const { convert } = await import('../converter/wyrmfire-convert.js');
  const { disk } = convert(new Uint8Array(wad), { map: expected.map });
  if (sha256(disk) !== expected.sha256) throw Error('level disk does not match release/expected.json');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wyrmfire-media-'));
  try {
    fs.writeFileSync(path.join(tmp, 'wyrmfire.vdk'), disk);
    const files = { ...boot.layout(tmp), bin: path.join(ROOT, 'bin/wyrmfire.bin'), map: path.join(ROOT, 'bin/wyrmfire.sym') };
    const addr = boot.symbols(files.map), s = await boot(cloadm, files);
    const r = (a) => s.readByte(a), v = (n) => r(addr[n]), r16 = (a) => r(a) * 256 + r(a + 1), g = (i) => r(boot.GRID + i);
    const png = require(path.resolve(cloadm, 'cli/cloadm.js')).framePng;
    fs.mkdirSync(out, { recursive: true });
    const keys = ['LEFT', 'RIGHT', 'SPACE', 'UP', 'E'], fieldCs = 100 / s.machine.fps;
    let picture = 0, lastUse = false, gifStart = -1, frames = [], lastKey = '';
    const gifFields = Math.round(GIF_SECONDS * s.machine.fps);

    for (let field = 0; field < 20000; field++) {
      s.runFrames(1);
      if (gifStart >= 0 && field - gifStart < gifFields) {
        const p = pixels(s), key = sha256(Buffer.from(p.px.buffer));
        const t = Math.round((field - gifStart + 1) * fieldCs);
        if (key === lastKey) frames.at(-1).end = t; else frames.push({ ...p, end: t }), lastKey = key;
      }
      const n = r(0x200);
      if (n === picture) continue;
      picture = n;
      if (SHOTS[n]) fs.writeFileSync(path.join(out, SHOTS[n]), png(s.machine.render(), SCALE));
      if (n === GIF_FROM) gifStart = field;
      if (gifStart >= 0 && field - gifStart >= gifFields && n > Math.max(...Object.keys(SHOTS))) break;

      // Autopilot (as test/harness/route.cjs): walk the map grid to the exit, open doors, fire at a target.
      const px = r16(addr.px), py = r16(addr.py), cell = (py >> 8) * 128 + (px >> 8), ang = v('angle'), k = new Set();
      const q = [cell], from = new Map([[cell, -1]]);
      let dest;
      for (let j = 0; j < q.length && dest == null; j++) {
        const c = g(q[j]);
        if ((c & 32) && !(c & 64)) { dest = q[j]; break; }
        for (const [bit, d] of [[1, 1], [2, -1], [4, 128], [8, -128]]) {
          const z = q[j] + d, t = g(z);
          if (!(c & bit) || from.has(z) || ((t & 16) && (t >> 6) && !(v('keys') & (1 << ((t >> 6) - 1))))) continue;
          from.set(z, q[j]); q.push(z);
        }
      }
      if (dest != null && dest !== cell) {
        let step = dest; while (from.get(step) !== cell) step = from.get(step);
        const d = step - cell, a = d === 1 ? 0 : d === 128 ? 8 : d === -1 ? 16 : 24;
        if (ang !== a) k.add(((a - ang + 32) % 32) < 16 ? 'LEFT' : 'RIGHT');
        else { if ((g(step) & 16) && !lastUse) k.add('E'); k.add('UP'); }
      }
      if (v('target') !== 255) k.add('SPACE');
      lastUse = k.has('E');
      for (const name of keys) s.machine.setKey(name, k.has(name));
    }
    if (!frames.length) throw Error('the GIF window was never reached');

    let prev = 0;
    for (const f of frames) { f.delay = f.end - prev; prev = f.end; }
    fs.writeFileSync(path.join(out, 'gameplay.gif'), gif(frames));
    for (const f of [...Object.values(SHOTS), 'gameplay.gif']) {
      const b = fs.readFileSync(path.join(out, f));
      console.log(`${path.relative(ROOT, path.join(out, f))}  ${b.length} bytes  ${sha256(b)}`);
    }
    console.log(`GIF: ${frames.length} frames, ${(prev / 100).toFixed(2)} s of emulated time from picture ${GIF_FROM}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
