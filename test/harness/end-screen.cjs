// The LEVEL CLEAR screen shows how long the level took and how many it cost: "TIME mm:ss  KILLS nn".
//
// The time is real PAL fields from the field-sync interrupt (src/clock.h), stopped the moment the exit is used.
// test/harness/clock.cjs proves the count is exact; this harness proves the end screen shows THAT count, from the
// rendered page: the clock is poked to a known value before the exit is used, and the row must read the value the
// clock stopped at, which must be the poked value plus the time spent getting to the exit. It also requires that
// the clock stays stopped on the end screen, and that a clock past 99 minutes reads 99:59.
//
// The engine draws its own 8x9 bitmap glyphs (src/font.h) into the VDG page, so a rendered-frame check means
// decoding pixels back to characters and comparing with the font -- the same oracle hud-keys.cjs uses.
//   node test/harness/end-screen.cjs CLOADM_DIR BUILD_DIR [--verbose]
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);
const VERBOSE = process.argv.includes('--verbose');

const FONT = (() => {
  const h = fs.readFileSync(path.resolve(__dirname, '../../src/font.h'), 'utf8');
  return /static const byte font\[\d+\]=\{(.*?)\};/s.exec(h)[1].split(',').map((x) => parseInt(x.trim())).filter((x) => !isNaN(x));
})();
const glyph = (ch) => { const g = ch.charCodeAt(0) - 32; return FONT.slice(g * 9, g * 9 + 9); };

// Drive a real level clear: stand ON an exit cell (use() tests at(px,py) first), press E.
async function levelClear(repo, dir, kills, seconds) {
  const files = boot.layout(dir), sym = boot.symbols(files.map);
  const s = await boot(repo, files);
  const m = s.machine, r = (a) => s.readByte(a);
  const next = () => { const v = r(0x200); let n = 0; while (r(0x200) === v) { m.setKey('ENTER', r(0x200) === 0 && n % 25 < 12); s.runFrames(1); if (++n > 3000) throw Error('no picture; PC ' + m.cpu.pc.toString(16)); } m.setKey('ENTER', false); return n; };
  next(); next();
  const GRID = boot.GRID, at = (x, y) => GRID + ((y << 7) + x);
  let ex = -1, ey = -1;
  for (let cy = 0; cy < 128 && ex < 0; cy++) for (let cx = 0; cx < 128 && ex < 0; cx++) if (r(at(cx, cy)) & 32) { ex = cx; ey = cy; }
  assert.ok(ex >= 0, 'no exit cell on this level disk');
  // px/py are 16-bit: the map CELL in the high byte, the position within it in the low (128 = centre)
  s.pokeBytes(sym.px, [ex & 255, 128]);
  s.pokeBytes(sym.py, [ey & 255, 128]);
  s.pokeBytes(sym.angle, [0]);
  s.pokeBytes(sym.kills, [kills & 255]);
  // the clock, mid-level: a whole number of seconds (clockTicks 0), so it must stop at seconds + elapsed/50
  const w = (a) => r(a) * 256 + r(a + 1);
  s.pokeBytes(sym.clockTicks, [0]);
  s.pokeBytes(sym.clockSeconds, [seconds >> 8, seconds & 255]);
  let f = 0;
  for (; f < 400 && !r(sym.won); f++) { m.setKey('E', f % 8 < 4); s.runFrames(1); }
  assert.equal(r(sym.won), 1, 'the level clear never fired (E on the exit cell)');
  assert.equal(r(sym.clockOn), 0, 'the clock is still running on the end screen');
  const stopped = w(sym.clockSeconds);
  assert.ok(stopped >= seconds && stopped <= seconds + Math.ceil(f / 50) + 1,
    `the clock stopped at ${stopped} s: poked ${seconds} s, then ${f} fields to the exit`);
  for (let k = 0; k < 100; k++) { m.setKey('E', false); s.runFrames(1); }
  assert.equal(w(sym.clockSeconds), stopped, 'the clock moved after the level clear');
  return { m, r, shown: m.sam.displayBase, stopped };
}

function rowChars(r, base, y, n) {
  return Array.from({ length: n }, (_, c) => {
    const col = Array.from({ length: 9 }, (_, i) => r(base + (y << 5) + c + (i << 5)));
    if (col.every((v) => v === 0)) return ' ';
    for (let ch = 32; ch < 91; ch++) { const g = glyph(String.fromCharCode(ch)); if (g.every((v, i) => v === col[i])) return String.fromCharCode(ch); }
    return '?';
  }).join('');
}

const mmss = (secs) => (secs >= 6000 ? '99:59' : String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0'));

(async () => {
  for (const [kills, seconds] of [[9, 63], [4, 3599], [12, 6005]]) {
    const { r, shown, stopped } = await levelClear(repo, dir, kills, seconds);
    // the whole end-screen band
    const band = [rowChars(r, shown, 92, 32), rowChars(r, shown, 101, 32), rowChars(r, shown, 110, 32)];
    const want = `TIME ${mmss(stopped)}  KILLS ${String(kills).padStart(2, '0')}`;
    // cue() clears columns 3..28 of the band; the edges still hold the last picture
    const row = band[1].slice(3, 29).trim();
    assert.equal(row, want, `row 101 reads ${JSON.stringify(row)}: want ${JSON.stringify(want)} (clock stopped at ${stopped} s, kills ${kills})`);
    assert.equal(band[1].indexOf('TIME'), 6, `the row is not centred: ${JSON.stringify(band[1])}`);
    assert.ok(band[0].includes('LEVEL CLEAR'), `row 92 reads ${JSON.stringify(band[0].trim())}`);
    if (VERBOSE) console.log(JSON.stringify({ kills, seconds, stopped, rows: band.map((x) => x.trim()) }));
  }
  console.log('all end-screen checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
