#!/usr/bin/env node
// node converter/cli.mjs INPUT... [--map E1M1] [--sha256 HEX] [--out wyrmfire.vdk] [--info info.json] [--list] [--help]
// INPUT: a .wad, the original .zip, an .lzh/.lha, or the split parts (DOOMS_19.1 DOOMS_19.2).
// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { convertAsync, openWadAsync, listMaps } from './wyrmfire-convert.js';

const args = process.argv.slice(2), opt = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--list' || args[i] === '--help') opt[args[i].slice(2)] = true;
  else if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const HELP = `usage: node converter/cli.mjs INPUT... [--map E1M1] [--out wyrmfire.vdk] [--info info.json] [--sha256 HEX] [--list]
  INPUT   a Doom-format IWAD (.wad), its .zip or .lzh/.lha, or the split self-extractor parts
  --map   map to convert (default E1M1); --list prints the maps instead
  --out   level disk to write (default wyrmfire.vdk); --info also writes the conversion details as JSON
  --sha256  refuse the input unless its SHA-256 matches`;
if (opt.help || args.includes('-h')) { console.log(HELP); process.exit(0); }
if (!pos.length) { console.error(HELP); process.exit(2); }
const READ_ERRORS = { ENOENT: 'no such file', EISDIR: 'is a directory', EACCES: 'permission denied' };
const files = pos.map((p) => {
  try { return { name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }; } catch (e) {
    if (!READ_ERRORS[e.code]) throw e;
    console.error(`cli.mjs: cannot read ${p}: ${READ_ERRORS[e.code]}`);
    process.exit(2);
  }
});
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
