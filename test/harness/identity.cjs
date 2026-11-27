// Picture-for-picture identity of two engine builds (Freedoom E1M1 fixture).
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   node test/harness/identity.cjs CLOADM_DIR RUN_DIR OUT.txt      writes one line per picture
//   cmp a.txt b.txt                                                two builds draw the same pictures
//
// The engine's game state depends on the pictures drawn, not on time: keys are read once a pass, monsters and
// doors step once a pass, and the only thing the field clock feeds is the end screen's TIME. So a run whose inputs
// change EXACTLY at picture boundaries (the instruction that stores $0200; the machine is stepped one instruction
// at a time) is the same sequence of pictures on any build that draws the same thing, however fast it draws it.
// Each line is the picture number, a hash of the 6,144 bytes of the page on the screen and a hash of the game
// state. The script walks and turns from the spawn with a seeded key sequence, fires all three weapons, opens
// doors, jumps to cells all over the map (every region streams from the disk), and stands monsters and pickups at
// every scale, at the screen edges, casting, in a crowd and behind walls; then it stands still, toggles the
// hatching, alternates views, opens doors without moving, dies, starts again and clears the level.
const fs = require('fs');
const [repo, dir, outFile] = process.argv.slice(2);
const boot = require('./boot.cjs'), files = boot.layout(dir), sym = boot.symbols(files.map);
(async () => {
  const s = await boot(repo, files), m = s.machine;
  const read = (a) => s.readByte(a), put = (k, ...v) => s.pokeBytes(sym[k], v);
  const picture = () => { const n = read(0x200); let g = 0; while (read(0x200) === n) { m.runCycles(m.cycle + 0x7FFFFFFF, 1); if (++g > 60e6) throw Error('no picture; PC ' + m.cpu.pc.toString(16)); } };
  let seed = 0x1234567;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  const fnv = (h, v) => Math.imul(h ^ v, 16777619) >>> 0;
  const lines = [];
  const STATE = [['px', 2], ['py', 2], ['angle', 1], ['health', 1], ['ammo', 1], ['shells', 1], ['gun', 1], ['keys', 1], ['kills', 1], ['armor', 1],
    ['won', 1], ['count', 1], ['things', 256], ['balls', 36], ['wind', 64], ['waitForAttack', 64], ['phase', 64], ['target', 1], ['movingDoor', 1]];
  const record = (tag) => {
    const back = read(sym.back) * 256 + read(sym.back + 1), page = back === 0xe000 ? 0x400 : 0xe000;
    let h = 2166136261, g = 2166136261;
    for (let i = 0; i < 6144; i++) h = fnv(h, read(page + i));
    for (const [k, n] of STATE) for (let i = 0; i < n; i++) g = fnv(g, read(sym[k] + i));
    lines.push(`${lines.length} ${tag} ${h.toString(16).padStart(8, '0')} ${g.toString(16).padStart(8, '0')}`);
  };
  const KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'Z', 'X', 'SPACE', 'E', '1', '2', '3', 'D'];
  const hold = (set) => { for (const k of KEYS) m.setKey(k, set.includes(k)); };
  const step = (tag, n = 1) => { for (let i = 0; i < n; i++) { picture(); record(tag); } };

  for (let i = 0; i < 4; i++) picture();          // the intro cue, then the first pictures
  record('spawn');

  // 1. Seeded play from the spawn: walk, turn, strafe, fire, use, change weapon, toggle the hatching.
  put('shells', 30); put('ownedShotgun', 1);
  const MOVES = [['UP'], ['UP'], ['UP'], ['UP', 'LEFT'], ['UP', 'RIGHT'], ['LEFT'], ['RIGHT'], ['DOWN'], ['Z'], ['X'], ['UP', 'SPACE'], ['SPACE'],
    ['E'], ['E', 'UP'], [], ['1'], ['2'], ['3'], ['D'], ['LEFT', 'SPACE'], ['RIGHT', 'UP', 'SPACE']];
  for (let i = 0; i < 110; i++) {
    hold(MOVES[rnd(MOVES.length)]);
    const n = 1 + rnd(6);
    for (let j = 0; j < n; j++) { put('health', 100); if (!read(sym.ammo)) put('ammo', 40); step('play'); }
  }
  hold([]);

  // 2. Cells all over the map, at every angle and every fraction of a cell: each region streams from the disk.
  const rows = Math.floor((read(boot.PACK + 4) * 256 + read(boot.PACK + 5)) / 128), cells = [];
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < 127; x++) { const c = read(boot.GRID + 128 * y + x); if ((c & 15) && !(c & 0x30)) cells.push([x, y]); }
  for (let i = 0; i < 90; i++) {
    const [x, y] = cells[rnd(cells.length)];
    put('px', x, rnd(256)); put('py', y, rnd(256)); put('angle', rnd(32)); put('health', 100);
    hold([[], ['LEFT'], ['RIGHT'], ['UP'], ['Z'], ['SPACE']][rnd(6)]);
    step('cell', 4);
  }
  hold([]);

  // 3. Monsters and pickups in the spawn corridor: every scale, both edges, casting, crowds, fireballs.
  const spawn = [read(boot.PACK + 7), read(boot.PACK + 8)];
  const stand = (fx, fy, angle, things, wait, wind, n) => {
    put('px', spawn[0], fx); put('py', spawn[1], fy); put('angle', angle); put('health', 100); put('won', 0); put('gun', rnd(3));
    put('count', things.length); put('things', ...things.flatMap(([x, y, k]) => [x, y, k, 9]));
    put('waitForAttack', ...things.map(() => wait)); put('wind', ...things.map(() => wind));
    step('thing', n);
  };
  const [sx, sy] = spawn;
  for (const kind of [1, 3, 5, 6, 9])
    for (const d of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15])
      for (const fx of [0, 128, 255]) stand(fx, 128, 0, [[sx + d, sy, kind]], 255, 0, 2);
  for (let angle = 0; angle < 32; angle++)
    for (const d of [1, 2, 3, 5]) {
      const a = angle * Math.PI / 16, x = sx + Math.round(d * Math.cos(a)), y = sy + Math.round(d * Math.sin(a));
      stand(rnd(256), rnd(256), (angle + rnd(5) + 30) & 31, [[x, y, 1 + rnd(5)]], 255, 0, 2);
    }
  for (let i = 0; i < 40; i++) {
    const things = []; const n = 2 + rnd(6);
    for (let j = 0; j < n; j++) things.push([sx - 4 + rnd(12), sy - 3 + rnd(7), [1, 2, 3, 3, 5, 6, 7, 8, 12, 13][rnd(10)]]);
    stand(rnd(256), rnd(256), rnd(32), things, i & 1 ? 0 : 255, i % 3 ? 0 : 3, 5);     // some attack, some cast
  }
  hold(['SPACE']);
  for (let i = 0; i < 12; i++) stand(128, 128, (i * 3) & 31, [[sx + 2, sy, 3], [sx + 3, sy + 1, 1], [sx + 3, sy - 1, 2]], 0, 0, 4);
  hold([]);

  // 4. The still view and what must end it. The same view for several pictures, then: the hatching toggled; two
  //    views alternating every picture and every second picture; a door opening while the player stands still;
  //    dying and starting again; the exit, the level-clear screen and starting again.
  const G = (x, y) => read(boot.GRID + 128 * y + x);
  const at = (x, y, fx, fy, angle) => { put('px', x, fx); put('py', y, fy); put('angle', angle); put('health', 100); };
  put('count', 2); put('things', sx + 3, sy, 1, 9, sx + 5, sy + 1, 3, 9); put('waitForAttack', 255, 255); put('wind', 0, 0);
  at(sx, sy, 128, 128, 0); step('still', 6);
  hold(['D']); step('still', 1); hold([]); step('still', 5); hold(['D']); step('still', 1); hold([]); step('still', 3);
  for (let i = 0; i < 10; i++) { at(sx, sy, i & 1 ? 40 : 128, 128, 0); step('alt'); }
  for (let i = 0; i < 12; i++) { at(sx, sy, 128, 128, i & 2 ? 3 : 0); step('alt'); }
  for (let i = 0; i < 9; i++) { at(sx + (i % 3 === 2 ? 1 : 0), sy, 128, 128, 0); step('alt'); }
  let doors = 0;
  for (let y = 2; y < rows - 2 && doors < 3; y++) for (let x = 2; x < 126 && doors < 3; x++) {
    if (!(G(x, y) & 16) || (G(x, y) >> 6)) continue;
    for (const [dx, dy, angle, bit] of [[-1, 0, 0, 1], [1, 0, 16, 2], [0, -1, 8, 4], [0, 1, 24, 8]]) {
      const c = G(x + dx, y + dy);
      if (!(c & 15) || (c & 0x30) || !(c & bit)) continue;
      at(x + dx, y + dy, 128, 128, angle); step('door', 3);
      hold(['E']); step('door', 1); hold([]); step('door', 12);
      hold(['UP']); step('door', 6); hold([]); step('door', 2);
      doors++; break;
    }
  }
  if (!doors) throw Error('no door to open in this map');
  at(sx, sy, 128, 128, 0); step('still', 3);
  put('health', 0); for (let i = 0; i < 4; i++) { picture(); record('dead'); }
  hold(['ENTER']); picture(); record('dead'); hold([]);
  for (let i = 0; i < 6; i++) { picture(); record('again'); }
  let exits = 0;
  for (let y = 2; y < rows - 2 && !exits; y++) for (let x = 2; x < 126 && !exits; x++) {
    if (!(G(x, y) & 32)) continue;
    for (const [dx, dy, angle, bit] of [[-1, 0, 0, 1], [1, 0, 16, 2], [0, -1, 8, 4], [0, 1, 24, 8]]) {
      const c = G(x + dx, y + dy);
      if (!(c & 15) || (c & 0x30) || !(c & bit)) continue;
      at(x + dx, y + dy, 128, 128, angle); step('exit', 3);
      hold(['E']); step('exit', 1); hold(['ENTER']);          // ENTER skips the cue, then starts the level again
      step('exit', 1); hold([]); step('exit', 6);
      exits++; break;
    }
  }
  if (!exits) throw Error('no exit to use in this map');
  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  console.log(`${lines.length} pictures recorded to ${outFile}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
