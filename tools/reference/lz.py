"""Tiny LZ used for level regions, the map grid and the engine image.

Stream: control byte c. c < 128: c+1 literal bytes follow. c >= 128: copy
(c & 127) + 3 bytes from a big-endian signed 16-bit negative distance.
"""
from collections import defaultdict, deque
import struct


def encode(raw, window=None):
    raw = bytes(raw)
    seen = defaultdict(lambda: deque(maxlen=32)); stream = bytearray(); buf = bytearray()

    def flush():
        if buf: stream.append(len(buf) - 1); stream.extend(buf); buf.clear()
    i = 0
    while i < len(raw):
        best = 0; distance = 0
        for j in reversed(seen[raw[i:i + 3]]):
            if window is not None and i - j > window: break
            n = 0
            while n < 130 and i + n < len(raw) and raw[i + n] == raw[j + n]: n += 1
            if n > best: best = n; distance = i - j
        if best >= 4:
            flush(); stream.append(128 | best - 3); stream.extend(struct.pack('>h', -distance)); step = best
        else:
            buf.append(raw[i]); step = 1
            if len(buf) == 128: flush()
        for j in range(i, i + step): seen[raw[j:j + 3]].append(j)
        i += step
    flush(); return bytes(stream)


def decode(stream, size):
    out = bytearray(); i = 0
    while len(out) < size:
        c = stream[i]; i += 1
        if c & 128:
            d = struct.unpack_from('>h', stream, i)[0]; i += 2
            for _ in range((c & 127) + 3): out.append(out[d])
        else:
            out.extend(stream[i:i + c + 1]); i += c + 1
    return bytes(out)
