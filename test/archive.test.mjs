// Archive input tests: zip (store/deflate), LHA (-lh0/1/5/6/7-, header levels
// 0-2), DEICE-style split self-extractors. No id Software data: synthetic
// inputs here, plus Freedoom-built fixtures from test/fixtures/make-archives.sh
// when ARCHIVE_FIXTURES points at them.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// WYRMFIRE_CONVERTER may point at another copy of the converter (used by
// test/mutation.test.mjs to run these tests against mutants).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const C = await import(process.env.WYRMFIRE_CONVERTER ? pathToFileURL(path.resolve(process.env.WYRMFIRE_CONVERTER)).href : '../converter/wyrmfire-convert.js');
const FIX = process.env.ARCHIVE_FIXTURES;
const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

// ------------------------------------------------------------ builders (independent encoders)

function zip(entries) { // [{ name, data, method }] ; method 0 store, 8 deflate (node zlib)
  const local = [], central = [];
  let off = 0;
  for (const e of entries) {
    const data = e.method === 8 ? zlib.deflateRawSync(e.data, { level: e.level ?? 6 }) : Buffer.from(e.data);
    const name = Buffer.from(e.name), crc = zlib.crc32 ? zlib.crc32(e.data) : C.crc32(e.data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(e.method, 8);
    h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(e.data.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.method, 10);
    c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(e.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, name, data); central.push(c, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return u8(Buffer.concat([...local, cd, end]));
}

function lhaLevel0(name, data, method = '-lh0-', packed = data) { // stored member, level-0 header
  const n = Buffer.from(name), h = Buffer.alloc(24 + n.length);
  h[0] = 22 + n.length; h.write(method, 2, 'latin1'); h.writeUInt32LE(packed.length, 7); h.writeUInt32LE(data.length, 11);
  h[19] = 0x20; h[20] = 0; h[21] = n.length; n.copy(h, 22); h.writeUInt16LE(C.crc16(data), 22 + n.length);
  let s = 0; for (let i = 2; i < h.length; i++) s += h[i]; h[1] = s & 255;
  return Buffer.concat([h, Buffer.from(packed)]);
}

const palette = () => Array.from({ length: 768 }, (_, i) => (i * 7) & 255);
function tinyWad() { // a PWAD with a palette: enough for openWad (not for convert)
  const pal = Buffer.from(palette()), dir = Buffer.alloc(16);
  dir.writeUInt32LE(12, 0); dir.writeUInt32LE(768, 4); dir.write('PLAYPAL', 8, 'latin1');
  const hdr = Buffer.alloc(12); hdr.write('PWAD', 0, 'latin1'); hdr.writeUInt32LE(1, 4); hdr.writeUInt32LE(12 + 768, 8);
  return u8(Buffer.concat([hdr, pal, dir]));
}

// ------------------------------------------------------------ inflate

test('inflateRaw matches zlib on random, repetitive, stored and fixed-Huffman data', () => {
  const inputs = [new Uint8Array(0), new Uint8Array(70000), u8(crypto.randomBytes(100000)),
    Uint8Array.from({ length: 200000 }, (_, i) => (i * i >> 7) & 255), u8(Buffer.from('hello hello hello hello'))];
  for (const raw of inputs) for (const level of [0, 1, 6, 9]) {
    const packed = u8(zlib.deflateRawSync(raw, { level }));
    assert.deepEqual(C.inflateRaw(packed, raw.length), raw, `level ${level}, ${raw.length} bytes`);
    assert.deepEqual(C.inflateRaw(packed), raw, 'without a size hint');
  }
  const fixed = u8(zlib.deflateRawSync(Buffer.from('abcabcabcabcabc'), { strategy: zlib.constants.Z_FIXED }));
  assert.equal(Buffer.from(C.inflateRaw(fixed)).toString(), 'abcabcabcabcabc');
  assert.throws(() => C.inflateRaw(new Uint8Array([0x07])), /bad deflate block type|ends early/);
});

test('crc16 (LHA) and crc32 (zip) match known values', () => {
  const b = Buffer.from('123456789');
  assert.equal(C.crc16(b), 0xbb3d);
  assert.equal(C.crc32(b), 0xcbf43926);
});

// ------------------------------------------------------------ zip

test('a zip with a stored or deflated DOOM1.WAD opens to the same bytes', async () => {
  const wad = tinyWad();
  for (const method of [0, 8]) {
    const z = zip([{ name: 'README.TXT', data: Buffer.from('x'), method }, { name: 'DOOM1.WAD', data: wad, method }]);
    const r = C.openWad(z);
    assert.deepEqual(r.bytes, wad); assert.equal(r.name, 'DOOM1.WAD'); assert.match(r.container, /^zip > wad$/);
    const a = await C.openWadAsync(z);
    assert.deepEqual(a.bytes, wad);
  }
});

test('zip errors name the problem', () => {
  assert.throws(() => C.openWad(zip([{ name: 'README.TXT', data: Buffer.from('no wad'), method: 8 }])), /^ArchiveError: This zip has no DOOM1\.WAD inside$/);
  const bad = zip([{ name: 'DOOM1.WAD', data: tinyWad(), method: 0 }]); bad[40] ^= 1;
  assert.throws(() => C.openWad(bad), /DOOM1\.WAD fails its CRC check/);
  const imploded = zip([{ name: 'DOOM1.WAD', data: tinyWad(), method: 0 }]);
  imploded[8] = 6; imploded[30 + 9 + 768 + 16 + 12 + 10] = 6; // local + central method field = implode
  assert.throws(() => C.openWad(imploded), /Unsupported zip method 6/);
});

// ------------------------------------------------------------ LHA (synthetic, always runs)

test('LHA level-0 -lh0- archive, alone and behind a stub, opens', () => {
  const wad = tinyWad(), arc = Buffer.concat([lhaLevel0('DOOM1.WAD', wad), Buffer.from([0])]);
  assert.deepEqual(C.openWad(u8(arc)).bytes, wad);
  const stub = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(28), Buffer.from('PKLITE Copr. 1990-'), crypto.randomBytes(5000)]);
  assert.deepEqual(C.openWad(u8(Buffer.concat([stub, arc]))).bytes, wad);
  assert.equal(C.findLha(u8(Buffer.concat([stub, arc]))), stub.length);
});

test('LHA errors name the problem', () => {
  const wad = tinyWad();
  const lh3 = Buffer.concat([lhaLevel0('DOOM1.WAD', wad, '-lh3-'), Buffer.from([0])]);
  assert.throws(() => C.openWad(u8(lh3)), /^ArchiveError: Unsupported LHA method -lh3-$/);
  const other = Buffer.concat([lhaLevel0('README.TXT', Buffer.from('hi')), Buffer.from([0])]);
  assert.throws(() => C.openWad(u8(other)), /has no DOOM1\.WAD inside/);
  const corrupt = Buffer.concat([lhaLevel0('DOOM1.WAD', wad), Buffer.from([0])]); corrupt[40] ^= 1;
  assert.throws(() => C.openWad(u8(corrupt)), /DOOM1\.WAD fails its CRC check/);
});

test('split self-extractor parts: joined in numeric order, missing parts named', () => {
  const wad = tinyWad(), stub = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(3000)]);
  const sfx = Buffer.concat([stub, lhaLevel0('DOOM1.WAD', wad), Buffer.from([0])]), cut = 3300;
  const p1 = { name: 'DOOMS_19.1', bytes: u8(sfx.subarray(0, cut)) }, p2 = { name: 'DOOMS_19.2', bytes: u8(sfx.subarray(cut)) };
  const dat = { name: 'DOOMS_19.DAT', bytes: u8(Buffer.from('control')) };
  assert.deepEqual(C.openWad([p2, dat, p1]).bytes, wad, 'given in any order');
  assert.throws(() => C.openWad([p1, dat]), /^ArchiveError: DOOMS_19\.2 is missing$/);
  assert.throws(() => C.openWad([p2]), /^ArchiveError: DOOMS_19\.1 is missing$/);
  const joined = C.joinParts({ base: 'DOOMS_19', parts: [{ n: 2, name: 'DOOMS_19.2', bytes: p2.bytes }, { n: 1, name: 'DOOMS_19.1', bytes: p1.bytes }] });
  assert.deepEqual(Buffer.from(joined.bytes), sfx);
});

test('a pinned SHA-256 is checked for bare and extracted WADs alike', () => {
  const wad = tinyWad(), good = C.sha256Hex(wad);
  const arc = u8(Buffer.concat([lhaLevel0('DOOM1.WAD', wad), Buffer.from([0])]));
  assert.equal(C.openWad(wad, { sha256: good }).sha256, good);
  assert.equal(C.openWad(arc, { sha256: good }).sha256, good);
  assert.throws(() => C.openWad(arc, { sha256: '0'.repeat(64) }), /DOOM1\.WAD: SHA-256 .* does not match/);
  assert.throws(() => C.openWad(wad, { sha256: '0'.repeat(64) }), /SHA-256 .* does not match/);
});

// ------------------------------------------------------------ Freedoom fixtures (jlha-encoded, lhasa-verified)

const fx = (f) => u8(fs.readFileSync(path.join(FIX, f)));
const skip = !FIX && 'set ARCHIVE_FIXTURES (test/fixtures/make-archives.sh)';

test('every fixture opens to the original Freedoom WAD', { skip }, () => {
  const want = C.sha256Hex(fx('src/DOOM1.WAD'));
  const cases = {
    'store.zip': 'zip > wad', 'deflate.zip': 'zip > wad',
    'lh0.lzh': '-lh0-', 'lh1.lzh': '-lh1-', 'lh5.lzh': '-lh5-', 'lh5-level0.lzh': '-lh5-', 'lh5-level2.lzh': '-lh5-',
    'lh6.lzh': '-lh6-', 'lh7.lzh': '-lh7-',
  };
  for (const [f, kind] of Object.entries(cases)) {
    const r = C.openWad([{ name: f, bytes: fx(f) }]);
    assert.equal(r.sha256, want, f); assert.ok(r.container.includes(kind), `${f}: ${r.container}`);
  }
});

test('DEICE-style split parts and the shareware-like zip open to the original WAD', { skip }, async () => {
  const want = C.sha256Hex(fx('src/DOOM1.WAD'));
  for (const m of ['lh5', 'lh1']) {
    const parts = ['DOOMS_19.2', 'DOOMS_19.1', 'DOOMS_19.DAT'].map((n) => ({ name: n, bytes: fx(`split-${m}/${n}`) }));
    assert.equal(C.openWad(parts).sha256, want, 'parts ' + m);
    assert.throws(() => C.openWad(parts.filter((p) => p.name !== 'DOOMS_19.2')), /^ArchiveError: DOOMS_19\.2 is missing$/);
    const r = await C.openWadAsync([{ name: `shareware-like-${m}.zip`, bytes: fx(`shareware-like-${m}.zip`) }]);
    assert.equal(r.sha256, want, 'zip ' + m);
    assert.match(r.container, new RegExp(`^zip > DOOMS_19\\.1\\+2 self-extractor \\(LHA -${m}-\\)$`));
  }
  assert.throws(() => C.openWad(fx('nowad.zip')), /^ArchiveError: This zip has no DOOM1\.WAD inside$/);
});

test('converting from the shareware-like zip gives the same disk as the bare WAD', { skip }, async () => {
  const bare = C.convert(fx('src/DOOM1.WAD'), { map: 'E1M1' });
  const z = await C.convertAsync([{ name: 'doom19s-like.zip', bytes: fx('shareware-like-lh5.zip') }], { map: 'E1M1', sha256: bare.info.source.sha256 });
  assert.deepEqual(z.disk, bare.disk);
  assert.equal(z.info.sha256, bare.info.sha256);
});

// ------------------------------------------------------------ PKZIP self-extractors (the shareware layout)

test('a zip behind a stub opens with archive-relative and file-relative offsets', () => {
  const wad = tinyWad(), inner = zip([{ name: 'DOOM1.WAD', data: wad, method: 8 }]);
  const stub = u8(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(28), Buffer.from('PKLITE Copr. 1990-'), crypto.randomBytes(2000)]));
  const archiveRelative = new Uint8Array(stub.length + inner.length); archiveRelative.set(stub); archiveRelative.set(inner, stub.length);
  // File-relative: shift the stored central-directory and local-header offsets by the stub size.
  const fileRelative = archiveRelative.slice(), dv = new DataView(fileRelative.buffer);
  const eocd = fileRelative.length - 22, cd = dv.getUint32(eocd + 16, true) + stub.length;
  dv.setUint32(eocd + 16, cd, true); dv.setUint32(cd + 42, dv.getUint32(cd + 42, true) + stub.length, true);
  for (const b of [archiveRelative, fileRelative]) assert.deepEqual(C.openWad(b).bytes, wad);
});

test('split PKZIP self-extractor parts: order, missing and swapped parts', () => {
  const wad = tinyWad(), inner = zip([{ name: 'DOOM1.WAD', data: wad, method: 8 }]);
  const sfx = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(4000), Buffer.from(inner)]), cut = 4002 + 60; // inside the zip data
  const p1 = { name: 'DOOMS_19.1', bytes: u8(sfx.subarray(0, cut)) }, p2 = { name: 'DOOMS_19.2', bytes: u8(sfx.subarray(cut)) };
  const r = C.openWad([p2, p1]);
  assert.deepEqual(r.bytes, wad); assert.match(r.container, /^DOOMS_19\.1\+2 self-extractor \(zip\) > wad$/);
  assert.throws(() => C.openWad([p1]), /^ArchiveError: DOOMS_19\.2 is missing$/);
  const swapped = [{ name: 'DOOMS_19.1', bytes: p2.bytes }, { name: 'DOOMS_19.2', bytes: p1.bytes }];
  assert.throws(() => C.openWad(swapped), /^ArchiveError: DOOMS_19\.1\+2 do not form an archive: a part is missing, damaged or out of order$/);
  const wrapped = zip([{ name: 'DEICE.EXE', data: Buffer.from('MZ..'), method: 0 }, { name: 'DOOMS_19.1', data: p1.bytes, method: 8 }, { name: 'DOOMS_19.2', data: p2.bytes, method: 8 }]);
  assert.deepEqual(C.openWad(wrapped).bytes, wad, 'doom19s.zip-like wrapper');
});

test('IWAD identification: MD5 and SHA-1 match node:crypto; unknown WADs are null', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const b = crypto.randomBytes(n);
    assert.equal(C.md5Hex(b), crypto.createHash('md5').update(b).digest('hex'));
    assert.equal(C.sha1Hex(b), crypto.createHash('sha1').update(b).digest('hex'));
  }
  assert.equal(C.openWad(tinyWad()).iwad, null);
  const shareware = C.KNOWN_IWADS.find((k) => k.md5 === 'f0cefca49926d00903cf57551d901abe');
  assert.equal(shareware.name, 'DOOM1.WAD'); assert.equal(shareware.size, 4196020);
});

test('Freedoom-built PKZIP self-extractors (both offset conventions) open to the WAD', { skip }, async () => {
  const want = C.sha256Hex(fx('src/DOOM1.WAD'));
  for (const kind of ['archive', 'file']) {
    assert.equal(C.openWad([{ name: `sfx-${kind}.exe`, bytes: fx(`sfx-${kind}.exe`) }]).sha256, want, 'joined exe ' + kind);
    const parts = ['DOOMS_19.2', 'DOOMS_19.1', 'DOOMS_19.DAT'].map((n) => ({ name: n, bytes: fx(`zipsplit-${kind}/${n}`) }));
    const r = C.openWad(parts);
    assert.equal(r.sha256, want, 'parts ' + kind);
    assert.deepEqual(r.iwad, { name: 'freedoom1.wad', release: 'Freedoom Phase 1 0.13.0' });
    assert.throws(() => C.openWad(parts.filter((p) => p.name !== 'DOOMS_19.2')), /^ArchiveError: DOOMS_19\.2 is missing$/);
    const swapped = [{ name: 'DOOMS_19.1', bytes: parts[0].bytes }, { name: 'DOOMS_19.2', bytes: parts[1].bytes }];
    assert.throws(() => C.openWad(swapped), /do not form an archive: a part is missing, damaged or out of order/);
    const z = await C.openWadAsync([{ name: 'doom19s.zip', bytes: fx(`shareware-like-zip-${kind}.zip`) }]);
    assert.equal(z.sha256, want, 'doom19s-like zip ' + kind);
    assert.equal(z.container, 'zip > DOOMS_19.1+2 self-extractor (zip) > wad');
  }
});
