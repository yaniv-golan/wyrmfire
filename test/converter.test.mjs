// Converter unit tests. Synthetic inputs only, plus optional Freedoom checks
// (set FREEDOOM1=/path/to/freedoom1.wad). No id Software data is used.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as C from '../converter/wyrmfire-convert.js';

// ------------------------------------------------------------ synthetic WAD

const le16 = (v) => [v & 255, (v >> 8) & 255];
const le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const name8 = (s) => Array.from({ length: 8 }, (_, i) => (i < s.length ? s.charCodeAt(i) : 0));

function makeWad(lumps, magic = 'IWAD') {
  const body = [], dir = [];
  let pos = 12;
  for (const [name, data] of lumps) {
    dir.push(...le32(pos), ...le32(data.length), ...name8(name));
    body.push(...data); pos += data.length;
  }
  return Uint8Array.from([...magic.split('').map((c) => c.charCodeAt(0)), ...le32(lumps.length), ...le32(pos), ...body, ...dir]);
}

const palette = () => Array.from({ length: 768 }, (_, i) => (i * 7) & 255);

// A 256x256 square room: one sector, one BSP node, a player start and an imp.
function roomLumps() {
  const v = [[0, 0], [0, 256], [256, 256], [256, 0]];
  const lines = [[0, 1], [1, 2], [2, 3], [3, 0]];
  return [
    ['MAP01', []],
    ['THINGS', [[128, 128, 90, 1, 7], [64, 64, 0, 3001, 7]].flatMap((t) => t.flatMap(le16))],
    ['LINEDEFS', lines.flatMap(([a, b]) => [a, b, 1, 0, 0, 0, 65535].flatMap(le16))],
    ['SIDEDEFS', lines.flatMap(() => [...le16(0), ...le16(0), ...name8('-'), ...name8('-'), ...name8('STARTAN3'), ...le16(0)])],
    ['VERTEXES', v.flatMap(([x, y]) => [...le16(x), ...le16(y)])],
    ['SEGS', lines.flatMap(([a, b], i) => [a, b, 0, i, 0, 0].flatMap(le16))],
    ['SSECTORS', [...le16(4), ...le16(0)]],
    ['NODES', [128, 0, 0, 256, 0, 0, 0, 0, 0, 0, 0, 0, 0x8000, 0x8000].flatMap(le16)],
    ['SECTORS', [...le16(0), ...le16(128), ...name8('FLOOR'), ...name8('CEIL'), ...le16(160), ...le16(0), ...le16(0)]],
    ['REJECT', []],
    ['BLOCKMAP', []],
  ];
}

const roomWad = () => makeWad([['PLAYPAL', palette()], ...roomLumps()]);

// ------------------------------------------------------------ WAD parsing errors

test('WAD parsing rejects malformed files', () => {
  assert.throws(() => new C.Wad(new Uint8Array(4)), /shorter than its 12-byte header/);
  assert.throws(() => C.convert(new Uint8Array(4)), /nothing to convert/);
  assert.throws(() => new C.Wad(makeWad([], 'XWAD')), /bad magic/);
  const ok = makeWad([['PLAYPAL', palette()]]);
  const badDir = ok.slice(); badDir.set(le32(ok.length), 8);
  assert.throws(() => new C.Wad(badDir), /directory runs past end/);
  const badLump = ok.slice(); badLump.set(le32(ok.length * 4), ok.length - 12);
  assert.throws(() => new C.Wad(badLump), /lump runs past end/);
  assert.throws(() => new C.Wad(makeWad([['THINGS', []]])), /no PLAYPAL/);
  assert.throws(() => new C.Wad(makeWad([['PLAYPAL', palette().slice(0, 100)]])), /no PLAYPAL/);
  assert.throws(() => C.convert(roomWad(), { map: 'E9M9' }), /no map E9M9/);
  const noVerts = makeWad([['PLAYPAL', palette()], ...roomLumps().filter(([n]) => n !== 'VERTEXES')]);
  assert.throws(() => new C.Wad(noVerts).level('MAP01'), /no VERTEXES lump/);
  assert.throws(() => new C.Wad(roomWad()).patch('POSSA1'), /no lump POSSA1/);
  const oddLines = makeWad([['PLAYPAL', palette()], ...roomLumps().map(([n, d]) => [n, n === 'LINEDEFS' ? d.concat([0]) : d])]);
  assert.throws(() => C.buildMap(new C.Wad(oddLines).level('MAP01')), /multiple of 14/);
  const noStart = makeWad([['PLAYPAL', palette()], ...roomLumps().map(([n, d]) => [n, n === 'THINGS' ? d.slice(10) : d])]);
  assert.throws(() => C.buildMap(new C.Wad(noStart).level('MAP01')), /no player 1 start/);
});

test('WAD lump names stop at the first NUL and the last duplicate wins', () => {
  const w = new C.Wad(makeWad([['PLAYPAL', palette()], ['FOO', [1]], ['FOO', [2]]]));
  assert.deepEqual([...w.lump('FOO')], [2]);
  assert.deepEqual(w.maps(), []);
  assert.deepEqual(new C.Wad(roomWad()).maps(), ['MAP01']);
  assert.equal(w.gray.length, 256);
});

test('a converter error is a WadError or LimitError with a message', () => {
  try { C.convert(roomWad(), { map: 'MAP01' }); assert.fail('expected failure: the room WAD has no sprites'); } catch (e) {
    assert.ok(e instanceof C.WadError, e.name);
    assert.match(e.message, /no lump POSSA1/);
  }
});

// ------------------------------------------------------------ hash helpers

test('sha256Hex matches known vectors and node:crypto', () => {
  assert.equal(C.sha256Hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(C.sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (let n = 0; n < 300; n += 7) {
    const b = crypto.randomBytes(n);
    assert.equal(C.sha256Hex(b), crypto.createHash('sha256').update(b).digest('hex'), 'length ' + n);
  }
});

test('verifySha256 accepts matches, rejects mismatches and malformed pins', () => {
  const b = new TextEncoder().encode('abc');
  const good = 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD';
  assert.equal(C.verifySha256(b, good), good.toLowerCase());
  assert.throws(() => C.verifySha256(b, '0'.repeat(64), 'abc.bin'), /abc\.bin: SHA-256 ba78.* does not match 0{64}/);
  assert.throws(() => C.verifySha256(b, 'xyz'), /invalid SHA-256/);
  assert.throws(() => C.verifySha256(b, undefined), /invalid SHA-256/);
});

// ------------------------------------------------------------ LZ, rounding

test('LZ round trip', () => {
  const cases = [new Uint8Array(0), new Uint8Array(1000), Uint8Array.from({ length: 5000 }, (_, i) => (i * i) % 7), new Uint8Array(crypto.randomBytes(3000))];
  for (const raw of cases) assert.deepEqual(C.lzDecode(C.lzEncode(raw), raw.length), raw);
});

test('roundHalfEven matches Python round()', () => {
  assert.deepEqual([0.5, 1.5, 2.5, -0.5, -1.5, 2.4999, 2.5001, -2.6].map(C.roundHalfEven), [0, 2, 2, -0, -2, 2, 3, -3].map((x) => x + 0));
});

// ------------------------------------------------------------ level pack round trip

test('HGR2 level pack round trip on a synthetic room', () => {
  const lumps = new C.Wad(roomWad()).level('MAP01');
  const m = C.buildMap(lumps);
  assert.equal(m.cells, 9);
  assert.deepEqual(m.objects, [2, 2, 3]);
  const g = C.prepareGeometry(lumps, m.ox, m.oy, m.grid);
  assert.equal(g.records.length, 4);
  const atlas = C.buildAtlas(g.records, m.grid, g.floors);
  const lv = C.packLevel(m, atlas);
  const vdk = C.buildVdk([['WYRMFIRE', 'LVL', lv.extents]]);
  const h = C.parseLevel(vdk);
  assert.equal(h.firstSector, C.DATA_SECTOR);
  assert.deepEqual(h.diskSector, lv.start);
  assert.equal(h.gridSize, m.grid.length);
  assert.deepEqual([...h.grid], [...m.grid]);
  assert.deepEqual(h.spawn, [m.seed % 128, Math.floor(m.seed / 128), m.angle]);
  assert.equal(m.angle, 8); // 90 degrees = 8/32 of a turn
  assert.deepEqual(h.objects, m.objects);
  assert.equal(h.regionCount, atlas.zones.length);
  assert.deepEqual(h.rawSize, atlas.zones.map((z) => z.payload.length));
  atlas.zones.forEach((z, i) => assert.deepEqual(C.lzDecode(h.regions[i], h.rawSize[i]), z.payload));
  assert.deepEqual(h.zoneIndex, [...atlas.zoneIndex]);
  assert.deepEqual(C.readVdk(vdk)['WYRMFIRE.LVL'].length, lv.extents.reduce((t, e) => t + e[1].length, 0));
  // Corrupting a region is caught by its checksum.
  const bad = vdk.slice(); bad[12 + 256 * lv.start[0]] ^= 1;
  assert.throws(() => C.parseLevel(bad), /checksum mismatch/);
});

test('HGR2 limits are enforced, not silently truncated', () => {
  const lumps = new C.Wad(roomWad()).level('MAP01');
  const m = C.buildMap(lumps);
  const g = C.prepareGeometry(lumps, m.ox, m.oy, m.grid);
  const atlas = C.buildAtlas(g.records, m.grid, g.floors);
  const many = { ...m, objects: Array(65 * 3).fill(1) };
  assert.throws(() => C.packLevel(many, atlas), (e) => e instanceof C.LimitError && /65 objects; HGR2 allows 64/.test(e.message));
  const tooBig = { ...atlas, zones: [{ zone: [0, 0], cells: 16, payload: new Uint8Array(0x3201), packed: new Uint8Array(51 * 256) }] };
  assert.throws(() => C.packLevel(m, tooBig), /cannot unpack in place/);
});

test('in-place unpack rule and region placement', () => {
  const raw = new Uint8Array(12000);
  const packed = C.lzEncode(raw);
  assert.ok(C.inPlaceOk(packed, Math.ceil(packed.length / 256), raw.length));
  // A long compressible run before incompressible data overtakes the unread input.
  const mixed = new Uint8Array(0x3200); mixed.set(crypto.randomBytes(6800), 6000);
  const mp = C.lzEncode(mixed);
  assert.equal(C.inPlaceOk(mp, Math.ceil(mp.length / 256), mixed.length), false);
  // Regions skip the directory tracks (576-593, 720-737) and never span them.
  const { start, end } = C.placeRegions([500, 40, 120, 10]);
  assert.deepEqual(start, [42, 594, 738, 858]);
  assert.equal(end, 868);
});

test('VDK holds the level and asset files at their fixed sectors', () => {
  const lvl = Uint8Array.from({ length: 4 * 256 }, (_, i) => i & 255), dat = Uint8Array.from({ length: 999 }, (_, i) => (i * 3) & 255);
  const tail = Uint8Array.from({ length: 300 * 256 }, (_, i) => (i * 7) & 255);
  const vdk = C.buildVdk([['WYRMFIRE', 'DAT', [[C.ASSET_SECTOR, dat]]], ['WYRMFIRE', 'LVL', [[C.HEADER_SECTOR, lvl], [738, tail]]]]);
  assert.equal(vdk.length, 12 + 80 * 36 * 256);
  const files = C.readVdk(vdk);
  assert.deepEqual(Object.keys(files), ['WYRMFIRE.DAT', 'WYRMFIRE.LVL']);
  const whole = new Uint8Array(4 * 256 + tail.length); whole.set(lvl); whole.set(tail, 4 * 256);
  assert.deepEqual(files['WYRMFIRE.LVL'], whole.subarray(0, 4 * 256 + tail.length));
  assert.deepEqual(files['WYRMFIRE.DAT'], dat);
  assert.deepEqual(vdk.subarray(12 + 256 * C.HEADER_SECTOR, 12 + 256 * C.HEADER_SECTOR + 10), lvl.subarray(0, 10));
  assert.throws(() => C.buildVdk([['X', 'BIN', [[16 * 36, dat]]]]), /does not fit/);
});

test('MIDI and MUS music reduce to the same melody format', () => {
  // MUS: score at 16; ch1 note on 60 (with release delay 50), ch1 note off 60 (delay 10), end.
  const mus = Uint8Array.from([0x4d, 0x55, 0x53, 0x1a, 9, 0, 16, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x91, 60, 50, 0x81, 60, 10, 0x60]);
  assert.deepEqual(C.melody(mus, 1, 320), [C.PHASE[60] >> 8, C.PHASE[60] & 255, 50, 0, 0, 10, 0, 0, 0]);
  // The same tune as a format-0 MIDI file: 140 ticks per quarter at 1 s per quarter = 1/140 s per tick.
  const trk = [0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40, 0, 0x91, 60, 100, 50, 0x81, 60, 0, 10, 0xff, 0x2f, 0];
  const mid = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 140, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, trk.length, ...trk]);
  const m = C.melody(mid, 1, 320);
  assert.deepEqual(m.slice(0, 6), [C.PHASE[60] >> 8, C.PHASE[60] & 255, 50, 0, 0, 100]);
  assert.deepEqual(m.slice(-3), [0, 0, 0]);
});

test('the Web Worker wrapper reports errors as messages', async () => {
  const sent = [];
  globalThis.self = { postMessage: (m) => sent.push(m) };
  await import('../converter/worker.js');
  await self.onmessage({ data: { id: 7, wad: new Uint8Array(3).buffer, map: 'E1M1' } });
  await self.onmessage({ data: { id: 8, wad: roomWad().buffer, list: true } });
  assert.equal(sent[0].ok, false); assert.equal(sent[0].kind, 'ArchiveError'); assert.match(sent[0].error, /nothing to convert/);
  assert.deepEqual(sent[1].maps, ['MAP01']); assert.equal(sent[1].source.container, 'wad');
  delete globalThis.self;
});

// ------------------------------------------------------------ Freedoom (optional)

const FREEDOOM1 = process.env.FREEDOOM1;
const freedoom = () => new Uint8Array(fs.readFileSync(FREEDOOM1));

test('Freedoom E1M3 exceeds HGR2 and says which limit', { skip: !FREEDOOM1 && 'set FREEDOOM1' }, () => {
  assert.throws(() => C.convert(freedoom(), { map: 'E1M3' }), (e) => e instanceof C.LimitError && /151 objects; HGR2 allows 64/.test(e.message));
});

test('Freedoom E1M1 converts deterministically and round-trips', { skip: !FREEDOOM1 && 'set FREEDOOM1' }, () => {
  const wad = freedoom();
  const a = C.convert(wad, { map: 'e1m1' }), b = C.convert(wad.slice(), { map: 'E1M1' });
  assert.deepEqual(a.disk, b.disk);
  assert.equal(a.info.sha256, C.sha256Hex(a.disk));
  const files = C.readVdk(a.disk);
  assert.equal(files['WYRMFIRE.LVL'].length, a.info.levelBytes);
  const h = C.parseLevel(a.disk);
  assert.equal(h.objectCount, 51);
  assert.ok(h.diskSector.every((s, i) => s + h.diskCount[i] <= 576 || s >= 594 && (s + h.diskCount[i] <= 720 || s >= 738)));
  assert.equal(h.regionCount, a.info.regions);
  const assets = C.parseAssets(files['WYRMFIRE.DAT']);
  assert.equal(assets.guard.length, 96);
  assert.equal(assets.shotgun.length, 360);
  assert.ok(assets.snd_fire.length > 0 && assets.introNotes.length % 3 === 0);
});
