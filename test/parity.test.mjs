// Parity: the JS converter must match the Python reference byte for byte.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   PARITY_WADS=freedoom1.wad:freedoom2.wad [PARITY_MAPS="E1M1 E1M8"] node --test test/parity.test.mjs
// Compares every stage (grid, wall records, floors, region payloads and LZ
// streams, door groups, final disk SHA-256 or the exact error) for every map.
// Run on Freedoom only; never point it at an id Software IWAD in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wads = (process.env.PARITY_WADS || '').split(':').filter(Boolean);
const maps = (process.env.PARITY_MAPS || '').split(/\s+/).filter(Boolean);
const run = (cmd, args) => JSON.parse(execFileSync(cmd, args, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] }).toString());

for (const wad of wads) {
  test(`JS and Python agree on ${path.basename(wad)}`, { timeout: 3600_000 }, () => {
    const py = run('python3', [path.join(here, 'parity/dump.py'), wad, ...maps]);
    const js = run(process.execPath, [path.join(here, 'parity/dump.mjs'), wad, ...maps]);
    const names = Object.keys(py).filter((k) => k !== '_assets');
    assert.ok(names.length > 0, 'no maps');
    let identical = 0;
    for (const name of names) {
      assert.deepEqual(js[name], py[name], `${name} differs`);
      if (py[name].disk) identical++;
    }
    assert.equal(js._assets, py._assets, 'asset block differs');
    console.log(`${path.basename(wad)}: ${names.length} maps agree at every stage; ${identical} produce a disk (byte-identical)`);
  });
}
test('parity inputs', { skip: wads.length > 0 && 'running' }, () => { console.log('set PARITY_WADS to run parity'); });
