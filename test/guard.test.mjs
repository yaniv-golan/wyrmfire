// The repository guard flags planted problems and passes a clean repository.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scan = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tools/guard/scan.mjs');
const ID = ['-c', 'user.name=Yaniv Golan', '-c', 'user.email=5079117+yaniv-golan@users.noreply.github.com'];
function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wyrmfire-scan-'));
  const g = (...a) => execFileSync('git', ['-C', d, ...ID, ...a], { stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  const write = (fl) => { for (const [n, c] of Object.entries(fl)) { fs.mkdirSync(path.dirname(path.join(d, n)), { recursive: true }); fs.writeFileSync(path.join(d, n), c); } };
  write(files); g('add', '-A'); g('commit', '-qm', 'init');
  return d;
}
const run = (d) => spawnSync(process.execPath, [scan, d], { encoding: 'utf8' });
const j = (...p) => p.join('');

test('clean repository passes', () => {
  const r = run(repo({ 'README.md': 'WYRMFIRE loads Doom-format WADs such as DOOM1.WAD.\n', 'LICENSES/freedoom-CREDITS.txt': j('origin', 'ally by someone <a', '@b.org>\n') }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

for (const [name, files, re] of [
  ['IWAD header', { 'data/x.bin': Buffer.concat([Buffer.from('IWAD'), Buffer.alloc(8)]) }, /WAD header/],
  ['WAD directory inside a file', { 'misc/blob.bin': Buffer.concat([Buffer.alloc(16), Buffer.from('E1M1\0\0\0\0'), Buffer.alloc(8), Buffer.from('THINGS\0\0')]) }, /WAD directory/],
  ['level-data file type', { 'level.vdk': 'x' }, /level-data/],
  ['forbidden word', { 'docs/a.md': j('the Han', 'gar engine\n') }, /forbidden word/],
  ['engine says doom', { 'src/x.c': 'char *t = "DOOM";\n' }, /engine/],
  ['e-mail', { 'a.txt': j('mail someone', '@example.com\n') }, /e-mail/],
  ['session link', { 'a.txt': j('see https://claude.ai/code/', 'session_0123\n') }, /session/],
  ['session trailer', { 'NOTES.md': j('Co-Authored', '-By: Claude <x>\n') }, /session/],
]) {
  test(`flags ${name}`, () => {
    const r = run(repo(files));
    assert.equal(r.status, 1); assert.match(r.stdout, re);
  });
}
