// Monster and pickup sprites against the walls (Freedoom E1M1 fixture): feet on the floor line, size with depth,
// partial visibility at the screen edge and behind a pillar, never over a nearer wall.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   node test/harness/sprites.cjs CLOADM_DIR RUN_DIR      (RUN_DIR holds wyrmfire.vdk, as for the other harnesses)
//
// Each case pokes the player and one thing into RAM, lets the engine draw both pages, and diffs the picture on the
// screen against the same view with the thing far away. The wall projection is the converter's (buildAtlas
// screen()): floor line = 79 + 640/z for z in map units (8 a cell), eyes 5 above the floor. PNGs of every case go
// to RUN_DIR/sprites/.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const [repo, dir] = process.argv.slice(2);
const boot = require('./boot.cjs'), files = boot.layout(dir), sym = boot.symbols(files.map);
const framePng = (f) => require(path.resolve(repo, 'cli/cloadm.js')).framePng(f);
const out = path.join(dir, 'sprites'); fs.mkdirSync(out, { recursive: true });
const GUARD = 1, AMMO = 6;
(async () => {
  const s = await boot(repo, files);
  const read = (a) => s.readByte(a), put = (k, ...v) => s.pokeBytes(sym[k], v);
  // One picture, stopping ON the instruction that stores $0200 (one instruction at a time, as
  // tools/cycles-per-picture.mjs does). Sampling at the next frame boundary instead reads the engine's variables
  // up to a field into the NEXT picture: actors() starts by projecting the player's own offset, which leaves
  // tdepth at 0 until the thing is projected again, so a frame-quantised sample of tdepth depends on how fast the
  // engine draws (it read 0 for the nearer-wall case once a picture took under two fields).
  const m = s.machine;
  const picture = () => { const n = read(0x200); let g = 0; while (read(0x200) === n) { m.runCycles(m.cycle + 0x7FFFFFFF, 1); if (++g > 60e6) throw Error('no picture; PC ' + m.cpu.pc.toString(16)); } };
  while (read(0x200) < 3) picture();
  const spawn = [read(boot.PACK + 7), read(boot.PACK + 8)];
  // the page on the screen: draw() leaves `back` on the OTHER one
  const shown = () => { const back = read(sym.back) * 256 + read(sym.back + 1), page = back === 0xe000 ? 0x400 : 0xe000;
    return Array.from({ length: 160 * 32 }, (_, i) => read(page + i)); };
  // Player at cell (cx,cy) + fraction (fx,fy)/256, facing `angle`; things [[x,y,kind],...]. Two pictures per page.
  const view = (cx, cy, fx, fy, angle, things) => {
    put('px', cx, fx); put('py', cy, fy); put('angle', angle); put('health', 100); put('won', 0);
    put('count', things.length); put('things', ...things.flatMap(([x, y, k]) => [x, y, k, 4]));
    put('waitForAttack', ...things.map(() => 255)); put('wind', ...things.map(() => 0));
    for (let i = 0; i < 4; i++) picture();
    return shown();
  };
  // Measuring frames: the guard and pickup frames made fully opaque, rows alternating $CC/$33 (halved across, as
  // at one byte wide, $AA/$55), so every row of the sprite differs from every wall fill ($00, $11, $80, $99, $FF)
  // and from the black floor. `real` puts the
  // art back for the screenshots. The scaled-frame cache is emptied either way.
  const ASSETS = 0x5000, guardAt = ASSETS + read(ASSETS + 8) * 256 + read(ASSETS + 9);
  const art = { guard: Array.from({ length: 96 }, (_, i) => read(guardAt + i)), pickup: Array.from({ length: 96 }, (_, i) => read(sym.pickupFrame + i)) };
  const checker = Array.from({ length: 96 }, (_, i) => (i & 1 ? ((i >> 2) & 1 ? 0x33 : 0xcc) : 0));
  const frames = (solid) => { s.pokeBytes(guardAt, solid ? checker : art.guard); s.pokeBytes(sym.pickupFrame, solid ? checker : art.pickup); s.pokeBytes(sym.scaledTable, [0, 0]); };
  const FAR = [120, 100, GUARD];   // outside findNearby's 18-cell square from anywhere in E1M1
  const diff = (a, b) => { let top = 999, bottom = -1, cols = new Set();
    a.forEach((v, i) => { if (v !== b[i]) { const r = i >> 5; top = Math.min(top, r); bottom = Math.max(bottom, r); cols.add(i & 31); } });
    return { top, bottom, rows: bottom - top + 1, cols: [...cols].sort((x, y) => x - y) }; };
  // the same view with the real art, as a PNG
  const shot = (name, ...args) => { frames(false); view(...args); view(...args); fs.writeFileSync(path.join(out, name + '.png'), framePng(s.machine.render())); frames(true); };
  const results = {};
  const [px, py] = spawn;
  frames(true);

  // Per column: across the frame's span (c0 .. c0+gW-1, from the engine) a column is drawn exactly when it is on
  // the screen and its wall (rayDistance) is not nearer than the thing's depth (1 unit of slack: the view tables
  // round t/2).
  const columns = (d) => { const c0 = (read(sym.c0) << 24) >> 24, w = read(sym.gW), depth = read(sym.tdepth), want = [], hidden = [];
    for (let c = c0; c < c0 + w; c++) if (c >= 0 && c < 32) (read(sym.rayDistance + c) + 1 >= depth ? want : hidden).push(c);
    assert.deepEqual(d.cols, want, `drawn columns ${d.cols}, want ${want} (depth ${depth}, span ${c0}..${c0 + w - 1})`);
    return { depth, span: [c0, c0 + w - 1], drawn: d.cols, hiddenBehindWalls: hidden, walls: Array.from({ length: w }, (_, j) => read(sym.rayDistance + c0 + j)) }; };
  // 1. Feet on the floor line and size shrinking with distance, straight down the corridor (angle 0 = +x).
  let lastRows = 1e9;
  for (const k of [1.5, 2, 3, 4, 6, 8, 12]) {
    const cells = Math.floor(k), fx = k === cells ? 128 : 0;    // 1.5 cells: the player half a cell back
    const base = view(px, py, fx, 128, 0, [FAR]), seen = view(px, py, fx, 128, 0, [[px + cells, py, GUARD]]);
    const d = diff(base, seen), z = 8 * k, floor = 79 + 640 / z;
    results['feet ' + k] = { z, floorLine: +floor.toFixed(1), top: d.top, bottom: d.bottom, rows: d.rows, cols: d.cols, ...columns(d) };
    shot('feet-' + k, px, py, fx, 128, 0, [[px + cells, py, GUARD]]);
    assert.ok(Math.abs(d.bottom - floor) <= 2, `k=${k}: feet at row ${d.bottom}, floor line ${floor.toFixed(1)}`);
    assert.ok(d.rows < lastRows, `k=${k}: ${d.rows} rows, not smaller than the nearer one's ${lastRows}`);
    lastRows = d.rows;
  }
  // 2. Right edge: monster at (10,20) seen at angle 1 lands in column 31, which used to be culled.
  { const base = view(px, py, 128, 128, 1, [FAR]), seen = view(px, py, 128, 128, 1, [[10, 20, GUARD]]);
    const d = diff(base, seen); results['right edge'] = columns(d);
    shot('edge-col31', px, py, 128, 128, 1, [[10, 20, GUARD]]);
    assert.ok(d.cols.includes(31), `monster at the right edge: drawn columns ${d.cols}`); }
  // 3. Half behind a pillar: (14,17) at angle 27; the visible column (6) is drawn, the one behind the pillar not.
  { const base = view(px, py, 128, 128, 27, [FAR]), seen = view(px, py, 128, 128, 27, [[14, 17, GUARD]]);
    const d = diff(base, seen); results['pillar'] = columns(d);
    shot('pillar', px, py, 128, 128, 27, [[14, 17, GUARD]]);
    assert.ok(d.cols.includes(6) && results.pillar.hiddenBehindWalls.length, `pillar: drawn ${d.cols}, column 6 visible and a column hidden`); }
  // 4. Never over a nearer wall: (18,25) at angle 0, depth 48, beside the corridor's far end: the columns where a
  //    wall is nearer are not drawn, the column that sees past it into the room is.
  { const base = view(px, py, 128, 128, 0, [FAR]), seen = view(px, py, 128, 128, 0, [[18, 25, GUARD]]);
    const d = diff(base, seen); results['nearer wall'] = columns(d);
    shot('nearer-wall', px, py, 128, 128, 0, [[18, 25, GUARD]]);
    assert.ok(results['nearer wall'].hiddenBehindWalls.length, 'no column of the span was behind a nearer wall'); }
  // 5. Pickups: feet on the floor line too, scaled.
  for (const k of [2, 4]) {
    const base = view(px, py, 128, 128, 0, [FAR]), seen = view(px, py, 128, 128, 0, [[px + k, py, AMMO]]);
    const d = diff(base, seen), floor = 79 + 640 / (8 * k);
    results['pickup ' + k] = { floorLine: +floor.toFixed(1), top: d.top, bottom: d.bottom, rows: d.rows, cols: d.cols };
    shot('pickup-' + k, px, py, 128, 128, 0, [[px + k, py, AMMO]]);
    assert.ok(Math.abs(d.bottom - floor) <= 2, `pickup k=${k}: bottom ${d.bottom}, floor line ${floor.toFixed(1)}`);
  }
  console.log(JSON.stringify({ spawn, ...results }, null, 1));
  console.log('Sprites PASS');
})().catch((e) => { console.error(e); process.exitCode = 1; });
