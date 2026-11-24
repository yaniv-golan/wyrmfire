// The LEVEL CLEAR screen shows how many the level cost: "KILLS nn". It does NOT show a time.
//
// Why no time: this engine draws 11 to 45 pictures a second depending on how much the renderer and the disk
// loader are doing, so a clock counted in pictures cannot be right; and counting real PAL fields needs a field
// interrupt the engine has no space or structure for (the vector lives in ROM and the engine runs I-masked by
// design). An approximate clock presented as real was ruled out, so the number is dropped rather than shown
// wrong. This harness therefore asserts the kill count EXACTLY, from the rendered page, and asserts that no
// TIME text appears anywhere on the screen.
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
async function levelClear(repo, dir, kills) {
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
  let f = 0;
  for (; f < 400 && !r(sym.won); f++) { m.setKey('E', f % 8 < 4); s.runFrames(1); }
  assert.equal(r(sym.won), 1, 'the level clear never fired (E on the exit cell)');
  for (let k = 0; k < 10; k++) { m.setKey('E', false); s.runFrames(1); }
  return { m, r, shown: m.sam.displayBase };
}

function rowChars(r, base, y, n) {
  return Array.from({ length: n }, (_, c) => {
    const col = Array.from({ length: 9 }, (_, i) => r(base + (y << 5) + c + (i << 5)));
    if (col.every((v) => v === 0)) return ' ';
    for (let ch = 32; ch < 91; ch++) { const g = glyph(String.fromCharCode(ch)); if (g.every((v, i) => v === col[i])) return String.fromCharCode(ch); }
    return '?';
  }).join('');
}

(async () => {
  for (const kills of [9, 4]) {
    const { r, shown } = await levelClear(repo, dir, kills);
    // the whole end-screen band, so a TIME row anywhere in it is caught
    const band = [rowChars(r, shown, 92, 32), rowChars(r, shown, 101, 32), rowChars(r, shown, 110, 32)];
    const all = band.join('|');
    const want = String(kills).padStart(2, '0');
    assert.ok(band[1].includes('KILLS ' + want),
      `row 101 reads ${JSON.stringify(band[1].trim())}: want "KILLS ${want}" (kills poked to ${kills})`);
    assert.ok(!/TIME/.test(all), `the end screen still shows TIME text: ${JSON.stringify(all)}`);
    assert.ok(!/\d\d:\d\d/.test(all), `the end screen still has a clock-shaped mm:ss: ${JSON.stringify(all)}`);
    if (VERBOSE) console.log(JSON.stringify({ kills, rows: band.map((x) => x.trim()) }));
  }
  console.log('all end-screen checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
