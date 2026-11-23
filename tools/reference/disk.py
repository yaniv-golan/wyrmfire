"""Build an 80-track double-sided DragonDOS VDK holding contiguous files.

Reference implementation for converter/wyrmfire-convert.js.
"""
import math, struct

TRACKS, SECTORS = 80, 36
DIRECTORY_TRACKS = (16, 20)


def build_vdk(files):
    """files: [(name, ext, [(first_sector, bytes), ...])] in directory order.
    Each (sector, bytes) is one contiguous extent; the file is their
    concatenation."""
    disk = bytearray(TRACKS * SECTORS * 256); directory = bytearray(18 * 256)
    for n in range(160): directory[512 + 256 * (n // 10) + 25 * (n % 10)] = 0x88
    allocated = set()
    for t in DIRECTORY_TRACKS: allocated |= set(range(t * SECTORS, t * SECTORS + 18))
    index = 0
    for name, ext, extents in files:
        specs = []; total = 0
        for start, data in extents:
            count = math.ceil(len(data) / 256); blocks = set(range(start, start + count))
            if blocks & allocated or start + count > TRACKS * SECTORS:
                raise ValueError('%s.%s does not fit at sector %d' % (name, ext, start))
            allocated |= blocks; disk[256 * start:256 * start + len(data)] = data
            total += len(data); left = count
            while left:
                n = min(255, left); specs.append(struct.pack('>HB', start, n)); start += n; left -= n
        first = True
        while specs:
            entry = bytearray(25); e = 4 if first else 7
            part, specs = specs[:e], specs[e:]; off = 12 if first else 1
            entry[0] = (0 if first else 1) | (32 if specs else 0)
            if first: entry[1:12] = name.encode().ljust(8, b'\0') + ext.encode()
            entry[off:off + 3 * len(part)] = b''.join(part); entry[24] = index + 1 if specs else total % 256
            j = 512 + (index // 10) * 256 + (index % 10) * 25
            directory[j:j + 25] = entry; index += 1; first = False
    for i in range(TRACKS * SECTORS):
        if i not in allocated: directory[i // 8 + (76 if i >= 1440 else 0)] |= 1 << (i % 8)
    directory[252:256] = bytes([TRACKS, SECTORS, 255 - TRACKS, 255 - SECTORS])
    for t in DIRECTORY_TRACKS: disk[t * SECTORS * 256:t * SECTORS * 256 + len(directory)] = directory
    return b'dk\x0c\x00\x10\x10\x00\x00' + bytes([TRACKS, 2, 0, 0]) + bytes(disk)
