"""Package the CMOC memory image (engine.raw, org $1C00) as a self-extracting
DragonDOS/CLOADM binary: a small loader at $0C00 copies the LZ stream to the
top of RAM and unpacks it to $1C00.

    python3 tools/pack.py BUILD_DIR   ->  BUILD_DIR/wyrmfire.bin
"""
from pathlib import Path
import struct,sys,subprocess
from collections import defaultdict,deque
out=Path(sys.argv[1]).resolve()
raw=(out/'engine.raw').read_bytes()
ORG=0x1c00
seen=defaultdict(lambda:deque(maxlen=32))
stream=bytearray(); buf=bytearray()
def flush():
    if buf:stream.append(len(buf)-1);stream.extend(buf);buf.clear()
i=0
while i<len(raw):
    best=0;distance=0
    for j in reversed(seen[raw[i:i+3]]):
        if i-j>32767:break
        n=0
        while n<130 and i+n<len(raw) and raw[i+n]==raw[j+n]:n+=1
        if n>best:best=n;distance=i-j
    if best>=4:
        flush(); stream.append(128|best-3);stream.extend(struct.pack('>h',-distance));step=best
    else:
        buf.append(raw[i]);step=1
        if len(buf)==128:flush()
    for j in range(i,i+step):seen[raw[j:j+3]].append(j)
    i+=step
flush()
# Bytes already consumed from the high-memory input can be overwritten.
src=0xfe00-len(stream)
written=0
i=0
while i<len(stream):
    ctl=stream[i];i+=1
    if ctl&128:
        i+=2;written+=(ctl&127)+3
    else:
        i+=ctl+1;written+=ctl+1
    if ORG+written>src+i:raise ValueError('Loader catches unread input')
assert written==len(raw)
(out/'packed.inc').write_text('image_start equ $%x\nimage_end equ $%x\n'%(ORG,ORG+len(raw))+'\n'.join(' fcb '+','.join(map(str,stream[i:i+32])) for i in range(0,len(stream),32))+'\n')
subprocess.run(['lwasm','--format=raw','-I'+str(out),'-o',str(out/'load.raw'),str(Path(__file__).resolve().parent.parent/'src'/'loader.asm')],check=True)
data=(out/'load.raw').read_bytes()
if len(data)>0x8000-0x0c00:raise ValueError('Loader too large for ROM mode')
(out/'wyrmfire.bin').write_bytes(struct.pack('>BBHHHB',85,2,0x0c00,len(data),0x0c00,170)+data)
