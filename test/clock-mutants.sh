#!/bin/sh
# Mutants of the level clock: each must FAIL test/harness/clock.cjs, by name.
#   sh test/clock-mutants.sh CLOADM_DIR LEVEL_VDK
# Needs the pinned CMOC + LWTOOLS (tools/versions.env). Each mutant is one exact edit of a copy of src/; an edit
# that no longer matches the source is an error, so a mutant cannot silently stop mutating anything.
#   poll    -- readTrackPart no longer polls the field flag while it waits: fields that fall during a masked
#              transfer beyond the one the flag holds are lost, so the clock runs slow.
#   unmask  -- readTrackPart leaves IRQ unmasked: the interrupt delays a byte, the WD2797 flags Lost Data and
#              stops raising DRQ, and the unrolled DRQ waits spin for ever (the build that never reached the game).
set -eu
cloadm=$(CDPATH='' cd -- "$1" && pwd); vdk=$(CDPATH='' cd -- "$(dirname "$2")" && pwd)/$(basename "$2")
root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mutant() { # name file old new expected-message
  rm -rf "$work/m"; mkdir -p "$work/m"; cp -R "$root/src" "$root/tools" "$work/m/"
  python3 - "$work/m/src/$2" "$3" "$4" <<'EOF'
import sys
p,old,new=sys.argv[1],sys.argv[2].encode().decode('unicode_escape'),sys.argv[3].encode().decode('unicode_escape')
s=open(p).read()
if s.count(old)!=1: sys.exit('mutant edit does not match exactly once in '+p+': '+repr(old))
open(p,'w').write(s.replace(old,new))
EOF
  "$work/m/tools/build-engine.sh" "$work/b" >/dev/null
  cp "$vdk" "$work/b/wyrmfire.vdk"
  if out=$(node "$root/test/harness/clock.cjs" "$cloadm" "$work/b" 2>&1); then
    echo "MUTANT $1 SURVIVED: $out"; exit 1
  fi
  case "$out" in *"$5"*) echo "mutant $1 killed: $out" ;; *) echo "MUTANT $1 failed for the wrong reason: $out"; exit 1 ;; esac
}
mutant poll floppy.h '   lda <$03\n   bmi @fs\n' '' 'the clock counted'
mutant unmask floppy.h '   orcc #$50\n   ldy #0\n' '   ldy #0\n' 'no picture'
echo 'all clock mutants killed'
