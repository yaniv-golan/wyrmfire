"""Reduce a few seconds of an IWAD music lump (MUS or MIDI) to a monophonic
melody for the DAC.

Reference implementation: converter/wyrmfire-convert.js must produce the same
bytes. Design notes are in tools/reference/README.md.
"""
import struct

# round(65536*440*2**((n-69)/12)/8000) for every MIDI note, computed once with
# 60-digit decimal arithmetic. A table avoids platform-dependent pow().
PHASE = [67, 71, 75, 80, 84, 89, 95, 100, 106, 113, 119, 126, 134, 142, 150, 159, 169, 179, 189, 201, 213, 225, 239, 253, 268, 284, 301, 319, 338, 358, 379, 401, 425, 451, 477, 506, 536, 568, 601, 637, 675, 715, 758, 803, 851, 901, 955, 1011, 1072, 1135, 1203, 1274, 1350, 1430, 1515, 1606, 1701, 1802, 1909, 2023, 2143, 2271, 2406, 2549, 2700, 2861, 3031, 3211, 3402, 3604, 3819, 4046, 4286, 4541, 4811, 5098, 5401, 5722, 6062, 6422, 6804, 7209, 7638, 8092, 8573, 9083, 9623, 10195, 10801, 11444, 12124, 12845, 13609, 14418, 15275, 16184, 17146, 18165, 19246, 20390, 21602, 22887, 24248, 25690, 27217, 28836, 30551, 32367, 34292, 36331, 38491, 40780, 43205, 45774, 48496, 51380, 54435, 57672, 61101, 64734, 68584, 72662, 76982, 81560, 86410, 91548, 96992, 102759]


def mus_steps(data, ticks):
    """MUS lump -> [(channel, on, note) | delay], stopping after `ticks`
    (1/140 s)."""
    if data[:4] != b'MUS\x1a':
        raise ValueError('not a MUS lump')
    pos = struct.unpack_from('<H', data, 6)[0]
    time = 0; steps = []
    while time < ticks:
        b = data[pos]; pos += 1; kind = (b >> 4) & 7; ch = b & 15
        if kind == 6: break
        if kind in (0, 1):
            n = data[pos]; pos += 1
            if kind == 1 and n & 128: pos += 1
            steps.append((ch, kind == 1, n & 127))
        elif kind in (2, 3): pos += 1
        elif kind == 4: pos += 2
        if b & 128:
            delay = 0
            while 1:
                v = data[pos]; pos += 1; delay = delay * 128 + (v & 127)
                if v < 128: break
            delay = min(delay, ticks - time); time += delay
            steps.append(delay)
    return steps


def _varlen(data, pos):
    value = 0
    while True:
        v = data[pos]; pos += 1; value = value * 128 + (v & 127)
        if v < 128: return value, pos


def midi_steps(data, ticks):
    """Standard MIDI file (format 0 or 1). Times are converted to MUS ticks
    (1/140 s) with exact integer arithmetic over the tempo map."""
    if data[:4] != b'MThd':
        raise ValueError('not a MIDI lump')
    hlen, fmt, ntrk, division = struct.unpack_from('>IHHH', data, 4)
    if division & 0x8000:
        raise ValueError('SMPTE MIDI timing is not supported')
    pos = 8 + hlen; raw = []  # (tick, track, seq, kind, a, b)
    for track in range(ntrk):
        if data[pos:pos + 4] != b'MTrk':
            raise ValueError('bad MIDI track header')
        length = struct.unpack_from('>I', data, pos + 4)[0]
        p = pos + 8; end = p + length; tick = 0; status = 0; seq = 0
        if end > len(data):
            raise ValueError('truncated MIDI track')
        while p < end:
            delta, p = _varlen(data, p); tick += delta
            b = data[p]
            if b & 128: status = b; p += 1
            elif not status: raise ValueError('MIDI running status without status')
            if status == 0xFF:
                kind = data[p]; n, p = _varlen(data, p + 1)
                if kind == 0x51 and n == 3:
                    raw.append((tick, track, seq, 'tempo', int.from_bytes(data[p:p + 3], 'big'), 0))
                p += n
                if kind == 0x2F: break
                status = 0
            elif status in (0xF0, 0xF7):
                n, p = _varlen(data, p); p += n; status = 0
            else:
                hi = status & 0xF0; ch = status & 15
                if hi in (0xC0, 0xD0):
                    p += 1
                else:
                    a, v = data[p], data[p + 1]; p += 2
                    if hi == 0x90:
                        raw.append((tick, track, seq, 'on' if v else 'off', ch, a))
                    elif hi == 0x80:
                        raw.append((tick, track, seq, 'off', ch, a))
            seq += 1
        pos = end
    raw.sort(key=lambda e: (e[0], e[1], e[2]))
    # Elapsed time in microseconds is acc/division, acc an exact integer.
    acc = 0; tempo = 500000; last = 0; timed = []
    for tick, _, _, kind, a, b in raw:
        acc += (tick - last) * tempo; last = tick
        t = acc * 140 // (division * 1000000)
        if t >= ticks: break
        if kind == 'tempo': tempo = a; continue
        # MIDI percussion is channel 9; MUS keeps percussion on 15.
        timed.append((t, (15 if a == 9 else a, kind == 'on', b & 127)))
    steps = []; time = 0
    for t, ev in timed:
        if t > time: steps.append(t - time); time = t
        steps.append(ev)
    if timed: steps.append(ticks - time)
    return steps


def melody(data, channel, ticks):
    steps = midi_steps(data, ticks) if data[:4] == b'MThd' else mus_steps(data, ticks)
    # Use the requested channel; if it starts no note in the window, fall back
    # to the lowest non-percussion channel that does.
    played = sorted({s[0] for s in steps if isinstance(s, tuple) and s[1] and s[0] != 15})
    if channel not in played and played:
        channel = played[0]
    notes = []; parts = []; playing = 0; run = 0
    for s in steps:
        if isinstance(s, tuple):
            ch, on, n = s
            if ch == channel:
                if on: notes.append(n)
                elif n in notes: notes.remove(n)
            continue
        n = notes[-1] if notes else 0
        if run and n != playing: parts.append((playing, run)); run = 0
        playing = n; run += s
    if run: parts.append((playing, run))
    result = []
    for n, t in parts:
        phase = PHASE[n] if n else 0
        while t:
            span = min(t, 100); result.extend([(phase >> 8) & 255, phase & 255, span]); t -= span
    return result + [0, 0, 0]
