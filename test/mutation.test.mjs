// Mutation check for the archive readers (zip, self-extractor parts, LHA): each mutant of the converter must
// make test/archive.test.mjs fail. Needs ARCHIVE_FIXTURES (Freedoom-built).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../converter/wyrmfire-convert.js'), 'utf8');

export const MUTANTS = [
  { name: 'deflate length-base table: 15 -> 16',
    from: 'const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17,', to: 'const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 16, 17,' },
  { name: 'deflate distance-extra table: 4 -> 5 bits',
    from: 'const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4,', to: 'const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 5, 4,' },
  { name: 'LHA -lh5- position decode off by one',
    from: 'if (j !== 0) j = (1 << (j - 1)) + r.get(j - 1);', to: 'if (j !== 0) j = (1 << j) + r.get(j - 1);' },
  { name: 'LHA -lh1- position table off by one (one code moved from 5 to 4 bits)',
    from: '[[3, 1], [4, 3], [5, 8],', to: '[[3, 1], [4, 4], [5, 7],' },
  { name: 'zip self-extractor stub shift ignored',
    from: 'const shift = eocd - cdSize - dv.getUint32(eocd + 16, true);', to: 'const shift = 0;' },
  { name: 'split parts joined in descending order',
    from: 'const parts = set.parts.slice().sort((a, b) => a.n - b.n);', to: 'const parts = set.parts.slice().sort((a, b) => b.n - a.n);' },
  { name: 'split parts joined in given order (no sort)',
    from: 'const parts = set.parts.slice().sort((a, b) => a.n - b.n);', to: 'const parts = set.parts.slice(); const first0 = Math.min(...parts.map((p) => p.n)); parts.forEach((p, i) => { p.n = first0 + i; });' },
];

const FIX = process.env.ARCHIVE_FIXTURES;
const run = (file) => spawnSync(process.execPath, ['--test', path.join(here, 'archive.test.mjs')],
  { env: childEnv(file), encoding: 'utf8', maxBuffer: 1 << 26 });
// A nested `node --test` must not inherit the parent runner's context, or it
// reports to the parent instead of setting its own exit status.
function childEnv(file) { const e = { ...process.env, WYRMFIRE_CONVERTER: file }; delete e.NODE_TEST_CONTEXT; return e; }

test('archive tests pass on the real converter and fail on every mutant', { skip: !FIX && 'set ARCHIVE_FIXTURES', timeout: 1800_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyrmfire-mutants-'));
  const original = path.join(dir, 'original.js');
  fs.writeFileSync(original, source);
  assert.equal(run(original).status, 0, 'baseline must pass');
  const results = [];
  for (const m of MUTANTS) {
    assert.equal(source.split(m.from).length, 2, `mutation site not found exactly once: ${m.name}`);
    const file = path.join(dir, m.name.replace(/\W+/g, '-') + '.js');
    fs.writeFileSync(file, source.replace(m.from, m.to));
    const r = run(file);
    const failed = (r.stdout.match(/^not ok \d+ - (.*)$/gm) || []).map((l) => l.replace(/^not ok \d+ - /, ''));
    results.push({ mutant: m.name, killed: r.status !== 0, failingTests: failed });
  }
  console.log(JSON.stringify(results, null, 1));
  for (const r of results) assert.ok(r.killed, `mutant survived: ${r.mutant}`);
});
