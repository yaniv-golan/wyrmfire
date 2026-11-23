#!/usr/bin/env node
// node converter/cli.mjs INPUT... [--map E1M1] [--sha256 HEX] [--out wyrmfire.vdk] [--info info.json] [--list]
// INPUT: a .wad, the original .zip, an .lzh/.lha, or the split parts (DOOMS_19.1 DOOMS_19.2).
// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { convertAsync, openWadAsync, listMaps } from './wyrmfire-convert.js';

const args = process.argv.slice(2), opt = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--list') opt.list = true;
  else if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
if (!pos.length) { console.error('usage: cli.mjs INPUT... [--map E1M1] [--sha256 HEX] [--out wyrmfire.vdk] [--info info.json] [--list]'); process.exit(2); }
const files = pos.map((p) => ({ name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }));
try {
  if (opt.list) { const s = await openWadAsync(files, { sha256: opt.sha256 }); console.log(`${s.name} (${s.container}) sha256 ${s.sha256}`); console.log(listMaps(s.bytes).join(' ')); process.exit(0); }
  const { disk, info } = await convertAsync(files, { map: opt.map || 'E1M1', sha256: opt.sha256 });
  fs.writeFileSync(opt.out || 'wyrmfire.vdk', disk);
  if (opt.info) fs.writeFileSync(opt.info, JSON.stringify(info, null, 1) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(info).filter(([, v]) => typeof v !== 'object'))));
} catch (e) {
  console.error(`${e.name}: ${e.message}`);
  process.exit(1);
}
