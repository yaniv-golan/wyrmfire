"""Build the HGA1 asset block (sprites, status faces, music cues, sound
effects) that the engine loads from the level disk.

Reference implementation for converter/wyrmfire-convert.js.

HGA1 layout (big-endian):
  0  'HGA1'
  4  total length in bytes (header + table + data)
  6  16-bit sum of bytes 8..length-1
  8  ENTRY_COUNT x (offset, length) words, offsets from the block start
     followed by the entry data.
"""
import struct

ASSET_SECTOR = 0            # logical sector of WYRMFIRE.DAT on the disk
MAX_ASSET_BYTES = 7680      # 30 sectors; the engine's ASSETS window $5000-$6DFF

SPRITES = [('guard', 'POSSA1', 16, 24), ('imp', 'TROOA1', 16, 24), ('impCast', 'TROOF1', 16, 24),
           ('fireball', 'BAL1A0', 16, 12), ('boss', 'BOSSA1', 16, 24), ('fist', 'PUNGA0', 40, 36),
           ('weapon', 'PISGA0', 40, 36), ('flash', 'PISGB0', 40, 36), ('shotgun', 'SHTGA0', 40, 36)]
FACES = [('marine', 'STFST01'), ('wounded', 'STFST31')]
CUES = [('intro', 'D_E1M1', 1), ('inter', 'D_INTER', 0), ('victory', 'D_VICTOR', 1)]
SOUNDS = [('fire', 'DSPISTOL'), ('blast', 'DSSHOTGN'), ('door', 'DSDOROPN'), ('hurt', 'DSPLPAIN'), ('pickup', 'DSITEMUP')]
ENTRY_NAMES = ([n for n, *_ in SPRITES] + [n for n, _ in FACES] + [n + 'Notes' for n, *_ in CUES] +
               ['snd_' + n for n, _ in SOUNDS] + ['credits'])

# Level-data lines for the engine's credits screen (each NUL-terminated).
CREDIT_LINES = {'freedoom': ['LEVEL DATA: FREEDOOM (BSD)', 'MODIFIED FOR THE DRAGON 64'], 'other': ['LEVEL DATA: YOUR OWN WAD']}


def credit_data(freedoom):
    out = []
    for line in CREDIT_LINES['freedoom' if freedoom else 'other']:
        if len(line) > 32 or any(not 32 <= ord(c) <= 90 for c in line):
            raise ValueError('credit line does not fit the engine font: ' + line)
        out += [ord(c) for c in line] + [0]
    return out


def sprite(wad, lump, width, height):
    pixels = wad.patch(lump); data = []
    for y in range(height):
        for x in range(0, width, 8):
            mask = ink = 0
            for bit in range(8):
                sx = (x + bit) * len(pixels[0]) // width; sy = y * len(pixels) // height; v = pixels[sy][sx]
                if v >= 0:
                    mask |= 128 >> bit
                    if v > 43 or sx == 0 or pixels[sy][sx - 1] < 0: ink |= 128 >> bit
            data += [255 ^ mask, ink]
    return data


def face(wad, lump):
    f = wad.patch(lump); bits = []
    for y in range(25):
        for col in range(3):
            value = 0
            for j in range(8):
                v = f[y * len(f) // 25][(8 * col + j) * len(f[0]) // 24]
                if v > 68: value |= 128 >> j
            bits.append(value)
    return bits


def sound(data):
    if len(data) < 8 or struct.unpack_from('<H', data)[0] != 3:
        raise ValueError('sound lump is not in DMX format')
    rate = struct.unpack_from('<H', data, 2)[0]; pcm = data[24:-16]
    if not rate or not pcm:
        raise ValueError('empty or invalid DMX sound')
    n = min(768, len(pcm) * 4000 // rate)
    out = []
    for j in range(n):
        part = pcm[j * rate // 4000:(j + 1) * rate // 4000]
        if not part:
            raise ValueError('DMX sample rate below 4000 Hz')
        out.append(sum(part) // len(part) & 252)
    return out


def build(wad, freedoom=False):
    from music import melody
    entries = []
    for name, lump, w, h in SPRITES: entries.append(sprite(wad, lump, w, h))
    for name, lump in FACES: entries.append(face(wad, lump))
    for name, lump, ch in CUES: entries.append(melody(wad.lump(lump), ch, 320))
    for name, lump in SOUNDS: entries.append(sound(wad.lump(lump)))
    entries.append(credit_data(freedoom))
    table = bytearray(); body = bytearray(); base = 8 + 4 * len(entries)
    for e in entries:
        table += struct.pack('>HH', base + len(body), len(e)); body += bytes(e)
    block = bytearray(b'HGA1' + struct.pack('>HH', 0, 0)) + table + body
    if len(block) > MAX_ASSET_BYTES:
        from levelmap import LimitError
        raise LimitError('asset block is %d bytes, %d over the engine\'s %d-byte asset window'
                         % (len(block), len(block) - MAX_ASSET_BYTES, MAX_ASSET_BYTES))
    struct.pack_into('>HH', block, 4, len(block), sum(block[8:]) & 65535)
    return bytes(block), [len(e) for e in entries]
