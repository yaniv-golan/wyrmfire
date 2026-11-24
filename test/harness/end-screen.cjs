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

// ticks === null: leave levelTicks alone and count the pictures the game really drew, so the clock is tested
// against real elapsed time. Otherwise poke it (kept for callers that want a fixed value).
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
  if (ticks !== null) w('levelTicks', ticks);
  b1('kills', kills);
  // real pictures (the engine's own counter, bumped in draw()) before and after the clear
  const pic = () => r(0x200) + (r(sym.levelTicks + 0) === undefined ? 0 : 0);
  // dwell: let the level run for a real span of pictures with the player NOT on the exit, so levelTicks
  // accumulates. 120 pictures is ~11 s at the engine's 11 pictures/s.
  const DWELL = ticks === null ? 120 : 0;
  for (let k = 0; k < DWELL; k++) next();
  // now step onto the exit and press E
  let f = 0;
  for (; f < 400 && !r(sym.won); f++) { m.setKey('E', f % 8 < 4); s.runFrames(1); }
  assert.equal(r(sym.won), 1, 'the level clear never fired (E on the exit cell)');
  for (let k = 0; k < 10; k++) { m.setKey('E', false); s.runFrames(1); }
  // pictures drawn between the start and the clear: the engine bumps levelTicks once per pass, so this is
  // levelTicks minus whatever it was when we began (0, since a level clear resets it at level start).
  return { s, m, sym, r, elapsedPictures: ticks === null ? (r(sym.levelTicks) * 256 + r(sym.levelTicks + 1)) : ticks };
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
  // ---- TIME must reflect REAL elapsed time, not a poked counter. Run a known number of PICTURES and check that
  // the clock matches the picture rate the engine actually runs at. Poking levelTicks would hide exactly the bug
  // this catches (the first version divided pictures by 50, reading 4.4x fast).
  {
    const { m, r, elapsedPictures } = await levelClear(repo, dir, null, 9);
    const shown = m.sam.displayBase;
    const row = rowChars(r, shown, 101, 30).replace(/\s+$/, '');
    const mmss = /TIME (\d\d):(\d\d)/.exec(row);
    assert.ok(mmss, `no TIME mm:ss on the row: ${JSON.stringify(row)}`);
    const shownSecs = (+mmss[1]) * 60 + (+mmss[2]);
    // the harness now waits `elapsedPictures` pictures; the engine runs PICTURES_PER_SEC pictures a second
    const want = Math.round(elapsedPictures / 11);
    assert.ok(Math.abs(shownSecs - want) <= 1,
      `TIME showed ${mmss[1]}:${mmss[2]} (${shownSecs}s) after ${elapsedPictures} pictures; at the engine's rate that is ${want}s (±1)`);
    assert.ok(/KILLS 09/.test(row), `want KILLS 09 (9 killed), read ${JSON.stringify(row)}`);
    console.log(JSON.stringify({ row, picturesRun: elapsedPictures, shownSeconds: shownSecs, expected: want }));
  }
  // ---- a second value for kills, drawn without poking
  {
    const { m, r } = await levelClear(repo, dir, null, 4);
    const row = rowChars(r, m.sam.displayBase, 101, 30).replace(/\s+$/, '');
    assert.ok(/KILLS 04/.test(row), `want "KILLS 04" (4 killed), read ${JSON.stringify(row)}`);
    console.log(JSON.stringify({ row }));
  }
  console.log('all end-screen checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
