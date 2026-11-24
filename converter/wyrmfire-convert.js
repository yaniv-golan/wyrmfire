// WYRMFIRE level converter: Doom-format IWAD map -> Dragon 64 level disk (VDK).
//
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Plain ES module with no dependencies; runs in browsers, Web Workers and
// Node. Every step mirrors the Python reference in tools/reference/ and
// must stay byte-identical to it (test/parity.test.mjs). Only IEEE-754 +, -,
// *, / and sqrt are used on non-integers, so results do not depend on the
// platform's libm.
//
//   import { convert } from './wyrmfire-convert.js';
//   const { disk, info } = convert(wadBytes, { map: 'E1M1' });

export const VERSION = '1.0.0';

// ---------------------------------------------------------------- helpers

export class WadError extends Error { constructor(m) { super(m); this.name = 'WadError'; } }
export class LimitError extends Error { constructor(m) { super(m); this.name = 'LimitError'; } }

const floorDiv = (a, b) => Math.floor(a / b);
const pyMod = (a, b) => ((a % b) + b) % b;
// Python round() / numpy.rint: round half to even.
export function roundHalfEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
const clip = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

class Reader {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  need(off, n) { if (off < 0 || off + n > this.b.length) throw new WadError('read past end of lump'); }
  u8(o) { this.need(o, 1); return this.b[o]; }
  u16(o) { this.need(o, 2); return this.v.getUint16(o, true); }
  i16(o) { this.need(o, 2); return this.v.getInt16(o, true); }
  u32(o) { this.need(o, 4); return this.v.getUint32(o, true); }
}

// struct.iter_unpack: records of `size` bytes; the lump must be a whole number of them.
function records(lump, size, fn) {
  if (lump.length % size) throw new WadError('lump size is not a multiple of ' + size);
  const r = new Reader(lump), out = [];
  for (let o = 0; o < lump.length; o += size) out.push(fn(r, o));
  return out;
}

const latin1 = (bytes) => String.fromCharCode(...bytes);
const startsWithAny = (bytes, prefixes) => prefixes.some((p) => p.split('').every((c, i) => bytes[i] === c.charCodeAt(0)));

// ---------------------------------------------------------------- SHA-256

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

/** SHA-256 of a byte array, as lowercase hex. Synchronous, no dependencies. */
export function sha256Hex(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = bytes.length, total = Math.ceil((n + 9) / 64) * 64, m = new Uint8Array(total);
  m.set(bytes); m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(n / 0x20000000)); dv.setUint32(total - 4, (n * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + 4 * i);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** Throw unless `bytes` hashes to `expected` (64 hex digits, case-insensitive). */
export function verifySha256(bytes, expected, label = 'file') {
  if (typeof expected !== 'string' || !/^[0-9a-fA-F]{64}$/.test(expected)) throw new Error('invalid SHA-256 for ' + label);
  const actual = sha256Hex(bytes);
  if (actual !== expected.toLowerCase()) throw new Error(`${label}: SHA-256 ${actual} does not match ${expected.toLowerCase()}`);
  return actual;
}

// ---------------------------------------------------------------- WAD

export const MAP_LUMPS = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP'];

export class Wad {
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    this.data = bytes;
    if (bytes.length < 12) throw new WadError('WAD shorter than its 12-byte header');
    const r = new Reader(bytes), magic = latin1(bytes.subarray(0, 4));
    const n = r.u32(4), offset = r.u32(8);
    if (magic !== 'IWAD' && magic !== 'PWAD') throw new WadError('not a WAD (bad magic)');
    if (offset + 16 * n > bytes.length) throw new WadError('WAD directory runs past end of file');
    this.lumps = [];
    for (let i = 0; i < n; i++) {
      const o = offset + 16 * i, pos = r.u32(o), size = r.u32(o + 4);
      if (pos + size > bytes.length) throw new WadError('lump runs past end of file');
      const raw = bytes.subarray(o + 8, o + 16), z = raw.indexOf(0);
      this.lumps.push([latin1(z < 0 ? raw : raw.subarray(0, z)).toUpperCase(), bytes.subarray(pos, pos + size)]);
    }
    this.byName = new Map();
    for (const [name, lump] of this.lumps) this.byName.set(name, lump);
    const pal = this.byName.get('PLAYPAL');
    if (!pal || pal.length < 768) throw new WadError('WAD has no PLAYPAL palette');
    this.gray = [];
    for (let i = 0; i < 256; i++) this.gray.push(Math.floor((54 * pal[3 * i] + 183 * pal[3 * i + 1] + 19 * pal[3 * i + 2]) / 256));
  }
  lump(name) {
    if (!this.byName.has(name)) throw new WadError('WAD has no lump ' + name);
    return this.byName.get(name);
  }
  maps() {
    const out = [];
    for (let i = 0; i + 1 < this.lumps.length; i++) if (this.lumps[i + 1][0] === 'THINGS') out.push(this.lumps[i][0]);
    return out;
  }
  level(name) {
    name = String(name).toUpperCase();
    const start = this.lumps.findIndex(([key]) => key === name);
    if (start < 0) throw new WadError('WAD has no map ' + name);
    const lumps = {};
    for (const [k, v] of this.lumps.slice(start + 1, start + 11)) lumps[k] = v;
    for (const key of MAP_LUMPS.slice(0, 8)) if (!(key in lumps)) throw new WadError(`map ${name} has no ${key} lump`);
    return lumps;
  }
  patch(name) {
    const data = this.lump(name.toUpperCase()), r = new Reader(data);
    const w = r.i16(0), h = r.i16(2);
    if (w < 0 || h < 0) throw new WadError('bad patch size in ' + name);
    const pixels = Array.from({ length: h }, () => new Array(w).fill(-1));
    for (let x = 0; x < w; x++) {
      let p = r.u32(8 + 4 * x);
      while (r.u8(p) !== 255) {
        const y = r.u8(p), n = r.u8(p + 1);
        const end = Math.min(p + 3 + n, data.length);
        for (let q = p + 3, dy = 0; q < end; q++, dy++) if (y + dy < h) pixels[y + dy][x] = this.gray[data[q]];
        p += 4 + n;
      }
    }
    return pixels;
  }
}

// ---------------------------------------------------------------- LZ

/** Tiny LZ used for regions, the map grid and the engine image (tools/reference/lz.py). */
export function lzEncode(raw, window = null) {
  const seen = new Map(), stream = [], buf = [];
  const key = (i) => {
    const n = Math.min(3, raw.length - i);
    let k = n;
    for (let t = 0; t < n; t++) k = k * 256 + raw[i + t];
    return k;
  };
  const flush = () => { if (buf.length) { stream.push(buf.length - 1, ...buf); buf.length = 0; } };
  let i = 0;
  while (i < raw.length) {
    let best = 0, distance = 0;
    const cands = seen.get(key(i));
    if (cands) {
      for (let c = cands.length - 1; c >= 0; c--) {
        const j = cands[c];
        if (window !== null && i - j > window) break;
        let n = 0;
        while (n < 130 && i + n < raw.length && raw[i + n] === raw[j + n]) n++;
        if (n > best) { best = n; distance = i - j; }
      }
    }
    let step;
    if (best >= 4) {
      flush(); const d = (-distance) & 0xffff;
      stream.push(128 | (best - 3), d >> 8, d & 255); step = best;
    } else {
      buf.push(raw[i]); step = 1;
      if (buf.length === 128) flush();
    }
    for (let j = i; j < i + step; j++) {
      const k = key(j); let q = seen.get(k);
      if (!q) seen.set(k, (q = []));
      q.push(j); if (q.length > 32) q.shift();
    }
    i += step;
  }
  flush();
  return Uint8Array.from(stream);
}

export function lzDecode(stream, size) {
  const out = new Uint8Array(size); let i = 0, o = 0;
  while (o < size) {
    const c = stream[i++];
    if (c === undefined) throw new Error('LZ stream ends early');
    if (c & 128) {
      const d = ((stream[i] << 8) | stream[i + 1]) << 16 >> 16; i += 2;
      for (let n = (c & 127) + 3; n > 0 && o < size; n--, o++) out[o] = out[o + d];
    } else {
      for (let n = c + 1; n > 0 && o < size; n--) out[o++] = stream[i++];
    }
  }
  return out;
}

// ---------------------------------------------------------------- music

export const PHASE = [67, 71, 75, 80, 84, 89, 95, 100, 106, 113, 119, 126, 134, 142, 150, 159, 169, 179, 189, 201, 213, 225, 239, 253, 268, 284, 301, 319, 338, 358, 379, 401, 425, 451, 477, 506, 536, 568, 601, 637, 675, 715, 758, 803, 851, 901, 955, 1011, 1072, 1135, 1203, 1274, 1350, 1430, 1515, 1606, 1701, 1802, 1909, 2023, 2143, 2271, 2406, 2549, 2700, 2861, 3031, 3211, 3402, 3604, 3819, 4046, 4286, 4541, 4811, 5098, 5401, 5722, 6062, 6422, 6804, 7209, 7638, 8092, 8573, 9083, 9623, 10195, 10801, 11444, 12124, 12845, 13609, 14418, 15275, 16184, 17146, 18165, 19246, 20390, 21602, 22887, 24248, 25690, 27217, 28836, 30551, 32367, 34292, 36331, 38491, 40780, 43205, 45774, 48496, 51380, 54435, 57672, 61101, 64734, 68584, 72662, 76982, 81560, 86410, 91548, 96992, 102759];

const byteAt = (data, p) => { if (p >= data.length) throw new WadError('music lump ends early'); return data[p]; };

function musSteps(data, ticks) {
  if (latin1(data.subarray(0, 4)) !== 'MUS\x1a') throw new WadError('not a MUS lump');
  let pos = new Reader(data).u16(6), time = 0;
  const steps = [];
  while (time < ticks) {
    const b = byteAt(data, pos++), kind = (b >> 4) & 7, ch = b & 15;
    if (kind === 6) break;
    if (kind === 0 || kind === 1) {
      const n = byteAt(data, pos++);
      if (kind === 1 && n & 128) pos++;
      steps.push([ch, kind === 1, n & 127]);
    } else if (kind === 2 || kind === 3) pos++;
    else if (kind === 4) pos += 2;
    if (b & 128) {
      let delay = 0;
      for (;;) { const v = byteAt(data, pos++); delay = delay * 128 + (v & 127); if (v < 128) break; }
      delay = Math.min(delay, ticks - time); time += delay;
      steps.push(delay);
    }
  }
  return steps;
}

function varlen(data, pos) {
  let value = 0;
  for (;;) { const v = byteAt(data, pos++); value = value * 128 + (v & 127); if (v < 128) return [value, pos]; }
}

function midiSteps(data, ticks) {
  if (latin1(data.subarray(0, 4)) !== 'MThd') throw new WadError('not a MIDI lump');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 14) throw new WadError('music lump ends early');
  const hlen = dv.getUint32(4), ntrk = dv.getUint16(10), division = dv.getUint16(12);
  if (division & 0x8000) throw new WadError('SMPTE MIDI timing is not supported');
  let pos = 8 + hlen;
  const raw = [];
  for (let track = 0; track < ntrk; track++) {
    if (pos + 8 > data.length || latin1(data.subarray(pos, pos + 4)) !== 'MTrk') throw new WadError('bad MIDI track header');
    const length = dv.getUint32(pos + 4);
    let p = pos + 8, tick = 0, status = 0, seq = 0;
    const end = p + length;
    if (end > data.length) throw new WadError('truncated MIDI track');
    while (p < end) {
      let delta; [delta, p] = varlen(data, p); tick += delta;
      const b = byteAt(data, p);
      if (b & 128) { status = b; p++; } else if (!status) throw new WadError('MIDI running status without status');
      if (status === 0xff) {
        const kind = byteAt(data, p); let n; [n, p] = varlen(data, p + 1);
        if (kind === 0x51 && n === 3) raw.push([tick, track, seq, 'tempo', (byteAt(data, p) << 16) | (byteAt(data, p + 1) << 8) | byteAt(data, p + 2), 0]);
        p += n;
        if (kind === 0x2f) break;
        status = 0;
      } else if (status === 0xf0 || status === 0xf7) {
        let n; [n, p] = varlen(data, p); p += n; status = 0;
      } else {
        const hi = status & 0xf0, ch = status & 15;
        if (hi === 0xc0 || hi === 0xd0) p += 1;
        else {
          const a = byteAt(data, p), v = byteAt(data, p + 1); p += 2;
          if (hi === 0x90) raw.push([tick, track, seq, v ? 'on' : 'off', ch, a]);
          else if (hi === 0x80) raw.push([tick, track, seq, 'off', ch, a]);
        }
      }
      seq++;
    }
    pos = end;
  }
  raw.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  // Elapsed microseconds = acc / division with acc an exact integer (BigInt).
  let acc = 0n, tempo = 500000n, last = 0n;
  const timed = [], denom = BigInt(division) * 1000000n;
  for (const [tick, , , kind, a, b] of raw) {
    const t64 = BigInt(tick);
    acc += (t64 - last) * tempo; last = t64;
    const t = Number((acc * 140n) / denom);
    if (t >= ticks) break;
    if (kind === 'tempo') { tempo = BigInt(a); continue; }
    timed.push([t, [a === 9 ? 15 : a, kind === 'on', b & 127]]);
  }
  const steps = [];
  let time = 0;
  for (const [t, ev] of timed) {
    if (t > time) { steps.push(t - time); time = t; }
    steps.push(ev);
  }
  if (timed.length) steps.push(ticks - time);
  return steps;
}

/** Monophonic melody of the first `ticks` (1/140 s) of a MUS or MIDI lump. */
export function melody(data, channel, ticks) {
  const isMidi = latin1(data.subarray(0, 4)) === 'MThd';
  const steps = isMidi ? midiSteps(data, ticks) : musSteps(data, ticks);
  const played = [...new Set(steps.filter((s) => Array.isArray(s) && s[1] && s[0] !== 15).map((s) => s[0]))].sort((a, b) => a - b);
  if (!played.includes(channel) && played.length) channel = played[0];
  const notes = [], parts = [];
  let playing = 0, run = 0;
  for (const s of steps) {
    if (Array.isArray(s)) {
      const [ch, on, n] = s;
      if (ch === channel) {
        if (on) notes.push(n);
        else { const k = notes.indexOf(n); if (k >= 0) notes.splice(k, 1); }
      }
      continue;
    }
    const n = notes.length ? notes[notes.length - 1] : 0;
    if (run && n !== playing) { parts.push([playing, run]); run = 0; }
    playing = n; run += s;
  }
  if (run) parts.push([playing, run]);
  const result = [];
  for (let [n, t] of parts) {
    const phase = n ? PHASE[n] : 0;
    while (t) { const span = Math.min(t, 100); result.push((phase >> 8) & 255, phase & 255, span); t -= span; }
  }
  return result.concat([0, 0, 0]);
}

// ---------------------------------------------------------------- map grid

export const DOOR_SPECIALS = [1, 26, 27, 28, 31, 32, 33, 34, 117, 118];
const LOCKS = { 26: 1, 32: 1, 27: 2, 34: 2, 28: 3, 33: 3 };
const THING_KINDS = { 3004: 1, 9: 2, 3001: 3, 3002: 4, 58: 4, 3003: 5, 16: 5, 2007: 6, 2048: 6, 2011: 7, 2012: 7, 2001: 8, 5: 9, 6: 10, 13: 11, 2008: 12, 2049: 12, 2018: 13, 2019: 13 };
export const LIMITS = {
  objects: 64, gridBytes: 13312, gridWidth: 128, doorGroups: 63, doorCells: 255, regions: 255,
  regionWindow: 0x3200, headerBytes: 3072, assetBytes: 7680, diskSectors: 2880,
};
export const ASSET_SECTOR = 0;
export const HEADER_SECTOR = 30;
export const DATA_SECTOR = HEADER_SECTOR + 3072 / 256;
const DIRECTORY = [[576, 594], [720, 738]];

const vertexes = (l) => records(l, 4, (r, o) => [r.i16(o), r.i16(o + 2)]);
const linedefs = (l) => records(l, 14, (r, o) => [0, 2, 4, 6, 8, 10, 12].map((k) => r.u16(o + k)));
const thingsOf = (l) => records(l, 10, (r, o) => [0, 2, 4, 6, 8].map((k) => r.i16(o + k)));
const sidedefs = (l) => records(l, 30, (r, o) => [r.i16(o), r.i16(o + 2), r.b.subarray(o + 4, o + 12), r.b.subarray(o + 12, o + 20), r.b.subarray(o + 20, o + 28), r.u16(o + 28)]);

export function buildMap(lumps) {
  const vs = vertexes(lumps.VERTEXES);
  if (!vs.length) throw new WadError('map has no vertices');
  const oy = Math.min(...vs.map((v) => v[1])) - 96;
  const h = floorDiv(Math.max(...vs.map((v) => v[1])) - oy, 64) + 3;
  if (128 * h <= LIMITS.gridBytes) return buildGrid(lumps, oy, h);
  const full = buildGrid(lumps, oy, h);
  const rows = [];
  full.grid.forEach((c, i) => { if (c) rows.push(floorDiv(i, 128)); });
  const top = Math.min(...rows), bottom = Math.max(...rows), trimmed = bottom - top + 3;
  if (128 * trimmed > LIMITS.gridBytes) {
    throw new LimitError(`map needs ${h} grid rows (${trimmed} after trimming unreachable rows); HGR2 allows ${LIMITS.gridBytes / 128}`);
  }
  const m = buildGrid(lumps, oy + 64 * (top - 1), trimmed);
  m.trimmedRows = h - trimmed;
  return m;
}

// Does the segment (ax,ay)-(bx,by) touch a one-sided or impassable linedef? Integer, closed test.
function stepBlocked(vs, ls, ax, ay, bx, by) {
  const orient = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const within = (px, py, qx, qy, rx, ry) => Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
  for (const [a, b, flags, , , , left] of ls) {
    if (left !== 65535 && !(flags & 1)) continue;
    const [cx, cy] = vs[a], [dx, dy] = vs[b];
    const d1 = orient(cx, cy, dx, dy, ax, ay), d2 = orient(cx, cy, dx, dy, bx, by);
    const d3 = orient(ax, ay, bx, by, cx, cy), d4 = orient(ax, ay, bx, by, dx, dy);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    if ((d1 === 0 && within(cx, cy, dx, dy, ax, ay)) || (d2 === 0 && within(cx, cy, dx, dy, bx, by))
      || (d3 === 0 && within(ax, ay, bx, by, cx, cy)) || (d4 === 0 && within(ax, ay, bx, by, dx, dy))) return true;
  }
  return false;
}

function buildGrid(lumps, oy, h) {
  const vs = vertexes(lumps.VERTEXES), ls = linedefs(lumps.LINEDEFS), things = thingsOf(lumps.THINGS), sides = sidedefs(lumps.SIDEDEFS);
  if (!ls.length) throw new WadError('map has no linedefs');
  const ox = Math.min(...vs.map((v) => v[0])) - 96;
  const w = floorDiv(Math.max(...vs.map((v) => v[0])) - ox, 64) + 3;
  if (w > 128) throw new LimitError(`map is ${w} cells wide; HGR2 allows 128`);
  const cell = (x, y) => floorDiv(y - oy, 64) * 128 + floorDiv(x - ox, 64);
  const start = things.find((t) => t[3] === 1);
  if (!start) throw new WadError('map has no player 1 start');
  const grid = new Uint8Array(128 * h);
  for (let y = 1; y < h - 1; y++) grid.fill(15, y * 128 + 1, y * 128 + w - 1);
  const walls = new Map(), doors = new Map(), exits = [], secret = [];
  const sideAt = (i) => { if (i >= sides.length) throw new WadError('linedef references a missing sidedef'); return sides[i]; };
  const vAt = (i) => { if (i >= vs.length) throw new WadError('linedef references a missing vertex'); return vs[i]; };
  for (const [a, b, flags, spec, , right, left] of ls) {
    const [x1, y1] = vAt(a), [x2, y2] = vAt(b), dx = x2 - x1, dy = y2 - y1;
    if ([11, 51, 52, 124].includes(spec)) {
      const s = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      (spec === 51 || spec === 124 ? secret : exits).push(cell((x1 + x2) / 2 + dy / s * 40, (y1 + y2) / 2 - dx / s * 40));
    }
    const isdoor = DOOR_SPECIALS.includes(spec);
    if (left !== 65535 && !(flags & 1) && !isdoor) continue;
    for (const swap of [false, true]) {
      const [a0, b0, da, db, oa, ob] = swap ? [y1, x1, dy, dx, oy, ox] : [x1, y1, dx, dy, ox, oy];
      if (!db) continue;
      const k0 = Math.ceil((Math.min(b0, b0 + db) - ob - 32) / 64), k1 = Math.ceil((Math.max(b0, b0 + db) - ob - 32) / 64);
      for (let k = k0; k < k1; k++) {
        const p = a0 + da * (ob + 32 + 64 * k - b0) / db;
        const j = Math.floor((p - oa - 32) / 64);
        const i = swap ? j * 128 + k : k * 128 + j;
        const [step, bit, opp] = swap ? [128, 4, 8] : [1, 1, 2];
        if (i < 0 || i + step >= grid.length) continue;
        if (isdoor && left !== 65535) doors.set(i + step, LOCKS[spec] || 0);
        else {
          grid[i] &= ~bit; grid[i + step] &= ~opp;
          const name = sideAt(right)[4];
          const style = startsWithAny(name, ['COMP', 'TEK', 'PANEL']) ? 1 : startsWithAny(name, ['STAR', 'LITE', 'SUPP']) ? 2 : startsWithAny(name, ['STONE', 'SKIN', 'MARB']) ? 3 : 0;
          walls.set(i, style); walls.set(i + step, style);
        }
      }
    }
  }
  // Keep only centres inside the one-sided boundaries.
  for (let y = 0; y < h; y++) {
    const yy = oy + 32 + 64 * y, crossings = [];
    for (const [a, b, , , , , left] of ls) {
      if (left !== 65535) continue;
      const [ax, ay] = vs[a], [bx, by] = vs[b];
      if (Math.min(ay, by) <= yy && yy < Math.max(ay, by)) crossings.push(ax + (yy - ay) * (bx - ax) / (by - ay));
    }
    crossings.sort((p, q) => p - q);
    for (let x = 0; x < w; x++) {
      const X = ox + 32 + 64 * x;
      let c = 0;
      while (c < crossings.length && crossings[c] <= X) c++;
      if (c % 2 === 0) grid[y * 128 + x] = 0;
    }
  }
  const links = [[1, 1], [2, -1], [4, 128], [8, -128]];
  for (let i = 128; i < grid.length - 128; i++) {
    if (grid[i]) for (const [bit, off] of links) if (!grid[i + off]) grid[i] &= ~bit;
  }
  // A start on a cell edge can sample its own cell centre as outside (Freedoom E1M2): take the
  // playable neighbour whose centre is nearest the start (lowest index on a tie), provided the
  // step from the start to that centre touches no one-sided or impassable line.
  let seed = Math.trunc(cell(start[0], start[1]));
  if (seed >= 0 && seed < grid.length && !grid[seed]) {
    let best = -1, bestD = Infinity;
    for (const off of [-129, -128, -127, -1, 1, 127, 128, 129]) {
      const j = seed + off;
      if (j < 0 || j >= grid.length || !grid[j]) continue;
      if (stepBlocked(vs, ls, start[0], start[1], ox + 32 + 64 * pyMod(j, 128), oy + 32 + 64 * floorDiv(j, 128))) continue;
      const d = (ox + 32 + 64 * pyMod(j, 128) - start[0]) ** 2 + (oy + 32 + 64 * floorDiv(j, 128) - start[1]) ** 2;
      if (d < bestD || (d === bestD && j < best)) { bestD = d; best = j; }
    }
    if (best >= 0) seed = best;
  }
  if (!(seed >= 0 && seed < grid.length) || !grid[seed]) throw new WadError('player start lies outside the playable map');
  const reached = new Set([seed]), q = [seed];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    for (const [bit, off] of links) if (grid[i] & bit && !reached.has(i + off)) { reached.add(i + off); q.push(i + off); }
  }
  const ordered = [...reached].sort((p, r) => p - r);
  const closest = (i) => {
    i = Math.trunc(i);
    if (reached.has(i)) return i;
    let best = 0, bestD = Infinity;
    const ix = pyMod(i, 128), iy = floorDiv(i, 128);
    for (const j of ordered) {
      const d = (pyMod(j, 128) - ix) ** 2 + (floorDiv(j, 128) - iy) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  };
  for (let i = 0; i < grid.length; i++) if (!reached.has(i)) grid[i] = 0;
  for (const [i, s] of walls) if (reached.has(i)) grid[i] |= s << 6;
  for (const i of doors.keys()) if (reached.has(i)) grid[i] &= 15;
  for (const [i, lock] of doors) if (reached.has(i)) grid[i] |= 16 | (lock << 6);
  let exitCells = exits;
  if (!exitCells.length) {
    const bosses = things.filter((t) => t[3] === 3003);
    const t = bosses.length ? bosses[bosses.length - 1] : start;
    exitCells = [cell(t[0], t[1])];
  }
  for (const i of exitCells) { const c = closest(i); grid[c] = (grid[c] & 15) | 32; }
  for (const i of secret) { const c = closest(i); grid[c] = (grid[c] & 15) | 96; }
  const objects = [];
  for (const [x, y, , kind, flags] of things) {
    if (!(flags & 2) || flags & 16) continue;
    const t = THING_KINDS[kind];
    if (t && (reached.has(Math.trunc(cell(x, y))) || t === 5)) {
      const c = t === 5 ? closest(cell(x, y)) : Math.trunc(cell(x, y));
      objects.push(pyMod(c, 128), floorDiv(c, 128), t);
    }
  }
  const angle = pyMod(floorDiv(4 * (start[2] + 5), 45), 32);
  return { grid, ox, oy, seed, angle, objects, cells: reached.size, width: w, height: h, trimmedRows: 0 };
}

// ---------------------------------------------------------------- geometry

export function prepareGeometry(lumps, ox, oy, grid) {
  const vertices = vertexes(lumps.VERTEXES), lines = linedefs(lumps.LINEDEFS), sides = sidedefs(lumps.SIDEDEFS);
  const sectors = records(lumps.SECTORS, 26, (r, o) => [r.i16(o), r.i16(o + 2)]);
  const nodes = records(lumps.NODES, 28, (r, o) => [r.i16(o), r.i16(o + 2), r.i16(o + 4), r.i16(o + 6), r.u16(o + 24), r.u16(o + 26)]);
  const subs = records(lumps.SSECTORS, 4, (r, o) => [r.u16(o), r.u16(o + 2)]);
  const segs = records(lumps.SEGS, 12, (r, o) => [0, 2, 4, 6, 8, 10].map((k) => r.u16(o + k)));
  if (!nodes.length) throw new WadError('map has no BSP nodes (build it with a node builder)');
  const at = (arr, i, what) => { if (i >= arr.length) throw new WadError('map references a missing ' + what); return arr[i]; };
  const sector = (x, y) => {
    let n = nodes.length - 1, guard = 0;
    while (n < 32768) {
      const [sx, sy, dx, dy, r, l] = at(nodes, n, 'node');
      n = (y - sy) * dx >= (x - sx) * dy ? l : r;
      if (++guard > 65536) throw new WadError('BSP tree loops');
    }
    const [, first] = at(subs, n & 32767, 'subsector');
    const [, , , line, rev] = at(segs, first, 'seg');
    return at(sides, at(lines, line, 'linedef')[rev ? 6 : 5], 'sidedef')[5];
  };
  const doorCells = [];
  grid.forEach((c, i) => { if (c & 16) doorCells.push(i); });
  const cellForDoor = (x1, y1, x2, y2) => {
    const cx = Math.floor(((x1 + x2) / 2 - ox) / 64), cy = Math.floor(((y1 + y2) / 2 - oy) / 64);
    let best = 0, bestD = Infinity;
    for (const i of doorCells) {
      const d = (cx - pyMod(i, 128)) ** 2 + (cy - floorDiv(i, 128)) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const recs = [];
  for (const [a, b, , spec, , rs, ls] of lines) {
    if (rs === 65535) continue;
    const [x1, y1] = at(vertices, a, 'vertex'), [x2, y2] = at(vertices, b, 'vertex');
    const [f, c] = at(sectors, at(sides, rs, 'sidedef')[5], 'sector');
    let lo, hi, kind;
    if (ls === 65535) { lo = f; hi = c; kind = 1; } else {
      const [of, oc] = at(sectors, at(sides, ls, 'sidedef')[5], 'sector');
      if (DOOR_SPECIALS.includes(spec)) { lo = Math.min(f, of); hi = Math.max(c, oc); kind = 3; }
      else if (f !== of) { lo = Math.min(f, of); hi = Math.max(f, of); kind = 2; }
      else if (c !== oc) { lo = Math.min(c, oc); hi = Math.max(c, oc); kind = 2; }
      else continue;
    }
    if (hi <= lo) continue;
    recs.push([roundHalfEven((x1 - ox) / 8), roundHalfEven((y1 - oy) / 8), roundHalfEven((x2 - ox) / 8), roundHalfEven((y2 - oy) / 8),
      roundHalfEven(lo / 8), roundHalfEven(hi / 8), kind, kind === 3 ? cellForDoor(x1, y1, x2, y2) : 0]);
  }
  if (!recs.length) throw new WadError('map has no walls');
  const floors = new Uint8Array(grid.length);
  grid.forEach((c, i) => {
    if (c) {
      const xx = pyMod(i, 128) * 64 + 32 + ox, yy = floorDiv(i, 128) * 64 + 32 + oy;
      floors[i] = (floorDiv(at(sectors, sector(xx, yy), 'sector')[0], 8) + 128) & 255;
    }
  });
  return { records: recs, floors };
}

// ---------------------------------------------------------------- atlas

const ANGLES = 96;
function sinSeries(x) {
  let term = x, s = 0.0;
  for (let n = 1; n < 16; n++) { s += term; term = -term * x * x / ((2 * n) * (2 * n + 1)); }
  return s;
}
/** cos and sin of k*tau/96, computed identically to tools/reference/atlas.py. */
export function trigTable() {
  const step = (2 * Math.PI) / ANGLES, quarter = ANGLES / 4, half = quarter / 2;
  const sinQ = [], cosQ = [];
  for (let k = 0; k <= half; k++) { sinQ.push(sinSeries(k * step)); cosQ.push(sinSeries((quarter - k) * step)); }
  const sinFirst = (k) => (k <= half ? sinQ[k] : cosQ[quarter - k]);
  const cosFirst = (k) => (k <= half ? cosQ[k] : sinQ[quarter - k]);
  const cos = [], sin = [];
  for (let k = 0; k < ANGLES; k++) {
    const q = Math.floor(k / quarter), r = k % quarter;
    let c = cosFirst(r), s = sinFirst(r);
    if (r === 0) { c = 1.0; s = 0.0; }
    for (let t = 0; t < q; t++) [c, s] = [-s, c];
    cos.push(c); sin.push(s);
  }
  return { cos, sin };
}

export function doorGroups(grid) {
  const cells = new Set(), groups = new Map();
  grid.forEach((c, i) => { if (c & 16) cells.add(i); });
  let ng = 0;
  while (cells.size) {
    ng++;
    let m = Infinity; for (const i of cells) if (i < m) m = i;
    const q = [m];
    while (q.length) {
      const i = q.pop();
      if (!cells.has(i)) continue;
      cells.delete(i); groups.set(i, ng);
      q.push(i - 1, i + 1, i - 128, i + 128);
    }
  }
  return { groups, ng };
}

export function buildAtlas(recs, grid, floors) {
  const N = recs.length, col = (k) => Float64Array.from(recs, (r) => r[k]);
  const ax = col(0), ay = col(1), bx = col(2), by = col(3), lo = col(4), hi = col(5), kind = col(6), doorcell = col(7);
  const u = ax.map((a, r) => bx[r] - a), v = ay.map((a, r) => by[r] - a);
  const { cos, sin } = trigTable();
  const den = new Float64Array(ANGLES * N);
  for (let k = 0; k < ANGLES; k++) for (let r = 0; r < N; r++) {
    const d = cos[k] * v[r] - sin[k] * u[r];
    den[k * N + r] = Math.abs(d) < 1e-8 ? 1e-9 : d;
  }
  const { groups, ng } = doorGroups(grid);
  if (ng > LIMITS.doorGroups) throw new LimitError(`map has ${ng} door groups; the engine allows ${LIMITS.doorGroups}`);
  const doors = Float64Array.from(doorcell, (i) => groups.get(i) || 0);
  const region = new Map();
  const si = new Int32Array(ANGLES), pi = new Int32Array(ANGLES), st = new Float64Array(ANGLES), pt = new Float64Array(ANGLES);
  const tBuf = new Float64Array(N), okBuf = new Uint8Array(N);
  for (let c = 0; c < grid.length; c++) {
    if (!grid[c]) continue;
    const cx = c % 128, cy = Math.floor(c / 128), eyes = floors[c] - 128 + 5;
    for (let k = 0; k < ANGLES; k++) {
      const dx = cos[k], dy = sin[k];
      let sBest = 1e6, sIdx = 0;
      for (let r = 0; r < N; r++) {
        const wx = ax[r] - (cx * 8 + 4), wy = ay[r] - (cy * 8 + 4), d = den[k * N + r];
        const t = (wx * v[r] - wy * u[r]) / d, s = (wx * dy - wy * dx) / d;
        const ok = s >= 0 && s <= 1 && t >= 0.25;
        tBuf[r] = t; okBuf[r] = ok ? 1 : 0;
        const val = ok && kind[r] === 1 ? t : 1e6;
        if (val < sBest) { sBest = val; sIdx = r; }
      }
      let pBest = 1e6, pIdx = 0;
      const lim = sBest + 0.05;
      for (let r = 0; r < N; r++) {
        const val = okBuf[r] && kind[r] !== 1 && tBuf[r] <= lim ? tBuf[r] : 1e6;
        if (val < pBest) { pBest = val; pIdx = r; }
      }
      si[k] = sIdx; st[k] = sBest; pi[k] = pIdx; pt[k] = pBest;
    }
    const screen = (z, hgt) => clip(roundHalfEven(79 - (hgt - eyes) * 128 / Math.max(z, 1)), 0, 158);
    const dep = (t) => clip(roundHalfEven(t / 2), 1, 127);
    const chunk = new Uint8Array(768);
    for (let k = 0; k < ANGLES; k++) {
      const s = si[k], p = pi[k];
      chunk[k] = screen(st[k], hi[s]);
      chunk[96 + k] = screen(st[k], lo[s]);
      chunk[192 + k] = screen(pt[k], hi[p]);
      chunk[288 + k] = screen(pt[k], lo[p]);
      chunk[384 + k] = dep(st[k]);
      chunk[480 + k] = dep(pt[k]);
      chunk[576 + k] = pt[k] > 99999 ? 0 : kind[p] === 3 ? 1 + doors[p] : 1;
      const prev = (k + ANGLES - 1) % ANGLES;
      chunk[672 + k] = (Math.abs(u[s]) > Math.abs(v[s]) ? 1 : 0) | (si[prev] !== s ? 2 : 0) | (pi[prev] !== p ? 4 : 0);
    }
    const key = Math.floor(cx / 4) * 4096 + Math.floor(cy / 4);
    if (!region.has(key)) region.set(key, new Map());
    region.get(key).set((cy % 4) * 4 + (cx % 4), chunk);
  }
  if (region.size > LIMITS.regions) throw new LimitError(`map has ${region.size} regions; HGR2 allows ${LIMITS.regions}`);
  const zoneIndex = new Uint8Array(32 * Math.floor((Math.floor(grid.length / 128) + 3) / 4));
  const zones = [];
  [...region.keys()].sort((a, b) => a - b).forEach((key, zi) => {
    const zx = Math.floor(key / 4096), zy = key % 4096, cells = region.get(key);
    zoneIndex[zy * 32 + zx] = zi + 1;
    const slots = [...cells.keys()].sort((a, b) => a - b);
    const payload = new Uint8Array(16 + 768 * slots.length);
    slots.forEach((j, n) => { payload[j] = n + 1; payload.set(cells.get(j), 16 + 768 * n); });
    zones.push({ zone: [zx, zy], cells: slots.length, payload, packed: lzEncode(payload) });
  });
  return { groups, zoneIndex, zones };
}

// ---------------------------------------------------------------- HGR2 level pack

class Out {
  constructor() { this.a = []; }
  get length() { return this.a.length; }
  u8(...v) { for (const x of v) this.a.push(x & 255); }
  u16(...v) { for (const x of v) this.a.push((x >> 8) & 255, x & 255); }
  bytes(b) { for (const x of b) this.a.push(x); }
  set16(o, x) { this.a[o] = (x >> 8) & 255; this.a[o + 1] = x & 255; }
  toBytes() { return Uint8Array.from(this.a); }
}
const checkByte = (v, what) => { if (v < 0 || v > 255) throw new LimitError(`${what} (${v}) does not fit in a byte`); return v; };
const checkWord = (v, what) => { if (v < 0 || v > 65535) throw new LimitError(`${what} (${v}) does not fit in a word`); return v; };

/** True if a region can be read to the top of the region window and unpacked forward in place. */
export function inPlaceOk(packed, sectors, rawSize, window = LIMITS.regionWindow) {
  if (sectors * 256 > window || rawSize > window) return false;
  const src = window - sectors * 256;
  let written = 0, i = 0;
  while (i < packed.length) {
    const c = packed[i++];
    if (c & 128) { i += 2; written += (c & 127) + 3; } else { i += c + 1; written += c + 1; }
    if (written > src + i) return false;
  }
  return true;
}

/** Absolute start sector of each region from DATA_SECTOR, never spanning a directory track. */
export function placeRegions(counts) {
  const out = [];
  let p = DATA_SECTOR;
  for (const n of counts) {
    for (const [lo, hi] of DIRECTORY) if (p < hi && p + n > lo) p = Math.max(p, hi);
    out.push(p); p += n;
  }
  return { start: out, end: p };
}

export function packLevel(m, atlas) {
  const grid = m.grid, objs = m.objects, seed = m.seed, count = objs.length / 3;
  if (count > LIMITS.objects) throw new LimitError(`map has ${count} objects; HGR2 allows ${LIMITS.objects}`);
  if (grid.length > LIMITS.gridBytes) throw new LimitError(`grid is ${grid.length} bytes; HGR2 allows ${LIMITS.gridBytes}`);
  const groups = atlas.groups;
  if (groups.size > LIMITS.doorCells) throw new LimitError(`map has ${groups.size} door cells; HGR2 allows ${LIMITS.doorCells}`);
  if (atlas.zones.length > LIMITS.regions) throw new LimitError(`map has ${atlas.zones.length} regions; HGR2 allows ${LIMITS.regions}`);
  const counts = [], raw = [];
  for (const z of atlas.zones) {
    const n = Math.ceil(z.packed.length / 256);
    if (!inPlaceOk(z.packed, n, z.payload.length)) {
      throw new LimitError(`region ${z.zone} (${n} sectors, ${z.payload.length} bytes unpacked) cannot unpack in place in the ${LIMITS.regionWindow}-byte region window`);
    }
    counts.push(n); raw.push(z.payload.length);
  }
  const { start, end } = placeRegions(counts);
  if (end > LIMITS.diskSectors) throw new LimitError(`level needs sectors up to ${end}; the disk has ${LIMITS.diskSectors}`);
  const image = new Map();
  atlas.zones.forEach((z, i) => {
    const data = new Uint8Array(counts[i] * 256); data.set(z.packed);
    for (let k = 0; k < counts[i]; k++) image.set(start[i] + k, data.subarray(256 * k, 256 * k + 256));
  });
  const h = new Out();
  h.bytes([72, 71, 82, 50]);
  h.u16(grid.length); h.u8(count, pyMod(seed, 128), floorDiv(seed, 128), m.angle, groups.size, atlas.zones.length);
  h.bytes(new Uint8Array(20));
  const arrays = [[[...groups.keys()], 2, 'door cell'], [[...groups.values()], 1, 'door group'], [atlas.zoneIndex, 1, 'zone'],
    [start, 2, 'region sector'], [counts, 1, 'region sectors'], [raw, 2, 'region size'], [lzEncode(grid), 1, 'grid'],
    [objs.length ? objs : [0], 1, 'object']];
  arrays.forEach(([vals, size, what], idx) => {
    h.set16(12 + 2 * idx, h.length);
    for (const v of vals) size === 2 ? h.u16(checkWord(v, what)) : h.u8(checkByte(v, what));
  });
  h.set16(28, h.length);
  h.set16(30, DATA_SECTOR);
  start.forEach((s0, i) => {
    let sum = 0;
    for (let k = 0; k < counts[i]; k++) for (const x of image.get(s0 + k)) sum += x;
    h.u16(sum & 65535);
  });
  if (h.length > LIMITS.headerBytes) throw new LimitError(`HGR2 header is ${h.length} bytes; the engine reads ${LIMITS.headerBytes}`);
  const headerBytes = h.length;
  const header = new Uint8Array(LIMITS.headerBytes); header.set(h.toBytes());
  for (let k = 0; k < LIMITS.headerBytes / 256; k++) image.set(HEADER_SECTOR + k, header.subarray(256 * k, 256 * k + 256));
  // File extents: runs of sectors from the header to the end, broken at the directory tracks.
  const extents = [];
  let run = null;
  for (let s0 = HEADER_SECTOR; s0 < end; s0++) {
    if (DIRECTORY.some(([lo, hi]) => lo <= s0 && s0 < hi)) { run = null; continue; }
    if (!run) { run = [s0, []]; extents.push(run); }
    run[1].push(image.get(s0) || new Uint8Array(256));
  }
  return {
    extents: extents.map(([s0, parts]) => { const b = new Uint8Array(parts.length * 256); parts.forEach((p, k) => b.set(p, 256 * k)); return [s0, b]; }),
    headerBytes, sectors: counts, raw, start, end,
  };
}

// ---------------------------------------------------------------- HGA1 assets

export const SPRITES = [['guard', 'POSSA1', 16, 24], ['imp', 'TROOA1', 16, 24], ['impCast', 'TROOF1', 16, 24],
  ['fireball', 'BAL1A0', 16, 12], ['boss', 'BOSSA1', 16, 24], ['fist', 'PUNGA0', 40, 36],
  ['weapon', 'PISGA0', 40, 36], ['flash', 'PISGB0', 40, 36], ['shotgun', 'SHTGA0', 40, 36]];
export const FACES = [['marine', 'STFST01'], ['wounded', 'STFST31']];
export const CUES = [['intro', 'D_E1M1', 1], ['inter', 'D_INTER', 0], ['victory', 'D_VICTOR', 1]];
export const SOUNDS = [['fire', 'DSPISTOL'], ['blast', 'DSSHOTGN'], ['door', 'DSDOROPN'], ['hurt', 'DSPLPAIN'], ['pickup', 'DSITEMUP']];
export const ENTRY_NAMES = [...SPRITES.map((s) => s[0]), ...FACES.map((f) => f[0]), ...CUES.map((c) => c[0] + 'Notes'), ...SOUNDS.map((s) => 'snd_' + s[0])];

function spriteData(wad, lump, width, height) {
  const px = wad.patch(lump), data = [];
  if (!px.length || !px[0].length) throw new WadError('empty patch ' + lump);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 8) {
    let mask = 0, ink = 0;
    for (let bit = 0; bit < 8; bit++) {
      const sx = Math.floor((x + bit) * px[0].length / width), sy = Math.floor(y * px.length / height), v = px[sy][sx];
      if (v >= 0) {
        mask |= 128 >> bit;
        if (v > 43 || sx === 0 || px[sy][sx - 1] < 0) ink |= 128 >> bit;
      }
    }
    data.push(255 ^ mask, ink);
  }
  return data;
}

function faceData(wad, lump) {
  const f = wad.patch(lump), bits = [];
  if (!f.length || !f[0].length) throw new WadError('empty patch ' + lump);
  for (let y = 0; y < 25; y++) for (let col = 0; col < 3; col++) {
    let value = 0;
    for (let j = 0; j < 8; j++) if (f[Math.floor(y * f.length / 25)][Math.floor((8 * col + j) * f[0].length / 24)] > 68) value |= 128 >> j;
    bits.push(value);
  }
  return bits;
}

function soundData(data) {
  if (data.length < 8 || (data[0] | (data[1] << 8)) !== 3) throw new WadError('sound lump is not in DMX format');
  const rate = data[2] | (data[3] << 8), pcm = data.subarray(24, Math.max(24, data.length - 16));
  if (!rate || !pcm.length) throw new WadError('empty or invalid DMX sound');
  const n = Math.min(768, Math.floor(pcm.length * 4000 / rate)), out = [];
  for (let j = 0; j < n; j++) {
    const a = Math.floor(j * rate / 4000), b = Math.min(Math.floor((j + 1) * rate / 4000), pcm.length);
    if (b <= a) throw new WadError('DMX sample rate below 4000 Hz');
    let s = 0; for (let p = a; p < b; p++) s += pcm[p];
    out.push(Math.floor(s / (b - a)) & 252);
  }
  return out;
}

export function buildAssets(wad) {
  const entries = [];
  for (const [, lump, w, h] of SPRITES) entries.push(spriteData(wad, lump, w, h));
  for (const [, lump] of FACES) entries.push(faceData(wad, lump));
  for (const [, lump, ch] of CUES) entries.push(melody(wad.lump(lump), ch, 320));
  for (const [, lump] of SOUNDS) entries.push(soundData(wad.lump(lump)));
  const base = 8 + 4 * entries.length, b = new Out();
  b.bytes([72, 71, 65, 49]); b.u16(0, 0);
  let off = base;
  for (const e of entries) { b.u16(off, e.length); off += e.length; }
  for (const e of entries) b.bytes(e);
  if (b.length > LIMITS.assetBytes) throw new LimitError(`asset block is ${b.length} bytes, ${b.length - LIMITS.assetBytes} over the engine's ${LIMITS.assetBytes}-byte asset window`);
  const block = b.toBytes();
  let sum = 0; for (let i = 8; i < block.length; i++) sum += block[i];
  block[4] = block.length >> 8; block[5] = block.length & 255; block[6] = (sum >> 8) & 255; block[7] = sum & 255;
  return { assets: block, sizes: entries.map((e) => e.length) };
}

// ---------------------------------------------------------------- VDK

/** 80-track double-sided DragonDOS VDK. files: [[name, ext, [[firstSector, bytes], ...]]], one pair per contiguous extent. */
export function buildVdk(files) {
  const TRACKS = 80, SECTORS = 36, total = TRACKS * SECTORS;
  const disk = new Uint8Array(total * 256), dir = new Uint8Array(18 * 256);
  for (let n = 0; n < 160; n++) dir[512 + 256 * Math.floor(n / 10) + 25 * (n % 10)] = 0x88;
  const allocated = new Set();
  for (const t of [16, 20]) for (let s = t * SECTORS; s < t * SECTORS + 18; s++) allocated.add(s);
  let index = 0;
  for (const [name, ext, extents] of files) {
    let specs = [], size = 0;
    for (const [first, data] of extents) {
      let start = first;
      const count = Math.ceil(data.length / 256);
      if (start + count > total) throw new Error(`${name}.${ext} does not fit at sector ${first}`);
      for (let s = start; s < start + count; s++) if (allocated.has(s)) throw new Error(`${name}.${ext} does not fit at sector ${first}`);
      for (let s = start; s < start + count; s++) allocated.add(s);
      disk.set(data, 256 * start); size += data.length;
      let left = count;
      while (left) { const n = Math.min(255, left); specs.push([start >> 8, start & 255, n]); start += n; left -= n; }
    }
    let isFirst = true;
    while (specs.length) {
      const entry = new Uint8Array(25), e = isFirst ? 4 : 7;
      const part = specs.slice(0, e); specs = specs.slice(e);
      const off = isFirst ? 12 : 1;
      entry[0] = (isFirst ? 0 : 1) | (specs.length ? 32 : 0);
      if (isFirst) {
        const nm = (name.padEnd(8, '\0') + ext).slice(0, 11);
        for (let i = 0; i < 11; i++) entry[1 + i] = nm.charCodeAt(i);
      }
      entry.set(part.flat(), off);
      entry[24] = specs.length ? index + 1 : size % 256;
      dir.set(entry, 512 + Math.floor(index / 10) * 256 + (index % 10) * 25);
      index++; isFirst = false;
    }
  }
  for (let i = 0; i < total; i++) if (!allocated.has(i)) dir[Math.floor(i / 8) + (i >= 1440 ? 76 : 0)] |= 1 << (i % 8);
  dir.set([TRACKS, SECTORS, 255 - TRACKS, 255 - SECTORS], 252);
  for (const t of [16, 20]) disk.set(dir, t * SECTORS * 256);
  const out = new Uint8Array(12 + disk.length);
  out.set([0x64, 0x6b, 0x0c, 0x00, 0x10, 0x10, 0x00, 0x00, TRACKS, 2, 0, 0]); out.set(disk, 12);
  return out;
}

// ---------------------------------------------------------------- archives
//
// The converter accepts the WAD as distributed, not only a bare .wad:
//   - a .zip (stored or deflated entries), searched recursively, also one
//     behind a self-extractor stub (offsets relative to the file or to the
//     archive are both handled);
//   - a self-extractor split into numbered parts (NAME.1, NAME.2, ...), as in
//     the shareware download: the parts are joined in numeric order (plain
//     concatenation), giving a PKZIP self-extractor;
//   - an LHA/LZH archive, plain or behind a self-extractor stub.
// The LHA reader decodes -lh0-, -lh1- (LHarc 1.x: adaptive Huffman, 4 KB
// window) and -lh4-/-lh5-/-lh6-/-lh7- (static Huffman, 4-64 KB windows).

export class ArchiveError extends Error { constructor(m) { super(m); this.name = 'ArchiveError'; } }

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC32_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const CRC16_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xa001 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
/** CRC-16/ARC, as stored in LHA headers. */
export function crc16(b) { let c = 0; for (let i = 0; i < b.length; i++) c = CRC16_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return c; }

// ---- inflate (RFC 1951), canonical-Huffman decoding in the style of zlib's puff.c

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths, n) {
  const count = new Uint16Array(17), symbol = new Uint16Array(n), offs = new Uint16Array(17);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  for (let len = 1; len < 16; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

/** Raw DEFLATE decoder. `size` (if known) preallocates the output. */
export function inflateRaw(src, size = 0) {
  let pos = 0, bitbuf = 0, bitcnt = 0, out = new Uint8Array(size || Math.max(1024, src.length * 4)), n = 0;
  const need = (k) => {
    while (bitcnt < k) {
      if (pos >= src.length) throw new ArchiveError('deflate stream ends early');
      bitbuf |= src[pos++] << bitcnt; bitcnt += 8;
    }
  };
  const bits = (k) => { need(k); const v = bitbuf & ((1 << k) - 1); bitbuf >>>= k; bitcnt -= k; return v; };
  const put = (b) => {
    if (n >= out.length) { const o = new Uint8Array(out.length * 2); o.set(out); out = o; }
    out[n++] = b;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new ArchiveError('bad deflate code');
  };
  let fixedL = null, fixedD = null;
  for (;;) {
    const last = bits(1), type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;
      if (pos + 4 > src.length) throw new ArchiveError('deflate stream ends early');
      const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8); pos += 4;
      if (len !== (~nlen & 0xffff)) throw new ArchiveError('bad stored block');
      if (pos + len > src.length) throw new ArchiveError('deflate stream ends early');
      for (let i = 0; i < len; i++) put(src[pos++]);
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) {
        if (!fixedL) {
          const l = new Uint8Array(288);
          l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
          fixedL = huffman(l, 288); fixedD = huffman(new Uint8Array(30).fill(5), 30);
        }
        lit = fixedL; dist = fixedD;
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw new ArchiveError('bad deflate table');
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
        const clh = huffman(cl, 19), lengths = new Uint8Array(nlen + ndist);
        for (let i = 0; i < nlen + ndist;) {
          const sym = decode(clh);
          if (sym < 16) lengths[i++] = sym;
          else {
            let rep, val = 0;
            if (sym === 16) { if (!i) throw new ArchiveError('bad deflate table'); val = lengths[i - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > nlen + ndist) throw new ArchiveError('bad deflate table');
            while (rep--) lengths[i++] = val;
          }
        }
        lit = huffman(lengths.subarray(0, nlen), nlen); dist = huffman(lengths.subarray(nlen), ndist);
      }
      for (;;) {
        let sym = decode(lit);
        if (sym < 256) put(sym);
        else if (sym === 256) break;
        else {
          sym -= 257;
          if (sym >= 29) throw new ArchiveError('bad deflate length');
          const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
          const ds = decode(dist);
          if (ds >= 30) throw new ArchiveError('bad deflate distance');
          const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
          if (d > n) throw new ArchiveError('deflate distance too far back');
          for (let k = 0; k < len; k++) put(out[n - d]);
        }
      }
    } else throw new ArchiveError('bad deflate block type');
    if (last) break;
  }
  return n === out.length ? out : out.slice(0, n);
}

async function inflateRawAsync(src, size) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      // Fall through: an unsupported format name, or a stream the platform rejects.
    }
  }
  return inflateRaw(src, size);
}

// ---- zip

/** Entries of a zip archive: [{ name, method, size, crc, data (compressed bytes) }]. */
export function readZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ArchiveError('not a zip archive (no end-of-central-directory record)');
  const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true);
  // Self-extractors: the stored offsets may be relative to the archive, not
  // the file. The central directory ends where the EOCD record starts.
  const shift = eocd - cdSize - dv.getUint32(eocd + 16, true);
  if (shift < 0) throw new ArchiveError('corrupt zip: central directory overlaps the start of the file');
  let p = dv.getUint32(eocd + 16, true) + shift;
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new ArchiveError('corrupt zip central directory');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true) + shift;
    const name = latin1(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (local + 30 > b.length || dv.getUint32(local, true) !== 0x04034b50) throw new ArchiveError('corrupt zip local header for ' + name);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (start + csize > b.length) throw new ArchiveError('zip entry ' + name + ' runs past the end of the file');
    if (flags & 1) throw new ArchiveError('zip entry ' + name + ' is encrypted');
    if (name.endsWith('/')) continue;
    entries.push({ name, method, size, crc, data: b.subarray(start, start + csize) });
  }
  return entries;
}

const ZIP_METHOD_NAMES = { 1: 'shrink', 2: 'reduce', 3: 'reduce', 4: 'reduce', 5: 'reduce', 6: 'implode', 9: 'deflate64', 12: 'bzip2', 14: 'lzma' };

function zipEntryBytes(e, inflate) {
  let out;
  if (e.method === 0) out = e.data;
  else if (e.method === 8) out = inflate(e.data, e.size);
  else throw new ArchiveError(`Unsupported zip method ${e.method}${ZIP_METHOD_NAMES[e.method] ? ` (${ZIP_METHOD_NAMES[e.method]})` : ''} for ${e.name}`);
  const finish = (o) => {
    if (o.length !== e.size || crc32(o) !== e.crc) throw new ArchiveError(`zip entry ${e.name} fails its CRC check`);
    return o;
  };
  return out instanceof Promise ? out.then(finish) : finish(out);
}

// ---- LHA

const LHA_METHOD = /^-(lh[0-7d]|lz[s45]|pm[0-2])-$/;

function lhaHeaderAt(b, o) {
  if (o + 22 > b.length) return null;
  const method = latin1(b.subarray(o + 2, o + 7));
  if (!LHA_METHOD.test(method)) return null;
  const level = b[o + 20];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const packed = dv.getUint32(o + 7, true), size = dv.getUint32(o + 11, true);
  if (level === 0 || level === 1) {
    const hsize = b[o];
    if (hsize < 22 || o + 2 + hsize > b.length) return null;
    let sum = 0; for (let i = o + 2; i < o + 2 + hsize; i++) sum += b[i];
    if ((sum & 255) !== b[o + 1]) return null;
    const nlen = b[o + 21];
    if (22 + nlen + 2 > hsize + 2) return null;
    let name = latin1(b.subarray(o + 22, o + 22 + nlen));
    const crc = dv.getUint16(o + 22 + nlen, true);
    let p = o + 2 + hsize, dataSize = packed;
    if (level === 1) {
      let next = dv.getUint16(o + hsize, true);
      while (next) {
        if (p + next > b.length || next < 3) return null;
        const type = b[p];
        if (type === 1) name = latin1(b.subarray(p + 1, p + next - 2));
        dataSize -= next; p += next;
        next = dv.getUint16(p - 2, true);
      }
    }
    return { method, level, name, size, crc, data: p, packed: dataSize, next: p + dataSize };
  }
  if (level === 2) {
    const total = dv.getUint16(o, true);
    if (total < 26 || o + total > b.length) return null;
    const crc = dv.getUint16(o + 21, true);
    let name = '', dir = '', p = o + 24, next = dv.getUint16(p, true);
    p += 2;
    while (next) {
      if (p + next > o + total || next < 3) return null;
      const type = b[p];
      if (type === 1) name = latin1(b.subarray(p + 1, p + next - 2));
      else if (type === 2) dir = latin1(b.subarray(p + 1, p + next - 2)).replace(/\xff/g, '/');
      p += next; next = dv.getUint16(p - 2, true);
    }
    return { method, level, name: dir + name, size, crc, data: o + total, packed, next: o + total + packed };
  }
  return null;
}

/** Offset of the first valid LHA header, skipping any self-extractor stub. */
export function findLha(b) {
  for (let o = 0; o + 22 <= b.length; o++) {
    if (b[o + 2] !== 0x2d || b[o + 3] !== 0x6c || b[o + 6] !== 0x2d) continue;
    if (lhaHeaderAt(b, o)) return o;
  }
  return -1;
}

/** Members of an LHA archive (or self-extractor): [{ name, method, size, crc, packed: bytes, truncated }]. */
export function readLha(b) {
  let o = findLha(b);
  if (o < 0) throw new ArchiveError('no LHA archive found');
  const members = [];
  while (o < b.length && b[o] !== 0) {
    const h = lhaHeaderAt(b, o);
    if (!h) break;
    members.push({ name: h.name, method: h.method, size: h.size, crc: h.crc, packed: b.subarray(h.data, Math.min(h.next, b.length)), truncated: h.next > b.length });
    if (h.next > b.length) break;
    o = h.next;
  }
  return members;
}

class MsbBits {
  constructor(b) { this.b = b; this.p = 0; this.bit = 0; }
  one() {
    if (this.p >= this.b.length) { this.p++; return 0; } // LHA decoders read zeros past the end
    const v = (this.b[this.p] >> (7 - this.bit)) & 1;
    if (++this.bit === 8) { this.bit = 0; this.p++; }
    return v;
  }
  get(n) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | this.one(); return v; }
}

// Canonical Huffman decoder, MSB-first (LHA assigns codes like DEFLATE does).
function msbTable(lengths) {
  const n = lengths.length, used = [];
  for (let i = 0; i < n; i++) if (lengths[i]) used.push(i);
  if (used.length === 0) return { single: 0 };
  return huffman(lengths, n);
}
function msbDecode(h, r) {
  if ('single' in h) return h.single;
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= 16; len++) {
    code |= r.one();
    const c = h.count[len] || 0;
    if (code - c < first) return h.symbol[index + (code - first)];
    index += c; first += c; first <<= 1; code <<= 1;
  }
  throw new ArchiveError('bad LHA Huffman code');
}

/** -lh4- .. -lh7- (static Huffman, LZSS window 2^dicbit). */
export function lhNew(src, size, dicbit) {
  const NC = 510, NT = 19, TBIT = 5, CBIT = 9, NP = dicbit + 1, PBIT = dicbit <= 13 ? 4 : 5;
  const r = new MsbBits(src), out = new Uint8Array(size);
  let n = 0, blocksize = 0, ct = null, pt = null;
  const readPtLen = (nn, nbit, special) => {
    const len = new Uint8Array(nn), k = r.get(nbit);
    if (k === 0) { const c = r.get(nbit); return { single: c }; }
    if (k > nn) throw new ArchiveError('bad LHA table');
    for (let i = 0; i < k;) {
      let c = r.get(3);
      if (c === 7) while (r.one()) { if (++c > 16) throw new ArchiveError('bad LHA table'); }
      len[i++] = c;
      if (i === special) { let z = r.get(2); while (z-- > 0 && i < nn) len[i++] = 0; }
    }
    return msbTable(len);
  };
  const readCLen = (tt) => {
    const len = new Uint8Array(NC), k = r.get(CBIT);
    if (k === 0) { const c = r.get(CBIT); return { single: c }; }
    if (k > NC) throw new ArchiveError('bad LHA table');
    for (let i = 0; i < k;) {
      let c = msbDecode(tt, r);
      if (c <= 2) {
        c = c === 0 ? 1 : c === 1 ? r.get(4) + 3 : r.get(CBIT) + 20;
        while (c-- > 0 && i < NC) len[i++] = 0;
      } else len[i++] = c - 2;
    }
    return msbTable(len);
  };
  while (n < size) {
    if (blocksize === 0) {
      blocksize = r.get(16);
      const tt = readPtLen(NT, TBIT, 3);
      ct = readCLen(tt);
      pt = readPtLen(NP, PBIT, -1);
      if (r.p > src.length + 4) throw new ArchiveError('LHA data ends early');
    }
    blocksize--;
    const c = msbDecode(ct, r);
    if (c < 256) out[n++] = c;
    else {
      const len = c - 253;
      let j = msbDecode(pt, r);
      if (j !== 0) j = (1 << (j - 1)) + r.get(j - 1);
      const d = j + 1;
      for (let k = 0; k < len && n < size; k++, n++) out[n] = n - d >= 0 ? out[n - d] : 0x20;
    }
    if (r.p > src.length + 4) throw new ArchiveError('LHA data ends early');
  }
  return out;
}

// -lh1- position table: 64 codes for the upper 6 bits of a 12-bit distance
// (lengths 3,4x3,5x8,6x12,7x24,8x16, as in LHarc 1.x / LZHUF).
const LH1_POS_LEN = (() => {
  const l = new Uint8Array(64), runs = [[3, 1], [4, 3], [5, 8], [6, 12], [7, 24], [8, 16]];
  let i = 0; for (const [len, k] of runs) for (let j = 0; j < k; j++) l[i++] = len;
  return l;
})();

/** -lh1-: LHarc 1.x adaptive Huffman (LZHUF), 4 KB window, matches up to 60. */
export function lh1(src, size) {
  const NCHAR = 314, T = NCHAR * 2 - 1, R = T - 1, MAX_FREQ = 0x8000;
  const freq = new Uint32Array(T + 1), son = new Int32Array(T), prnt = new Int32Array(T + NCHAR);
  for (let i = 0; i < NCHAR; i++) { freq[i] = 1; son[i] = i + T; prnt[i + T] = i; }
  for (let i = 0, j = NCHAR; j <= R; i += 2, j++) { freq[j] = freq[i] + freq[i + 1]; son[j] = i; prnt[i] = prnt[i + 1] = j; }
  freq[T] = 0xffff; prnt[R] = 0;
  const reconst = () => {
    let j = 0;
    for (let i = 0; i < T; i++) if (son[i] >= T) { freq[j] = (freq[i] + 1) >>> 1; son[j] = son[i]; j++; }
    for (let i = 0, jj = NCHAR; jj < T; i += 2, jj++) {
      const f = freq[i] + freq[i + 1];
      let k = jj - 1;
      while (f < freq[k]) k--;
      k++;
      freq.copyWithin(k + 1, k, jj); freq[k] = f;
      son.copyWithin(k + 1, k, jj); son[k] = i;
    }
    for (let i = 0; i < T; i++) { const k = son[i]; if (k >= T) prnt[k] = i; else prnt[k] = prnt[k + 1] = i; }
  };
  const update = (c0) => {
    if (freq[R] === MAX_FREQ) reconst();
    let c = prnt[c0 + T];
    do {
      const k = ++freq[c];
      let l = c + 1;
      if (k > freq[l]) {
        while (k > freq[++l]);
        l--;
        freq[c] = freq[l]; freq[l] = k;
        const i = son[c]; prnt[i] = l; if (i < T) prnt[i + 1] = l;
        const j = son[l]; son[l] = i;
        prnt[j] = c; if (j < T) prnt[j + 1] = c;
        son[c] = j;
        c = l;
      }
      c = prnt[c];
    } while (c !== 0);
  };
  const r = new MsbBits(src), pos = msbTable(LH1_POS_LEN), out = new Uint8Array(size);
  let n = 0;
  while (n < size) {
    let c = son[R];
    while (c < T) { c = son[c + r.one()]; }
    c -= T; update(c);
    if (c < 256) out[n++] = c;
    else {
      const len = c - 253;
      const d = ((msbDecode(pos, r) << 6) | r.get(6)) + 1;
      for (let k = 0; k < len && n < size; k++, n++) out[n] = n - d >= 0 ? out[n - d] : 0x20;
    }
    if (r.p > src.length + 4) throw new ArchiveError('LHA data ends early');
  }
  return out;
}

const LH_DICBIT = { '-lh4-': 12, '-lh5-': 13, '-lh6-': 15, '-lh7-': 16 };

/** Decode one LHA member and check its CRC-16. */
export function lhaMemberBytes(m) {
  if (m.truncated) throw new ArchiveError(`${m.name} is cut off: the archive ends inside it`);
  let out;
  if (m.method === '-lh0-' || m.method === '-lz4-') out = m.packed.subarray(0, m.size);
  else if (m.method === '-lh1-') out = lh1(m.packed, m.size);
  else if (m.method in LH_DICBIT) out = lhNew(m.packed, m.size, LH_DICBIT[m.method]);
  else throw new ArchiveError(`Unsupported LHA method ${m.method}`);
  if (out.length !== m.size || crc16(out) !== m.crc) throw new ArchiveError(`${m.name} fails its CRC check (LHA ${m.method})`);
  return out;
}

// ---- input resolution

const WAD_PREFERENCE = ['DOOM1.WAD', 'DOOM.WAD', 'DOOM2.WAD', 'FREEDOOM1.WAD', 'FREEDOOM2.WAD', 'FREEDM.WAD'];
const baseName = (n) => n.replace(/^.*[\\/]/, '');
const isWadBytes = (b) => b.length >= 12 && ((b[0] === 0x49 || b[0] === 0x50) && b[1] === 0x57 && b[2] === 0x41 && b[3] === 0x44);
function zipEndsAt(b) { // the last EOCD record (plus its comment) ends the data
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) return i + 22 + (b[i + 20] | (b[i + 21] << 8)) === b.length;
  }
  return false;
}
function isZip(b) { // has an end-of-central-directory record (also behind a stub)
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) return true;
  }
  return false;
}

function pickWad(names) {
  const upper = names.map((n) => baseName(n).toUpperCase());
  for (const want of WAD_PREFERENCE) { const i = upper.indexOf(want); if (i >= 0) return i; }
  const wads = upper.map((n, i) => (n.endsWith('.WAD') ? i : -1)).filter((i) => i >= 0);
  return wads.length === 1 ? wads[0] : -1;
}

/** Group NAME.1, NAME.2, ... parts; returns [{ base, parts: [{n, name, bytes}] }]. */
function splitSets(files) {
  const sets = new Map();
  for (const f of files) {
    const m = /^(.*)\.(\d{1,3})$/.exec(baseName(f.name));
    if (!m) continue;
    const key = m[1].toUpperCase();
    if (!sets.has(key)) sets.set(key, { base: m[1], parts: [] });
    sets.get(key).parts.push({ n: parseInt(m[2], 10), name: baseName(f.name), bytes: f.bytes });
  }
  return [...sets.values()];
}

/** Join a split self-extractor: parts in ascending numeric order, concatenated. */
export function joinParts(set) {
  const parts = set.parts.slice().sort((a, b) => a.n - b.n);
  const first = parts[0].n;
  if (first !== 1) throw new ArchiveError(`${set.base}.1 is missing`);
  parts.forEach((p, i) => {
    if (p.n !== first + i) throw new ArchiveError(`${set.base}.${first + i} is missing`);
  });
  const total = parts.reduce((t, p) => t + p.bytes.length, 0), out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p.bytes, o); o += p.bytes.length; }
  return { bytes: out, parts, next: `${set.base}.${parts[parts.length - 1].n + 1}` };
}

function wadFromLha(bytes, label, missingPart) {
  let members;
  try { members = readLha(bytes); } catch (e) {
    throw new ArchiveError(`${label} holds no LHA archive`);
  }
  const i = pickWad(members.map((m) => m.name));
  if (i < 0) {
    if (missingPart && members.some((m) => m.truncated)) throw new ArchiveError(`${missingPart} is missing`);
    throw new ArchiveError(`This ${label} has no DOOM1.WAD inside`);
  }
  const m = members[i];
  if (m.truncated && missingPart) throw new ArchiveError(`${missingPart} is missing`);
  return { name: baseName(m.name), bytes: lhaMemberBytes(m), container: `${label} (LHA ${m.method})` };
}

function normalizeInputs(input) {
  if (input instanceof ArrayBuffer) return [{ name: 'input', bytes: new Uint8Array(input) }];
  if (ArrayBuffer.isView(input)) return [{ name: 'input', bytes: new Uint8Array(input.buffer, input.byteOffset, input.byteLength) }];
  if (Array.isArray(input)) {
    return input.map((f, k) => {
      if (f instanceof ArrayBuffer || ArrayBuffer.isView(f)) return normalizeInputs(f).map((x) => ({ ...x, name: 'input' + k }))[0];
      const b = f.bytes instanceof ArrayBuffer ? new Uint8Array(f.bytes) : new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
      return { name: String(f.name || 'input' + k), bytes: b };
    });
  }
  throw new TypeError('convert: expected the WAD or archive bytes, or an array of { name, bytes }');
}

function* resolveSteps(files, depth = 0) {
  if (depth > 3) throw new ArchiveError('archives nested too deeply');
  // 1. A bare WAD among the inputs.
  const wads = files.filter((f) => isWadBytes(f.bytes));
  if (wads.length) {
    const i = pickWad(wads.map((f) => f.name));
    const f = wads[i >= 0 ? i : 0];
    return { name: baseName(f.name), bytes: f.bytes, container: 'wad' };
  }
  // 2. Split self-extractor parts (NAME.1, NAME.2, ...): join, then read the
  //    PKZIP (or LHA) archive behind the stub.
  const sets = splitSets(files);
  for (const set of sets) {
    const joined = joinParts(set);
    const label = `${set.base}.${joined.parts.map((p) => p.n).join('+')} self-extractor`;
    const disorder = () => new ArchiveError(`${set.base}.${joined.parts.map((p) => p.n).join('+')} do not form an archive: a part is missing, damaged or out of order`);
    if (isZip(joined.bytes)) {
      // The joined parts must end exactly with the zip's end record.
      if (!zipEndsAt(joined.bytes)) throw joined.parts.length === 1 ? new ArchiveError(`${joined.next} is missing`) : disorder();
      let r;
      try { r = yield* resolveSteps([{ name: label, bytes: joined.bytes }], depth + 1); } catch (e) {
        if (e instanceof ArchiveError && /corrupt zip|runs past the end|fails its CRC|deflate|overlaps/.test(e.message)) throw disorder();
        throw e;
      }
      return { ...r, container: r.container.replace(/^zip/, label + ' (zip)') };
    }
    if (findLha(joined.bytes) >= 0) return wadFromLha(joined.bytes, label, joined.next);
    if (joined.parts.length === 1) throw new ArchiveError(`${joined.next} is missing`);
    throw disorder();
  }
  // 3. Zips (recursively: the shareware zip holds the split parts).
  for (const f of files) {
    if (!isZip(f.bytes)) continue;
    const entries = readZip(f.bytes);
    const i = pickWad(entries.map((e) => e.name));
    const inner = [];
    if (i >= 0) inner.push(entries[i]);
    else inner.push(...entries.filter((e) => /\.(\d{1,3}|zip|lzh|lha|exe)$/i.test(e.name)));
    if (!inner.length) throw new ArchiveError('This zip has no DOOM1.WAD inside');
    const opened = [];
    for (const e of inner) opened.push({ name: e.name, bytes: yield e });
    try {
      const r = yield* resolveSteps(opened, depth + 1);
      return { ...r, container: `zip > ${r.container}` };
    } catch (e) {
      if (e instanceof ArchiveError && /holds no LHA archive|nothing to convert/.test(e.message)) throw new ArchiveError('This zip has no DOOM1.WAD inside');
      throw e;
    }
  }
  // 4. An LHA archive, plain or behind a self-extractor stub.
  for (const f of files) {
    if (findLha(f.bytes) >= 0) return wadFromLha(f.bytes, 'LHA archive');
  }
  throw new ArchiveError('nothing to convert: no WAD, zip or LHA archive found in ' + files.map((f) => f.name).join(', '));
}


// ---- IWAD identification (MD5 / SHA-1 / size of known releases)

/** MD5 of a byte array, lowercase hex (RFC 1321). */
export function md5Hex(bytes) {
  const n = bytes.length, total = Math.ceil((n + 9) / 64) * 64, m = new Uint8Array(total);
  m.set(bytes); m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, (n * 8) >>> 0, true); dv.setUint32(total - 4, Math.floor(n / 0x20000000), true);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const w = new Uint32Array(16);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + 4 * i, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d; d = c; c = b;
      const x = (a + f + K[i] + w[g]) >>> 0, s = S[(i >> 4) * 4 + (i & 3)];
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0; a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((x) => [0, 8, 16, 24].map((k) => ((x >>> k) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

/** SHA-1 of a byte array, lowercase hex (FIPS 180-4). */
export function sha1Hex(bytes) {
  const n = bytes.length, total = Math.ceil((n + 9) / 64) * 64, m = new Uint8Array(total);
  m.set(bytes); m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(n / 0x20000000)); dv.setUint32(total - 4, (n * 8) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + 4 * i);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * Known IWAD releases. id Software hashes: Doom Wiki, https://doomwiki.org/wiki/DOOM1.WAD
 * and https://doomwiki.org/wiki/DOOM.WAD (the shareware MD5 was also checked by the
 * repository owner on DOOM1.WAD extracted from the official doom19s.zip; the registered
 * entry also matches TASVideos' version list). Freedoom: computed from the 0.13.0
 * release (tools/versions.env). No id Software data is in this repository.
 */
export const KNOWN_IWADS = [
  { name: 'DOOM1.WAD', release: 'Doom shareware v1.9', size: 4196020, md5: 'f0cefca49926d00903cf57551d901abe', sha1: '5b2e249b9c5133ec987b3ea77596381dc0d6bc1d' },
  { name: 'DOOM.WAD', release: 'Doom registered v1.9', size: 11159840, md5: '1cd63c5ddff1bf8ce844237f580e9cf3', sha1: '7742089b4468a736cadb659a7deca3320fe6dcbd' },
  { name: 'freedoom1.wad', release: 'Freedoom Phase 1 0.13.0', size: 28795076, md5: 'b93be13d05148dd01614bc205a03648e', sha1: '97bb88094a51457a8dcad98c58be22a2d0fa9a37', sha256: '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d' },
  { name: 'freedoom2.wad', release: 'Freedoom Phase 2 0.13.0', size: 28787748, md5: 'cd666466759b5e5f63af93c5f0ffd0a1', sha1: '975f781e6d801c0a23e3caa33f70493efe68a880', sha256: 'a8772e088847032510d97ba2312406a6998f21cbab44d4ff10696faa9c0ecd4b' },
];

/** The known release a WAD is (matched on size, MD5 and SHA-1), or null. */
export function identifyIwad(bytes) {
  const candidates = KNOWN_IWADS.filter((k) => k.size === bytes.length);
  if (!candidates.length) return null;
  const md5 = md5Hex(bytes), sha1 = sha1Hex(bytes);
  const hit = candidates.find((k) => k.md5 === md5 && k.sha1 === sha1);
  return hit ? { name: hit.name, release: hit.release } : null;
}

function finishWad(r, options) {
  if (!isWadBytes(r.bytes)) throw new WadError(`${r.name} is not a WAD`);
  const sha256 = sha256Hex(r.bytes);
  if (options.sha256) verifySha256(r.bytes, options.sha256, r.name);
  return { ...r, sha256, iwad: identifyIwad(r.bytes) };
}

/**
 * Find the WAD in a bare .wad, a zip, an LHA archive, a self-extractor or its
 * split parts. `input`: bytes, or [{ name, bytes }] for several files.
 * options.sha256 pins the WAD's hash (checked for every container).
 * Returns { name, bytes, container, sha256 }.
 */
export function openWad(input, options = {}) {
  const it = resolveSteps(normalizeInputs(input));
  let step = it.next();
  while (!step.done) step = it.next(zipEntryBytes(step.value, inflateRaw));
  return finishWad(step.value, options);
}

/** Like openWad, but inflates with DecompressionStream('deflate-raw') where available. */
export async function openWadAsync(input, options = {}) {
  const it = resolveSteps(normalizeInputs(input));
  let step = it.next();
  while (!step.done) step = it.next(await zipEntryBytes(step.value, inflateRawAsync));
  return finishWad(step.value, options);
}

// ---------------------------------------------------------------- top level

/**
 * Convert one map of a Doom-format IWAD to a WYRMFIRE level disk.
 * @param input the WAD, or an archive holding it (zip, LHA, self-extractor),
 *   as bytes, or an array of { name, bytes } (e.g. the DOOMS_19.1 + .2 parts).
 * @param {{map?: string, sha256?: string}} [options] sha256 pins the WAD's hash.
 * @returns {{disk: Uint8Array, assets: Uint8Array, info: object}}
 */
export function convert(input, options = {}) {
  return convertWad(openWad(input, options), options);
}

/** convert(), inflating zips with DecompressionStream where the platform has it. */
export async function convertAsync(input, options = {}) {
  return convertWad(await openWadAsync(input, options), options);
}

function convertWad(source, options) {
  const mapName = String(options.map || 'E1M1').toUpperCase();
  const wad = new Wad(source.bytes);
  const lumps = wad.level(mapName);
  const m = buildMap(lumps);
  const { records: recs, floors } = prepareGeometry(lumps, m.ox, m.oy, m.grid);
  const atlas = buildAtlas(recs, m.grid, floors);
  const lv = packLevel(m, atlas);
  const { assets, sizes } = buildAssets(wad);
  const disk = buildVdk([['WYRMFIRE', 'DAT', [[ASSET_SECTOR, assets]]], ['WYRMFIRE', 'LVL', lv.extents]]);
  const info = {
    map: mapName,
    cells: m.cells,
    gridWidth: m.width, gridHeight: m.height,
    objects: m.objects.length / 3,
    spawn: [pyMod(m.seed, 128), floorDiv(m.seed, 128), m.angle],
    doorCells: atlas.groups.size,
    doorGroups: Math.max(0, ...atlas.groups.values()),
    walls: recs.length,
    regions: atlas.zones.length,
    regionCells: atlas.zones.map((z) => z.cells),
    regionBytes: atlas.zones.map((z) => z.payload.length),
    regionSectors: lv.sectors,
    regionStart: lv.start,
    headerBytes: lv.headerBytes,
    levelBytes: lv.extents.reduce((t, e) => t + e[1].length, 0),
    lastSector: lv.end,
    assetBytes: assets.length,
    assetSizes: Object.fromEntries(ENTRY_NAMES.map((n, i) => [n, sizes[i]])),
    diskBytes: disk.length,
    sha256: sha256Hex(disk),
    source: { name: source.name, container: source.container, sha256: source.sha256, iwad: source.iwad },
  };
  return { disk, assets, info };
}

/** Map names (marker lumps followed by THINGS) in a WAD. */
export function listMaps(input) { return new Wad(openWad(input).bytes).maps(); }

// ---------------------------------------------------------------- readers (tests, tooling)

const be16 = (b, o) => (b[o] << 8) | b[o + 1];

/** Parse the HGR2 level on a VDK (header at HEADER_SECTOR, regions at their sectors) and verify its checksums. */
export function parseLevel(vdk) {
  if (vdk[0] !== 0x64 || vdk[1] !== 0x6b) throw new Error('not a VDK image');
  const d = vdk.subarray(vdk[2] | (vdk[3] << 8)), sector = (n, k = 1) => d.subarray(256 * n, 256 * (n + k));
  const level = sector(HEADER_SECTOR, LIMITS.headerBytes / 256);
  if (latin1(level.subarray(0, 4)) !== 'HGR2') throw new Error('not an HGR2 level pack');
  const off = (i) => be16(level, 12 + 2 * i);
  const nDoors = level[10], nRegions = level[11];
  const words = (o, n) => Array.from({ length: n }, (_, i) => be16(level, o + 2 * i));
  const bytes = (o, n) => Array.from(level.subarray(o, o + n));
  const gridSize = be16(level, 4);
  const header = {
    gridSize, objectCount: level[6], spawn: [level[7], level[8], level[9]], doorCellCount: nDoors, regionCount: nRegions,
    firstSector: be16(level, 30),
    doorCells: words(off(0), nDoors), doorGroups: bytes(off(1), nDoors),
    zoneIndex: bytes(off(2), off(3) - off(2)),
    diskSector: words(off(3), nRegions), diskCount: bytes(off(4), nRegions), rawSize: words(off(5), nRegions),
    packedGrid: level.subarray(off(6), off(7)), objects: bytes(off(7), Math.max(1, 3 * level[6])),
    checksums: words(be16(level, 28), nRegions),
  };
  header.grid = lzDecode(header.packedGrid, gridSize);
  header.regions = header.diskSector.map((s0, i) => sector(s0, header.diskCount[i]));
  header.regions.forEach((r, i) => {
    let sum = 0; for (const x of r) sum += x;
    if ((sum & 65535) !== header.checksums[i]) throw new Error('region ' + (i + 1) + ' checksum mismatch');
  });
  return header;
}

/** Parse and verify an HGA1 asset block: { name: Uint8Array }. */
export function parseAssets(block) {
  if (block.length < 8 || latin1(block.subarray(0, 4)) !== 'HGA1') throw new Error('not an HGA1 asset block');
  const length = be16(block, 4);
  if (length > block.length || length < 8 + 4 * ENTRY_NAMES.length) throw new Error('bad HGA1 length');
  let s = 0; for (let i = 8; i < length; i++) s += block[i];
  if ((s & 65535) !== be16(block, 6)) throw new Error('HGA1 checksum mismatch');
  return Object.fromEntries(ENTRY_NAMES.map((n, i) => {
    const o = be16(block, 8 + 4 * i), l = be16(block, 10 + 4 * i);
    if (o + l > length) throw new Error('HGA1 entry ' + n + ' out of range');
    return [n, block.subarray(o, o + l)];
  }));
}

/** List the files of a DragonDOS VDK by walking its directory extents. */
export function readVdk(vdk) {
  if (vdk[0] !== 0x64 || vdk[1] !== 0x6b) throw new Error('not a VDK image');
  const d = vdk.subarray(vdk[2] | (vdk[3] << 8)), dirAt = (t) => d.subarray(t * 36 * 256, (t * 36 + 18) * 256);
  const a = dirAt(20), b = dirAt(16);
  if (a.some((x, i) => x !== b[i])) throw new Error('directory copies differ');
  const entry = (i) => a.subarray(512 + Math.floor(i / 10) * 256 + (i % 10) * 25, 512 + Math.floor(i / 10) * 256 + (i % 10) * 25 + 25);
  const files = {};
  for (let i = 0; i < 160; i++) {
    let e = entry(i);
    if (e[0] & 0x81 || e[0] === 0x88) continue; // deleted, continuation or never used
    const name = latin1(e.subarray(1, 9)).replace(/\0+$/, '') + '.' + latin1(e.subarray(9, 12));
    const parts = []; const seen = new Set();
    for (;;) {
      const pos = e[0] & 1 ? 1 : 12;
      for (let j = pos; j + 2 < 24; j += 3) {
        const n = be16(e, j), len = e[j + 2];
        if (len) parts.push(d.subarray(n * 256, (n + len) * 256));
      }
      if (!(e[0] & 32)) {
        const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0)); let p = 0;
        for (const x of parts) { out.set(x, p); p += x.length; }
        files[name] = e[24] ? out.subarray(0, out.length - (256 - e[24])) : out;
        break;
      }
      if (seen.has(e[24])) throw new Error('directory loop'); seen.add(e[24]);
      e = entry(e[24]);
    }
  }
  return files;
}
