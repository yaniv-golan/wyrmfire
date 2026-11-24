// The loading screen shows the controls while the level disk unpacks, so a player has something to read before
// the first picture. The text lives in the LOADER, not the engine.
//
// Proved from the RENDERED FRAME, not from RAM and not from Session.screenText alone. screenText reads the page at
// $0400 as 16x32 cells whatever mode the VDG is in and wherever the SAM has put the display, so it reports the
// text for a loader that leaves the chip in a graphics mode, where a player sees an empty colour field. That is
// exactly the bug this check exists to catch: the loader used to write $FD to $FF22, whose bit 7 (AG) selects the
// highest-resolution GRAPHICS mode, and the rendered frame held 0 ink pixels where the text should be.
//
// What is asserted, all on the loader's OWN screen (the CPU parked so the engine never starts):
//   1. the loader reached its launch jump;
//   2. the VDG is in ALPHANUMERIC mode at that point (bit 7 of the $FF22 byte the chip decodes is clear, bit 4
//      INTEXT clear), and the SAM is showing the page the text was written to;
//   3. the rendered cells are the glyphs the chip's own font gives for the bytes in RAM -- a garbled or
//      wrong-coloured screen cannot pass, and neither can a correct page drawn in the wrong mode;
//   4. the text row has ink, and the HUD has not been drawn yet (this is the loading screen, not the game).
//   node test/harness/loading-controls.cjs CLOADM_DIR BUILD_DIR
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const boot = require('./boot.cjs');
const [repo, dir] = process.argv.slice(2);
const TEXT = 'ARROWS TURN  SPACE FIRES';
const PARK = 0x0300;                    // free RAM: the loader is at $0C00 and its packed stream follows it
const ROW = 6, COL = 3, NCELL = TEXT.length;

// The loader's own `launch jmp image_start`, from the build's listing: a loader that grows must not move the
// stop out from under the test.
function launchAddress(buildDir) {
  const lst = path.join(buildDir, 'loader.lst');
  assert.ok(fs.existsSync(lst), `no loader.lst in ${buildDir}: build with tools/build-engine.sh`);
  const m = /^\s*([0-9A-F]{4})\s+[0-9A-F]+\s+\([^)]*loader\.asm\):\d+\s+launch\s+jmp\s+image_start/m.exec(fs.readFileSync(lst, 'utf8'));
  assert.ok(m, `no "launch jmp image_start" in ${lst}`);
  return parseInt(m[1], 16);
}

(async () => {
  const files = boot.layout(dir), LAUNCH = launchAddress(dir);
  const s = await boot(repo, files);
  const m = s.machine, cpu = m.cpu;
  // CLOADM's own character generator, the model of the chip: the expectation comes from the glyph data, not
  // from a picture of it.
  const { MC6847 } = await import(path.resolve(repo, 'js/chips/mc6847.js'));
  const chip = new MC6847();

  // 1. the loader ran to the end
  cpu.jump(0x0C00);
  let hits = 0;
  for (let i = 0; i < 400000; i++) { if (cpu.pc === LAUNCH) { hits++; break; } cpu.step(); }
  assert.equal(hits, 1, `the loader's launch $${LAUNCH.toString(16)} was never reached (PC $${cpu.pc.toString(16)})`);

  // 2. the mode it left the chip in. Read the byte the VDG decodes: PIA1 port B's output pins with the input
  //    pins floating high -- NOT m.pia1.b.or, whose bit 0 is an input on this machine and comes back high, so
  //    $00 in the output register is the byte $01, and `& 0x80` on the register is a different question from
  //    the one the chip answers.
  const modeByte = m.pia1.b.outValue();
  assert.equal(modeByte & 0x80, 0, `the loader leaves $FF22 = $${modeByte.toString(16)}: bit 7 (AG) set is a GRAPHICS mode`);
  assert.equal(modeByte & 0x10, 0, `the loader leaves $FF22 = $${modeByte.toString(16)}: bit 4 (INTEXT) set wants a character generator this machine has none of`);
  const base = m.sam.displayBase;
  assert.equal(base, 0x0400, `the SAM shows $${base.toString(16)}, not the $0400 page the controls were written to`);

  // 3. the page the loader wrote, and the frame it draws. Park the CPU in `bra .` so the engine cannot start and
  //    nothing else can change the video registers, then let the VDG draw with the loader's own state.
  const cells = Array.from({ length: NCELL }, (_, i) => s.readByte(0x400 + ROW * 32 + COL + i));
  const shown = cells.map((b) => (b >= 0x41 && b <= 0x5A ? String.fromCharCode(b) : b === 0x60 || b === 0x20 ? ' ' : '.')).join('');
  assert.equal(shown, TEXT, `the loader wrote ${JSON.stringify(shown)} to the text row, want ${JSON.stringify(TEXT)}`);
  s.pokeBytes(PARK, [0x20, 0xFE]);                 // bra .
  cpu.jump(PARK);
  for (let i = 0; i < 4; i++) s.runFrames(1);
  const fr = m.render(), W = fr.width;
  const css = (modeByte >> 3) & 1, fg = css ? 11 : 0;   // CLOADM's colour codes: green, or bright orange with CSS
  let matched = 0, inkInRow = 0;
  const bad = [];
  for (let ci = 0; ci < NCELL; ci++) {
    const code = cells[ci];
    let ok = true;
    for (let line = 0; line < 12 && ok; line++) {
      const bits = chip.glyph(code, line);         // the chip's own glyph row, INV applied
      for (let px = 0; px < 8; px++) {
        const lit = (bits >> (7 - px)) & 1;
        const got = fr.data[(24 + ROW * 12 + line) * W + 32 + (COL + ci) * 8 + px];
        if (lit ? got !== fg : got === fg) { ok = false; break; }
      }
    }
    if (ok) matched++; else bad.push(ci);
    for (let line = 0; line < 12; line++) for (let px = 0; px < 8; px++) if (fr.data[(24 + ROW * 12 + line) * W + 32 + (COL + ci) * 8 + px] === fg) inkInRow++;
  }
  assert.equal(matched, NCELL, `${matched}/${NCELL} rendered cells are the chip's glyphs for the bytes in RAM; wrong at ${JSON.stringify(bad)}`);
  assert.ok(inkInRow > 0, 'the rendered text row has no ink: the mode may be right but nothing is drawn');
  // 4. no HUD yet: this is the loading screen, not the game (the HUD's labels sit on the row above the controls)
  let hud = false;
  for (let ci = 0; ci < 32; ci++) {
    const code = s.readByte(0x400 + 5 * 32 + ci);
    if (code >= 0x41 && code <= 0x5A) hud = true;
  }
  assert.equal(hud, false, 'the controls check ran after the game had started (letters on the HUD row)');
  console.log(JSON.stringify({ launch: '$' + LAUNCH.toString(16), mode: '$' + modeByte.toString(16), samBase: '$' + base.toString(16), matched, inkInRow }));
  console.log('all loading-controls checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
