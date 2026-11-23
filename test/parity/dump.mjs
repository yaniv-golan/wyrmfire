// JS twin of dump.py: node test/parity/dump.mjs WAD [MAP...] > js.json
import fs from 'node:fs';
import * as C from '../../converter/wyrmfire-convert.js';

const h = (b) => C.sha256Hex(b instanceof Uint8Array ? b : Uint8Array.from(b));
const enc = (s) => new TextEncoder().encode(s);
// Python json.dumps of a list of int tuples: "[[1, 2], [3, 4]]"
const pyJson = (recs) => '[' + recs.map((r) => '[' + r.join(', ') + ']').join(', ') + ']';
const concat = (arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0), o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };

const [wadPath, ...names] = process.argv.slice(2);
const wadBytes = new Uint8Array(fs.readFileSync(wadPath));
const wad = new C.Wad(wadBytes);
const out = {};
for (const name of names.length ? names : wad.maps()) {
  const r = {};
  const real = C.LIMITS.gridBytes;
  try {
    C.LIMITS.gridBytes = 1e9;
    const lumps = wad.level(name);
    const m = C.buildMap(lumps);
    r.grid = h(m.grid); r.objects = m.objects; r.spawn = [m.seed, m.angle, m.ox, m.oy];
    const { records, floors } = C.prepareGeometry(lumps, m.ox, m.oy, m.grid);
    r.records = h(enc(pyJson(records))); r.floors = h(floors);
    const a = C.buildAtlas(records, m.grid, floors);
    r.zones = h(concat(a.zones.map((z) => z.packed))); r.payloads = h(concat(a.zones.map((z) => z.payload)));
    r.groups = [...a.groups.entries()];
  } catch (e) {
    r.stageError = e.message;
  } finally {
    C.LIMITS.gridBytes = real;
  }
  try {
    const { disk, info } = C.convert(wadBytes, { map: name });
    // info.source (container name, WAD hash) is JS-only metadata: compare the hash.
    r.disk = h(disk); r.wadSha256 = info.source.sha256; delete info.source; r.info = info;
  } catch (e) {
    r.error = e.message;
  }
  out[name] = r;
  process.stderr.write(`${name} ${r.disk || r.error}\n`);
}
try { out._assets = h(C.buildAssets(wad).assets); } catch (e) { out._assets = 'error: ' + e.message; }
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
process.stdout.write(JSON.stringify(sortKeys(out)) + '\n');
