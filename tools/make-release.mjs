// Assemble release artifacts into DIR with a manifest.json of SHA-256s.
// SPDX-License-Identifier: GPL-3.0-or-later
//   node tools/make-release.mjs --version 0.1.0 --engine build/wyrmfire.bin --out dist
// The engine must equal the committed bin/wyrmfire.bin. A release carries
// code only: no WAD, no level disk and nothing converted from one.
// docs/RELEASE.md describes what CLOADM pins.
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex, verifySha256, VERSION as CONVERTER_VERSION } from '../converter/wyrmfire-convert.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(args.out || 'dist'), version = args.version;
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version) || !args.engine) {
  console.error('usage: make-release.mjs --version X.Y.Z --engine build/wyrmfire.bin [--out dist]'); process.exit(2);
}
const env = Object.fromEntries(fs.readFileSync(path.join(root, 'tools/versions.env'), 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => l.split(/=(.*)/).slice(0, 2)));
const engine = new Uint8Array(fs.readFileSync(args.engine));
verifySha256(engine, sha256Hex(new Uint8Array(fs.readFileSync(path.join(root, 'bin/wyrmfire.bin')))), 'engine (must equal bin/wyrmfire.bin)');

const files = {
  'wyrmfire.bin': { bytes: engine, role: 'engine', description: 'WYRMFIRE engine for the Dragon 64: DragonDOS binary, loads at $0C00, starts at $0C00, unpacks itself to $1C00. Contains no level data.' },
  'wyrmfire.sym': { bytes: fs.readFileSync(path.join(root, 'bin/wyrmfire.sym')), role: 'symbols', description: 'Engine symbol addresses (CMOC link map, native.o).' },
  'wyrmfire-convert.js': { bytes: fs.readFileSync(path.join(root, 'converter/wyrmfire-convert.js')), role: 'converter', description: `Level converter ${CONVERTER_VERSION}: ES module, no dependencies; WAD, zip, self-extractor or LHA in, level disk (VDK) out.` },
  'worker.js': { bytes: fs.readFileSync(path.join(root, 'converter/worker.js')), role: 'converter-worker', description: 'Web Worker wrapper; imports ./wyrmfire-convert.js.' },
  'LICENSE': { bytes: fs.readFileSync(path.join(root, 'LICENSE')), role: 'licence', description: 'GPL-3.0-or-later.' },
};
for (const name of Object.keys(files)) if (/\.(wad|vdk|lvl|dat|lzh|zip)$/i.test(name)) throw new Error('release must not carry ' + name);

fs.mkdirSync(out, { recursive: true });
const manifest = {
  schema: 1, name: 'WYRMFIRE', version, tag: `v${version}`, licence: 'GPL-3.0-or-later',
  machine: { id: 'dragon64', ram: 64, video: 'PAL', controller: 'dragonfdc', controllerRom: false },
  run: { load: 'wyrmfire.bin', format: 'dragondos-bin', loadAddress: 0x0c00, exec: 0x0c00, levelDisk: { drive: 0, format: 'vdk', from: 'converter' } },
  levelFormat: { pack: 'HGR2', assets: 'HGA1' },
  toolchain: { cmoc: env.CMOC_VERSION, lwtools: env.LWTOOLS_VERSION },
  converter: { version: CONVERTER_VERSION, module: 'wyrmfire-convert.js', worker: 'worker.js' },
  files: {},
};
const sums = [];
for (const [name, f] of Object.entries(files)) {
  const bytes = new Uint8Array(f.bytes);
  fs.writeFileSync(path.join(out, name), bytes);
  const sha256 = sha256Hex(bytes);
  manifest.files[name] = { sha256, size: bytes.length, role: f.role, description: f.description };
  sums.push(`${sha256}  ${name}`);
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
sums.push(`${sha256Hex(new Uint8Array(fs.readFileSync(path.join(out, 'manifest.json'))))}  manifest.json`);
fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
// The engine's checksum on its own, in sha256sum format, for a single-file pin.
fs.writeFileSync(path.join(out, 'wyrmfire.bin.sha256'), `${manifest.files['wyrmfire.bin'].sha256}  wyrmfire.bin\n`);
console.log(JSON.stringify(manifest, null, 1));
