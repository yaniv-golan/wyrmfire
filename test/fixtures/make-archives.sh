#!/bin/sh
# Build archive fixtures from a Freedoom WAD (never from an id WAD):
#   test/fixtures/make-archives.sh freedoom1.wad OUTDIR
# Needs python3, java + jlha (apt: jlha-utils) and lhasa (apt: lhasa).
# Every LHA fixture is encoded by jlha and checked by lhasa, both independent
# of the converter. The WAD is stored as DOOM1.WAD, as in the shareware set.
set -eu
wad=$1; out=$2
here=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
jar=${JLHA_JAR:-/usr/share/java/jlha.jar}
mkdir -p "$out/src" "$out/classes"
cp "$wad" "$out/src/DOOM1.WAD"
javac -cp "$jar" -d "$out/classes" "$here/MkLzh.java"
lzh() { java -cp "$jar:$out/classes" MkLzh "$out/$1" "$2" "$3" "DOOM1.WAD=$out/src/DOOM1.WAD" "README.TXT=$here/make-archives.sh"; lhasa t "$out/$1" >/dev/null; }
lzh lh0.lzh -lh0- 1
lzh lh1.lzh -lh1- 1
lzh lh5.lzh -lh5- 1
lzh lh5-level0.lzh -lh5- 0
lzh lh5-level2.lzh -lh5- 2
lzh lh6.lzh -lh6- 2
lzh lh7.lzh -lh7- 2
python3 -I - "$out" <<'PY'
import sys, zipfile, os, random
out = sys.argv[1]; src = os.path.join(out, 'src', 'DOOM1.WAD')
with zipfile.ZipFile(os.path.join(out, 'store.zip'), 'w', zipfile.ZIP_STORED) as z: z.write(src, 'DOOM1.WAD')
with zipfile.ZipFile(os.path.join(out, 'deflate.zip'), 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z: z.write(src, 'DOOM1.WAD')
with zipfile.ZipFile(os.path.join(out, 'nowad.zip'), 'w', zipfile.ZIP_DEFLATED) as z: z.writestr('README.TXT', 'no wad here\n')
# The shareware download's split parts form a PKZIP self-extractor: an "MZ"
# stub (PKLITE banner at 0x1E) followed by a zip. Two offset conventions:
# archive-relative (stub + standalone zip) and file-relative (zip appended to
# the stub, offsets counted from the file start), each split at an arbitrary
# byte into DOOMS_19.1 + DOOMS_19.2 and zipped like doom19s.zip.
import io
rnd = random.Random(1995)
def stub():
    s = bytearray(b'MZ' + bytes(28) + b'PKLITE Copr. 1990-92 PKWARE Inc. All Rights Reserved')
    return bytes(s + bytes(rnd.randrange(256) for _ in range(15769 - len(s))))
inner = io.BytesIO()
with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(src, 'DOOM1.WAD'); z.writestr('README.TXT', 'Freedoom fixture\r\n')
sfx = {'archive': stub() + inner.getvalue()}
fp = os.path.join(out, 'sfx-file.exe'); open(fp, 'wb').write(stub())
with zipfile.ZipFile(fp, 'a', zipfile.ZIP_DEFLATED) as z:  # appends; offsets from the file start
    z.write(src, 'DOOM1.WAD'); z.writestr('README.TXT', 'Freedoom fixture\r\n')
sfx['file'] = open(fp, 'rb').read()
open(os.path.join(out, 'sfx-archive.exe'), 'wb').write(sfx['archive'])
for kind, data in sfx.items():
    cut = 1439232 if len(data) > 1439232 else len(data) // 2
    d = os.path.join(out, 'zipsplit-' + kind); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'DOOMS_19.1'), 'wb').write(data[:cut])
    open(os.path.join(d, 'DOOMS_19.2'), 'wb').write(data[cut:])
    open(os.path.join(d, 'DOOMS_19.DAT'), 'wb').write(b'DOOMS_19.1\r\nDOOMS_19.2\r\n')
    with zipfile.ZipFile(os.path.join(out, 'shareware-like-zip-' + kind + '.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('DEICE.EXE', b'MZ' + bytes(200))
        z.writestr('INSTALL.BAT', b'@echo off\r\ndeice\r\n')
        for n in ('DOOMS_19.1', 'DOOMS_19.2', 'DOOMS_19.DAT'): z.write(os.path.join(d, n), n)
# The same layout with an LHA archive behind the stub (LHA input support).
rnd = random.Random(1993)
for method in ('lh5', 'lh1'):
    stub = bytearray(b'MZ' + bytes(28) + b'PKLITE Copr. 1990-92 PKWARE Inc. All Rights Reserved')
    stub += bytes(rnd.randrange(256) for _ in range(30000 - len(stub)))
    sfx = bytes(stub) + open(os.path.join(out, method + '.lzh'), 'rb').read()
    cut = len(sfx) // 2
    d = os.path.join(out, 'split-' + method); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'DOOMS_19.1'), 'wb').write(sfx[:cut])
    open(os.path.join(d, 'DOOMS_19.2'), 'wb').write(sfx[cut:])
    open(os.path.join(d, 'DOOMS_19.DAT'), 'wb').write(b'DOOMS_19.1\r\nDOOMS_19.2\r\n')
    with zipfile.ZipFile(os.path.join(out, 'shareware-like-' + method + '.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('DEICE.EXE', b'MZ' + bytes(200))
        z.writestr('INSTALL.BAT', b'@echo off\r\ndeice\r\n')
        for n in ('DOOMS_19.1', 'DOOMS_19.2', 'DOOMS_19.DAT'): z.write(os.path.join(d, n), n)
PY
ls -l "$out" "$out"/split-*
