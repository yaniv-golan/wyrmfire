// The credits screen: C on the title opens it; it shows the level disk's own credit lines (for a Freedoom disk,
// "LEVEL DATA: FREEDOOM (BSD)" and "MODIFIED FOR THE DRAGON 64"), then the engine's lines; ENTER continues to the
// game. Read from the RENDERED page by decoding the engine's glyphs (as end-screen.cjs does).
//
// Then the mutant: the same disk with the Freedoom line blanked in its asset block (checksum fixed up) must FAIL
// this check, so the check is shown to read what is on the screen.
//   node test/harness/credits.cjs CLOADM_DIR BUILD_DIR [--verbose]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);
const VERBOSE = process.argv.includes('--verbose');

const FONT = (() => {
  const h = fs.readFileSync(path.resolve(__dirname, '../../src/font.h'), 'utf8');
  return /static const byte font\[\d+\]=\{(.*?)\};/s.exec(h)[1].split(',').map((x) => parseInt(x.trim())).filter((x) => !isNaN(x));
})();
const glyph = (code) => FONT.slice((code - 32) * 9, (code - 32) * 9 + 9);
function rowText(r, base, y) {
  return Array.from({ length: 32 }, (_, c) => {
    const col = Array.from({ length: 9 }, (_, i) => r(base + (y << 5) + c + (i << 5)));
    if (col.every((v) => v === 0)) return ' ';
    for (let ch = 32; ch < 91; ch++) if (glyph(ch).every((v, i) => v === col[i])) return String.fromCharCode(ch);
    return '?';
  }).join('').trimEnd();
}
const ROWS = [40, 64, 76, 88, 100, 112, 124, 160];
const EXPECTED = ['CREDITS', 'LEVEL DATA: FREEDOOM (BSD)', 'MODIFIED FOR THE DRAGON 64', 'WYRMFIRE  GPL-3.0', 'NOT AFFILIATED WITH ID SOFTWARE', 'ENTER CONTINUES'];

// Boot, hold C through the title, read the credits screen, press ENTER and wait for the first picture.
async function creditsScreen(files) {
  const s = await boot(repo, files), m = s.machine, r = (a) => s.readByte(a);
  let rows = [];
  for (let f = 0; f < 3000; f++) {
    m.setKey('C', true); s.runFrames(1);
    if (r(0x200)) throw Error('the game started without showing the credits screen');
    if (rowText(r, m.sam.displayBase, 40).trim() === 'CREDITS') { s.runFrames(50); rows = ROWS.map((y) => rowText(r, m.sam.displayBase, y)); break; }
  }
  m.setKey('C', false);
  if (!rows.length) throw Error('C on the title never showed a credits screen; PC ' + m.cpu.pc.toString(16));
  for (let f = 0; f < 30; f++) s.runFrames(1);
  assert.equal(r(0x200), 0, 'the credits screen must wait for ENTER');
  let f = 0;
  for (; f < 3000 && !r(0x200); f++) { m.setKey('ENTER', f % 20 < 10); s.runFrames(1); }
  m.setKey('ENTER', false);
  return { rows, continued: r(0x200) > 0 };
}

function check({ rows, continued }) {
  const shown = rows.map((t) => t.trim()).filter(Boolean);
  assert.deepEqual(shown, EXPECTED, 'credits screen text');
  assert.ok(continued, 'ENTER on the credits screen did not continue to the game');
}

(async () => {
  const files = boot.layout(dir);
  const real = await creditsScreen(files);
  if (VERBOSE) console.log(real.rows.join('\n'));
  check(real);
  console.log('screen_text:\n' + real.rows.map((t, i) => `  y=${String(ROWS[i]).padStart(3)} |${t.padEnd(32)}|`).join('\n'));

  // Mutant: blank the Freedoom line in the disk's credits entry (HGA1 entry 19), fix the checksum, run again.
  const vdk = fs.readFileSync(files.vdk), A = 12, be = (o) => (vdk[A + o] << 8) | vdk[A + o + 1];
  const off = be(8 + 4 * 19), len = be(10 + 4 * 19), entry = vdk.subarray(A + off, A + off + len);
  const at = Buffer.from(entry).indexOf('LEVEL DATA: FREEDOOM (BSD)');
  assert.ok(at >= 0, 'this level disk has no Freedoom credit line (is it a Freedoom disk?)');
  entry.fill(32, at, at + 'LEVEL DATA: FREEDOOM (BSD)'.length);
  let sum = 0; for (let i = 8; i < be(4); i++) sum += vdk[A + i];
  vdk[A + 6] = (sum >> 8) & 255; vdk[A + 7] = sum & 255;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wyrmfire-credits-'));
  try {
    fs.writeFileSync(path.join(tmp, 'wyrmfire.vdk'), vdk);
    const mutant = await creditsScreen({ ...files, vdk: path.join(tmp, 'wyrmfire.vdk') });
    assert.throws(() => check(mutant), /credits screen text/, 'the mutant (Freedoom line removed) passed the check');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log('Credits screen PASS (C on the title, Freedoom line, ENTER continues); mutant without the Freedoom line FAILS as it must');
})().catch((e) => { console.error(e); process.exitCode = 1; });
