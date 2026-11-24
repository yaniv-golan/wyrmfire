// The LEVEL CLEAR screen says how long the level took and how many it cost: "TIME mm:ss  KILLS n".
// The engine draws its own 8x9 bitmap glyphs (src/font.h) into the VDG page, so a rendered-frame check means
// decoding pixels back to characters and comparing with the font -- the same oracle hud-keys.cjs uses.
//
// Three things this caught, all of them real:
//   * number() is fixed at three digits, so mm printed as 001 and the ':' written over its third column left
//     "00:" on the row, and kills printed as 009 (twodigits() now draws two cells).
//   * text() writes 9 scanlines, so the old 72/80/87 spacing overlapped: "LEVEL CLEAR" ran into the TIME row
//     (72..80) and "ENTER SKIPS MUSIC" started inside it (87 against 80..88). draw()'s own "LEVEL CLEAR. ENTER"
//     at y=76 covers 76..84 every frame. The end screen now sits below that band, at 92/101/110.
//   * cue() drew to the VISIBLE page and never flipped: the row was correct in RAM and the player saw the other
//     page. It now builds the screen on the hidden page and flips the SAM exactly as draw() does.
//   node test/harness/end-screen.cjs CLOADM_DIR BUILD_DIR
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);

// the engine's own font, so the expectation comes from the glyph data rather than from a picture of it
const FONT = (() => {
  const h = fs.readFileSync(path.resolve(__dirname, '../../src/font.h'), 'utf8');
  return /static const byte font\[\d+\]=\{(.*?)\};/s.exec(h)[1].split(',').map((x) => parseInt(x.trim())).filter((x) => !isNaN(x));
})();
const glyph = (ch) => { const g = ch.charCodeAt(0) - 32; return FONT.slice(g * 9, g * 9 + 9); };

async function levelClear(repo, dir, ticks, kills) {
  const files = boot.layout(dir), sym = boot.symbols(files.map);
  const s = await boot(repo, files);
  const m = s.machine, r = (a) => s.readByte(a);
  const w = (k, v) => s.pokeBytes(sym[k], [(v >> 8) & 255, v & 255]);
  const b1 = (k, v) => s.pokeBytes(sym[k], [v & 255]);
  const next = () => { const v = r(0x200); let n = 0; while (r(0x200) === v) { m.setKey('ENTER', r(0x200) === 0 && n % 25 < 12); s.runFrames(1); if (++n > 3000) throw Error('no picture; PC ' + m.cpu.pc.toString(16)); } m.setKey('ENTER', false); return n; };
  next(); next();
  // stand ON an exit cell: use() tests at(px,py) first, so the clear fires without any walking
  const GRID = boot.GRID, at = (x, y) => GRID + ((y << 7) + x);
  let ex = -1, ey = -1;
  for (let cy = 0; cy < 128 && ex < 0; cy++) for (let cx = 0; cx < 128 && ex < 0; cx++) if (r(at(cx, cy)) & 32) { ex = cx; ey = cy; }
  assert.ok(ex >= 0, 'no exit cell on this level disk');
  w('px', (ex << 8) + 128); w('py', (ey << 8) + 128); b1('angle', 0);
  w('levelTicks', ticks); b1('kills', kills);
  for (let f = 0; f < 120 && !r(sym.won); f++) { m.setKey('E', f % 8 < 4); s.runFrames(1); }
  assert.equal(r(sym.won), 1, 'the level clear never fired (E on the exit cell)');
  for (let f = 0; f < 10; f++) { m.setKey('E', false); s.runFrames(1); }
  return { s, m, sym, r };
}

// decode a text row of the page the VDG is showing, one glyph per 8-pixel cell
function rowChars(r, base, y, n) {
  return Array.from({ length: n }, (_, c) => {
    const col = Array.from({ length: 9 }, (_, i) => r(base + (y << 5) + c + (i << 5)));
    if (col.every((v) => v === 0)) return ' ';
    for (let ch = 32; ch < 91; ch++) { const g = glyph(String.fromCharCode(ch)); if (g.every((v, i) => v === col[i])) return String.fromCharCode(ch); }
    return '?';
  }).join('');
}

(async () => {
  // ---- a known time and kill count: 3177 fields is 63.5 s -> 01:03; 9 kills -> 09
  {
    const { s, m, r } = await levelClear(repo, dir, 3177, 9);
    const shown = m.sam.displayBase;
    const row = rowChars(r, shown, 101, 30).replace(/\s+$/, '');
    assert.ok(row.includes('TIME'), `the end screen's time row reads ${JSON.stringify(row)}: no TIME on the page the screen shows`);
    assert.ok(/TIME 01:03/.test(row), `want "TIME 01:03" on the row (3177 fields), read ${JSON.stringify(row)}`);
    assert.ok(/KILLS 09/.test(row) || /KILLS 9\b/.test(row), `want "KILLS 09" on the row (9 killed), read ${JSON.stringify(row)}`);
    // the title and the prompt, read from the column each is drawn at (cue(): text(7,92,..), text(7,110,..));
    // the cells to their left are the scene, so the check starts at the column the engine writes
    const title = rowChars(r, shown, 92, 20).slice(7).trim(), prompt = rowChars(r, shown, 110, 26).slice(7).trim();
    assert.equal(title, 'LEVEL CLEAR', `the title reads ${JSON.stringify(title)}`);
    assert.equal(prompt, 'ENTER SKIPS MUSIC', `the prompt reads ${JSON.stringify(prompt)}`);
    // and the frame the player sees has ink where the time row is: this is what "visible" means
    const fr = m.render(), W = fr.width, BX = 32, BY = 24;
    let ink = 0;
    // a text row is 9 scanlines at the same pixel rows text() wrote; the 32x16 page maps 12 scanlines a cell row,
    // but the engine runs its own graphics mode, so read the band the row's bytes land in
    for (let y = 101; y < 110; y++) for (let x = BX; x < BX + 256; x++) if (fr.data[(BY + y) * W + x] !== 8) ink++;
    assert.ok(ink > 0, 'the rendered frame has no ink on the time row');
    console.log(JSON.stringify({ title, prompt, inkOnTimeRow: ink }));
  }
  // ---- a different time and kills, so the numbers are read rather than assumed
  {
    const { m, r } = await levelClear(repo, dir, 150 * 50 + 7 * 50, 4);   // 157 s -> 02:37, 4 kills
    const shown = m.sam.displayBase;
    const row = rowChars(r, shown, 101, 30).replace(/\s+$/, '');
    console.log(JSON.stringify({ shown: '$' + shown.toString(16), row }));
    assert.ok(/TIME 02:37/.test(row), `want "TIME 02:37" (7850 fields), read ${JSON.stringify(row)}`);
    assert.ok(/KILLS 04/.test(row) || /KILLS 4\b/.test(row), `want "KILLS 04" (4 killed), read ${JSON.stringify(row)}`);
  }
  console.log('all end-screen checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
