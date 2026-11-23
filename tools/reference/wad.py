"""Read Doom-format WAD directories, map lumps and picture patches.

Reference implementation for converter/wyrmfire-convert.js.
"""
import struct

MAP_LUMPS = ('THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS',
             'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP')


class WadError(ValueError):
    pass


class Wad:
    def __init__(self, data):
        self.data = data = bytes(data)
        if len(data) < 12:
            raise WadError('WAD shorter than its 12-byte header')
        magic, n, offset = struct.unpack_from('<4sII', data)
        if magic not in (b'IWAD', b'PWAD'):
            raise WadError('not a WAD (bad magic)')
        if offset + 16 * n > len(data):
            raise WadError('WAD directory runs past end of file')
        self.lumps = []
        for pos, size, name in struct.iter_unpack('<II8s', data[offset:offset + n * 16]):
            if pos + size > len(data):
                raise WadError('lump runs past end of file')
            self.lumps.append((name.split(b'\0')[0].decode('latin-1').upper(), data[pos:pos + size]))
        self.by_name = {}
        for name, lump in self.lumps:  # the last lump of a name wins (PWAD override order)
            self.by_name[name] = lump
        if 'PLAYPAL' not in self.by_name or len(self.by_name['PLAYPAL']) < 768:
            raise WadError('WAD has no PLAYPAL palette')
        pal = self.by_name['PLAYPAL'][:768]
        self.gray = [(54 * r + 183 * g + 19 * b) // 256 for r, g, b in struct.iter_unpack('BBB', pal)]

    def lump(self, name):
        if name not in self.by_name:
            raise WadError('WAD has no lump ' + name)
        return self.by_name[name]

    def maps(self):
        return [name for i, (name, _) in enumerate(self.lumps)
                if i + 1 < len(self.lumps) and self.lumps[i + 1][0] == 'THINGS']

    def level(self, name):
        name = name.upper()
        start = next((i for i, (key, _) in enumerate(self.lumps) if key == name), None)
        if start is None:
            raise WadError('WAD has no map ' + name)
        lumps = dict(self.lumps[start + 1:start + 11])
        for key in MAP_LUMPS[:8]:
            if key not in lumps:
                raise WadError('map %s has no %s lump' % (name, key))
        return lumps

    def patch(self, name):
        data = self.lump(name.upper())
        w, h, left, top = struct.unpack_from('<hhhh', data)
        pixels = [[-1] * w for _ in range(h)]
        for x in range(w):
            p = struct.unpack_from('<I', data, 8 + 4 * x)[0]
            while data[p] != 255:
                y, n = data[p:p + 2]
                for dy, index in enumerate(data[p + 3:p + 3 + n]):
                    if y + dy < h: pixels[y + dy][x] = self.gray[index]
                p += 4 + n
        return pixels
