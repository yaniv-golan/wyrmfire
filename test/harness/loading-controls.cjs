// The loading screen shows the controls while the level disk unpacks, so a player has something to read before the
// first picture. The text lives in the LOADER, not the engine.
//
// Read through CLOADM's own screen reader (Session.screenText), not by decoding cell bytes: that reader is the
// project's model of what the VDG shows, and a hand decode of the same cells reads $60 (the space glyph) as a
// backtick -- an artefact of ASCII, not something a player ever sees.
//   node test/harness/loading-controls.cjs CLOADM_DIR BUILD_DIR
const boot = require('./boot.cjs');
const assert = require('assert/strict');
const [repo, dir] = process.argv.slice(2);
const TEXT = 'ARROWS TURN  SPACE FIRES';
(async () => {
  const files = boot.layout(dir), s = await boot(repo, files);
  // sample the first pictures, while the loader's screen is what is shown
  let found = null;
  for (let i = 0; i < 60 && found === null; i++) {
    s.runFrames(1);
    const row = s.screenText().find((l) => l.includes('ARROWS'));
    if (row !== undefined) found = row;
  }
  assert.ok(found !== null, 'the controls text never appeared on the loading screen');
  assert.ok(found.includes(TEXT), `the loading screen reads ${JSON.stringify(found.trim())}, want it to contain ${JSON.stringify(TEXT)}`);
  // it is on the loading screen, not the game: no HUD yet
  assert.ok(!s.screenText().some((l) => l.includes('HEALTH')), 'the controls check ran after the game had started');
  console.log(JSON.stringify({ row: found.trim() }));
  console.log('all loading-controls checks passed');
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
