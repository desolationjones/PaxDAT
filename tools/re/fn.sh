#!/bin/sh
# usage: fn.sh <hex address without 0x> [...]  -> print decompiled function(s)
# Address must be the bare 8-digit hex entry point, e.g. 0806c344. Set SRC to choose the export file.
for a in "$@"; do
  awk -v a="$a" '/^\/\/ ==== /{p = ($3 == a)} p' ${SRC:-${PAXDAT_RE:-re-work}/out/decompiled.c}
done
