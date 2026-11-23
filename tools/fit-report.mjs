// HGR2 fit report for maps of a Doom-format IWAD.
// SPDX-License-Identifier: GPL-3.0-or-later
//   node tools/fit-report.mjs WAD [MAP...] [--json]
// Converts each map with every HGR2 limit lifted, then lists which limits it
// would exceed and its region (cluster) sizes.
import fs from 'node:fs';
import * as C from '../converter/wyrmfire-convert.js';


const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function fit(wadBytes, map) {
  const saved = { ...C.LIMITS };
  for (const k of Object.keys(C.LIMITS)) C.LIMITS[k] = 1e9;
  try {
    const wad = new C.Wad(wadBytes), lumps = wad.level(map);
    const m = C.buildMap(lumps);
    const g = C.prepareGeometry(lumps, m.ox, m.oy, m.grid);
    const a = C.buildAtlas(g.records, m.grid, g.floors);
    const sectors = a.zones.map((z) => Math.ceil(z.packed.length / 256));
    const L = saved, over = [];
    const check = (what, value, limit) => { if (value > limit) over.push(`${what}: ${value} > ${limit}`); };
    const rows = [];
    m.grid.forEach((c, i) => { if (c) rows.push(Math.floor(i / 128)); });
    const usedRows = Math.max(...rows) - Math.min(...rows) + 3;
    check('grid rows', usedRows, L.gridBytes / 128);
    check('grid width', m.width, L.gridWidth);
    check('objects', m.objects.length / 3, L.objects);
    check('door groups', a.groups.size ? Math.max(...a.groups.values()) : 0, L.doorGroups);
    check('door cells', a.groups.size, L.doorCells);
    check('regions', a.zones.length, L.regions);
    const notInPlace = a.zones.filter((z, i) => !C.inPlaceOk(z.packed, sectors[i], z.payload.length, L.regionWindow)).length;
    check('regions that cannot unpack in place', notInPlace, 0);
    const placed = C.placeRegions(sectors);
    check('last disk sector', placed.end, L.diskSectors);
    const headerBytes = 32 + 3 * a.groups.size + a.zoneIndex.length + 7 * a.zones.length + C.lzEncode(m.grid).length + Math.max(1, m.objects.length);
    check('header bytes', headerBytes, L.headerBytes);
    const levelSectors = L.headerBytes / 256 + sectors.reduce((t, x) => t + x, 0);
    return {
      map, cells: m.cells, gridWidth: m.width, gridRows: usedRows, objects: m.objects.length / 3, walls: g.records.length,
      regions: a.zones.length, regionCells: { min: Math.min(...a.zones.map((z) => z.cells)), median: median(a.zones.map((z) => z.cells)), max: Math.max(...a.zones.map((z) => z.cells)) },
      regionSectors: { min: Math.min(...sectors), median: median(sectors), mean: +(sectors.reduce((s, x) => s + x, 0) / sectors.length).toFixed(1), max: Math.max(...sectors), total: sectors.reduce((s, x) => s + x, 0) },
      levelSectors,
      lastSector: placed.end, headerBytes,
      exceeds: over,
    };
  } finally {
    Object.assign(C.LIMITS, saved);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), json = args.includes('--json'), pos = args.filter((a) => a !== '--json');
  const bytes = new Uint8Array(fs.readFileSync(pos[0]));
  const maps = pos.slice(1).length ? pos.slice(1) : new C.Wad(bytes).maps();
  const out = [];
  for (const map of maps) {
    try { out.push(fit(bytes, map)); } catch (e) { out.push({ map, error: e.message }); }
  }
  if (json) console.log(JSON.stringify({ maps: out }, null, 1));
  else {
    for (const r of out) {
      if (r.error) { console.log(`${r.map}: ${r.error}`); continue; }
      console.log(`${r.map}: ${r.cells} cells, ${r.gridWidth}x${r.gridRows} grid, ${r.objects} objects, ${r.regions} regions ` +
        `(cells/region ${r.regionCells.min}-${r.regionCells.median}-${r.regionCells.max}; sectors ${r.regionSectors.min}-${r.regionSectors.median}-${r.regionSectors.max}, mean ${r.regionSectors.mean}, total ${r.regionSectors.total}), ` +
        `level ${r.levelSectors} sectors (last sector ${r.lastSector}), header ${r.headerBytes} bytes; ` +
        (r.exceeds.length ? 'EXCEEDS ' + r.exceeds.join('; ') : 'fits HGR2'));
    }
  }
}
