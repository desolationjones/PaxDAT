"""Catalogue serializer functions: class id + version written at the start of each object.

Pattern in decompiled code:
    x = <class const>;  FUN_081434a8(param_1, &x, 1)     # class id
    FUN_081434a8(param_1, DAT_<pool>, 1)                 # version: pool -> pointer -> byte
"""
import re, struct, sys, json
import os
RE = os.environ.get('PAXDAT_RE', os.path.join(os.path.dirname(__file__), '..', '..', 're-work'))
BASE = 0x08020000
img = open(RE + '/carved/app_0x08020000.bin', 'rb').read()
src = open(RE + '/out/decompiled.c').read()

def u32(addr):
    return struct.unpack_from('<I', img, addr - BASE)[0]

def byte_at(addr):
    return img[addr - BASE] if BASE <= addr < BASE + len(img) else None

WR = 'FUN_081434a8'
funcs = re.split(r'^// ==== ', src, flags=re.M)[1:]
out = []
for f in funcs:
    head, body = f.split('\n', 1)
    addr, name = head.split()[:2]
    calls = list(re.finditer(WR + r'\((&?\w+),(&?)(\w+)(?:\[0\])?,1\)', body))
    for i, c in enumerate(calls[:-1]):
        nxt = calls[i + 1]
        if not nxt.group(3).startswith('DAT_') or nxt.group(1) != c.group(1):
            continue
        var = c.group(3)
        # last assignment to var (or var[0]) before the call
        pre = body[:c.start()]
        loose = False
        m = None
        for m in re.finditer(r'\b' + re.escape(var) + r'(?:\[0\]|\._\d+_\d+_)? = (?:CONCAT\d+\([^;]*?,)?(0x[0-9a-f]+|\d+)\)?;', pre):
            pass
        if not m:
            # fallback: last small constant assigned within the preceding few statements
            consts = re.findall(r'= (?:CONCAT\d+\([^;]*?,)?(0x[0-9a-f]+|\d+)\)?;', pre[-250:])
            if not consts:
                continue
            cls = int(consts[-1], 0)
            loose = True
        else:
            cls = int(m.group(1), 0)
        pool = int(nxt.group(3)[4:], 16)
        ver = byte_at(u32(pool))
        if ver is None or not (0x30 <= ver <= 0x7f) or cls > 0xff:
            continue
        out.append((addr, name, cls, ver - 0x30, loose))
        break  # first object header in this function
for a, n, c, v, l in sorted(out, key=lambda x: x[2]):
    print(f'{c:#04x} v{v:<3} {a} {n}' + ('   (loose match - verify)' if l else ''))
print(len(out), 'writer functions', file=sys.stderr)
