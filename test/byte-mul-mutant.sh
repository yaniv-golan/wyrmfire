#!/bin/sh
# The 8-bit product guard must catch a new byte*byte product: a copy of src/ with one added (the picture marker for
# the level, level*kills, both bytes) is built, and tools/check-byte-mul.mjs must FAIL on it, naming that line.
#   sh test/byte-mul-mutant.sh
# Needs the pinned CMOC + LWTOOLS (tools/versions.env).
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir -p "$work/m"; cp -R "$root/src" "$root/tools" "$work/m/"
python3 - "$work/m/src/native.c" <<'PY'
import sys
p=sys.argv[1];s=open(p).read();old='IO(0x206)=level;'
if s.count(old)!=1: sys.exit('mutant edit does not match exactly once in '+p+': '+old)
open(p,'w').write(s.replace(old,'IO(0x206)=level*kills;'))
PY
"$work/m/tools/build-engine.sh" "$work/b" >/dev/null
if out=$(node "$root/tools/check-byte-mul.mjs" "$work/b/native.s" 2>&1); then
  echo "MUTANT SURVIVED: the guard passed a build with level*kills: $out"; exit 1
fi
case "$out" in *"8-BIT PRODUCT native.c:"*"level*kills"*) echo "mutant killed: $(echo "$out" | grep '8-BIT PRODUCT')" ;;
  *) echo "MUTANT failed for the wrong reason: $out"; exit 1 ;; esac
