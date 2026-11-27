#!/bin/sh
# Mutants of the two timing rules that do not depend on how fast pictures are drawn; each must FAIL its harness,
# by name.
#   sh test/pacing-mutants.sh CLOADM_DIR LEVEL_VDK
# Needs the pinned CMOC + LWTOOLS (tools/versions.env). Each mutant is one exact edit of a copy of src/; an edit
# that no longer matches the source is an error.
#   per-picture -- audioSlice() sends its four samples on every call, credit or not: the effects are paced by the
#                  pictures drawn again (128 samples a picture) and play as fast as the renderer runs.
#   no-cap      -- audioSlice() credits every field it missed, however many: after a picture of ten fields the
#                  credit passes the 144 samples the cap allows and the effect runs ahead.
#   slow-load   -- loadArea() idles for an empty 600-pass loop before it unpacks a region: the unpack total of the
#                  regions probe rises past its limit.
#   slowread20  -- diskRead() idles for an empty 20-pass loop after each part of a transfer: the net read (first
#                  byte to checksum) rises past its limit, though the whole read stays inside its 5%.
set -eu
cloadm=$(CDPATH='' cd -- "$1" && pwd); vdk=$(CDPATH='' cd -- "$(dirname "$2")" && pwd)/$(basename "$2")
root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mutant() { # name file old new expected-message harness
  rm -rf "$work/m" "$work/b"; mkdir -p "$work/m"; cp -R "$root/src" "$root/tools" "$work/m/"
  python3 - "$work/m/src/$2" "$3" "$4" <<'EOF'
import sys
p,old,new=sys.argv[1],sys.argv[2].encode().decode('unicode_escape'),sys.argv[3].encode().decode('unicode_escape')
s=open(p).read()
if s.count(old)!=1: sys.exit('mutant edit does not match exactly once in '+p+': '+repr(old))
open(p,'w').write(s.replace(old,new))
EOF
  "$work/m/tools/build-engine.sh" "$work/b" >/dev/null
  cp "$vdk" "$work/b/wyrmfire.vdk"
  if out=$(node "$root/test/harness/$6" "$cloadm" "$work/b" 2>&1); then
    echo "MUTANT $1 SURVIVED: $out"; exit 1
  fi
  case "$out" in *"$5"*) echo "mutant $1 killed: $(echo "$out" | grep -m1 "$5")" ;; *) echo "MUTANT $1 failed for the wrong reason: $out"; exit 1 ;; esac
}
mutant per-picture native.c '    suba #4\n    bcs @done\n    sta _audioCredit\n' '' 'paced by the pictures drawn' sound.cjs
mutant slow-load scene.h ' unpackTarget=AREA;length=' ' {word q;for(q=0;q<600;q++){}}unpackTarget=AREA;length=' 'the load path got slower' regions-limits.cjs
mutant slowread20 floppy.h '    readTrackPart();if(diskError)' '    readTrackPart();{byte q;for(q=0;q<20;q++){}}if(diskError)' 'from the first byte to the last' regions-limits.cjs
mutant no-cap native.c '    cmpa #116\n    bhs @have\n' '' 'the four-field cap allows' sound.cjs
echo 'all pacing mutants killed'
