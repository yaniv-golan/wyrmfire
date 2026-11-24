// The HUD's KEY field shows one glyph per key slot: '1' '2' '3' for the keys held, '-' for those not, so a player
// sees WHICH keys are in hand. It used to print the keys bitmask as a decimal, so holding keys 1 and 2 showed "3".
//   node test/harness/hud-keys.cjs CLOADM_DIR BUILD_DIR
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);
// the engine's own font, so the expectation comes from the glyph data rather than from a picture of it
const glyphOf = (ch) => {
  const h = fs.readFileSync(path.resolve(__dirname, '../../src/font.h'), 'utf8');
  const bytes = /static const byte font\[\d+\]=\{(.*?)\};/s.exec(h)[1].split(',').map((x) => parseInt(x.trim())).filter((x) => !isNaN(x));
  const g = ch.charCodeAt(0) - 32;
  return bytes.slice(g * 9, g * 9 + 9);
};
(async () => {
  const files = boot.layout(dir), sym = boot.symbols(files.map);
  const s = await boot(repo, files);
  const r = (a) => s.readByte(a), put = (k, ...v) => s.pokeBytes(sym[k], v);
  const next = () => { const v = r(0x200); let n = 0; while (r(0x200) === v) { s.machine.setKey('ENTER', r(0x200) === 0 && n % 50 < 25); s.runFrames(1); if (++n > 2000) throw Error('no picture; PC ' + s.machine.cpu.pc.toString(16)); } s.machine.setKey('ENTER', false); return n; };
  next(); next();
  // native.c: text(x,y) writes glyph pixel-row i at back + (y << 5) + x + (i << 5); keysHud draws at (19,177).
  const PAGES = [0xE000, 0x0400], COL = 19, ROW = 177;
  const at = (base, k, i) => r(base + (ROW << 5) + COL + k + (i << 5));
  const check = (label, keys, want) => {
    put('keys', keys); next();
    // Read whichever page MATCHES the wanted glyphs. The engine flips the drawn page each picture and `back` points
    // at the next one, so neither a label scan nor the pointer reliably names the page just drawn; matching the
    // content does, and it still fails honestly if the field is drawn wrong on both.
    const matches = (b) => want.split('').every((ch, k) => {
      const g = glyphOf(ch);
      return [1, 2, 3, 4, 5, 6, 7].every((i) => at(b, k, i) === g[i]);
    });
    const base = PAGES.find(matches);
    assert.ok(base !== undefined, `${label}: no page shows the wanted glyphs in the KEY field`);
    want.split('').forEach((ch, k) => {
      const g = glyphOf(ch);
      for (let i = 1; i <= 7; i++) {
        assert.equal(at(base, k, i), g[i],
          `${label}: glyph ${k} ('${ch}') pixel row ${i} is $${at(base, k, i).toString(16)}, want $${g[i].toString(16)}`);
      }
    });
  };
  check('no keys', 0, '---');
  check('keys 1 and 2 (the bitmask 3 that used to print as "3")', 3, '12-');
  check('key 3 only', 4, '--3');
  check('all three', 7, '123');
  console.log('all hud-keys checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
