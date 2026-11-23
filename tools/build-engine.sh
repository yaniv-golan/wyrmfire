#!/bin/sh
# Build the WYRMFIRE engine: build/wyrmfire.bin (+ build/engine.map).
# Needs exactly the CMOC and LWTOOLS versions in tools/versions.env, and Python 3.
# No WAD and no level data are involved.
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
. "$root/tools/versions.env"
out=${1:-"$root/build"}
mkdir -p "$out"
if [ "${WYRMFIRE_SKIP_VERSION_CHECK:-}" != 1 ]; then
    cmoc --version | grep -q "$CMOC_VERSION" || { echo "need CMOC $CMOC_VERSION, have: $(cmoc --version | head -1)" >&2; exit 1; }
    lwasm --version | grep -q "lwtools $LWTOOLS_VERSION" || { echo "need LWTOOLS $LWTOOLS_VERSION, have: $(lwasm --version)" >&2; exit 1; }
fi
cd "$out"
cmoc --intermediate --void-target --raw --org=1C00 --limit=5000 -I"$root/src" -o engine.raw "$root/src/native.c" > compile.log 2>&1 || { cat compile.log >&2; exit 1; }
python3 "$root/tools/pack.py" .
ls -l wyrmfire.bin
