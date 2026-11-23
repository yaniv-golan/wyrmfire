// node tools/check-pins.mjs LEVEL.vdk : the converter's Freedoom release disk must match release/expected.json.
import fs from 'node:fs';
import { verifySha256 } from '../converter/wyrmfire-convert.js';
const expected = JSON.parse(fs.readFileSync(new URL('../release/expected.json', import.meta.url)));
const hash = verifySha256(new Uint8Array(fs.readFileSync(process.argv[2])), expected.sha256, process.argv[2]);
console.log(`${process.argv[2]} = ${hash} (Freedoom ${expected.freedoom} ${expected.map})`);
