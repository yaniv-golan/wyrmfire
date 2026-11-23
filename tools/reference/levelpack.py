"""Assemble the HGR2 level pack: a 12-sector header at a fixed sector, then
each region's LZ stream padded to whole sectors at the absolute sector
recorded in the header.

Reference implementation for converter/wyrmfire-convert.js.

Header (big-endian):
  0  'HGR2'
  4  unpacked grid size        6  object count (<= 64)
  7  spawn x   8  spawn y      9  spawn angle (0..31)
 10  door cell count          11  region count
 12  8 word offsets: doorCells, doorGroups, zoneIndex, diskSector (words,
     absolute logical sector of each region), diskCount, rawSize, packed
     grid, objects
 28  word offset of the per-region 16-bit transfer checksums
 30  first region sector (word)

The engine reads a region's sectors to the top of its 12,800-byte AREA
window and unpacks in place towards the bottom, so every region must pass
`in_place_ok`.
"""
import struct
from lz import encode
from levelmap import LimitError, MAX_OBJECTS, MAX_GRID

HEADER_SECTOR = 30
HEADER_BYTES = 3072
DATA_SECTOR = HEADER_SECTOR + HEADER_BYTES // 256   # 42
REGION_WINDOW = 0x3200      # AREA $7A00-$ABFF
DISK_SECTORS = 2880
DIRECTORY = ((576, 594), (720, 738))   # tracks 16 and 20, side 0


def in_place_ok(packed, sectors, raw_size, window=REGION_WINDOW):
    """Unpacking forward from the window start must never overtake the
    unread input, which sits in the last `sectors` sectors of the window."""
    if sectors * 256 > window or raw_size > window:
        return False
    src = window - sectors * 256; written = 0; i = 0
    while i < len(packed):
        c = packed[i]; i += 1
        if c & 128: i += 2; written += (c & 127) + 3
        else: i += c + 1; written += c + 1
        if written > src + i: return False
    return True


def place(sectors):
    """Absolute start sector for each region, from DATA_SECTOR, skipping the
    directory tracks; a region never spans one."""
    out = []; p = DATA_SECTOR
    for n in sectors:
        for lo, hi in DIRECTORY:
            if p < hi and p + n > lo: p = max(p, hi)
        out.append(p); p += n
    return out, p


def pack_level(m, atlas):
    grid = bytes(m['grid']); objs = m['objects']; seed = m['seed']
    count = len(objs) // 3
    if count > MAX_OBJECTS:
        raise LimitError('map has %d objects; HGR2 allows %d' % (count, MAX_OBJECTS))
    if len(grid) > MAX_GRID:
        raise LimitError('grid is %d bytes; HGR2 allows %d' % (len(grid), MAX_GRID))
    groups = atlas['groups']
    if len(groups) > 255:
        raise LimitError('map has %d door cells; HGR2 allows 255' % len(groups))
    if len(atlas['zones']) > 255:
        raise LimitError('map has %d regions; HGR2 allows 255' % len(atlas['zones']))
    counts = []; raw = []
    for z in atlas['zones']:
        n = (len(z['packed']) + 255) // 256
        if not in_place_ok(z['packed'], n, len(z['payload'])):
            raise LimitError('region %s (%d sectors, %d bytes unpacked) cannot unpack in place in the %d-byte region window'
                             % (z['zone'], n, len(z['payload']), REGION_WINDOW))
        counts.append(n); raw.append(len(z['payload']))
    sectors, end = place(counts)
    if end > DISK_SECTORS:
        raise LimitError('level needs sectors up to %d; the disk has %d' % (end, DISK_SECTORS))
    image = {}  # absolute sector -> 256 bytes
    for z, s, n in zip(atlas['zones'], sectors, counts):
        data = z['packed'] + bytes(n * 256 - len(z['packed']))
        for k in range(n): image[s + k] = data[256 * k:256 * k + 256]
    header = bytearray(b'HGR2' + struct.pack('>HBBBBBB', len(grid), count, seed % 128, seed // 128, m['angle'],
                                              len(groups), len(atlas['zones'])))
    arrays = [(list(groups.keys()), 'H'), (list(groups.values()), 'B'), (list(atlas['zone_index']), 'B'),
              (sectors, 'H'), (counts, 'B'), (raw, 'H'), (list(encode(grid)), 'B'), (objs or [0], 'B')]
    header += bytes(20)
    for idx, (vals, typ) in enumerate(arrays):
        struct.pack_into('>H', header, 12 + idx * 2, len(header))
        header += struct.pack('>' + typ * len(vals), *vals)
    struct.pack_into('>H', header, 28, len(header))
    struct.pack_into('>H', header, 30, DATA_SECTOR)
    for s, n in zip(sectors, counts):
        header += struct.pack('>H', sum(b''.join(image[s + k] for k in range(n))) & 65535)
    if len(header) > HEADER_BYTES:
        raise LimitError('HGR2 header is %d bytes; the engine reads %d' % (len(header), HEADER_BYTES))
    header_bytes = len(header)
    header += bytes(HEADER_BYTES - len(header))
    for k in range(HEADER_BYTES // 256): image[HEADER_SECTOR + k] = header[256 * k:256 * k + 256]
    # The file's extents: runs of sectors from the header to the last region,
    # broken at the directory tracks (gaps inside a run are zero sectors).
    extents = []; run = None
    for s in range(HEADER_SECTOR, end):
        if any(lo <= s < hi for lo, hi in DIRECTORY):
            run = None; continue
        if run is None: run = [s, bytearray()]; extents.append(run)
        run[1] += image.get(s, bytes(256))
    extents = [(s, bytes(b)) for s, b in extents]
    return extents, dict(header_bytes=header_bytes, sectors=counts, raw=raw, start=sectors, end=end)
