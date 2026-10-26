"""Catalogue deserializers: read a byte, compare to class id char, read version, compare to max+1.
Also lists version thresholds used for migrations inside each reader."""
import re
import os
RE = os.environ.get('PAXDAT_RE', os.path.join(os.path.dirname(__file__), '..', '..', 're-work'))
src = open(RE + '/out/decompiled.c').read()
RD = 'FUN_0814304c'
ESC = {'\\0': 0, '\\a': 7, '\\b': 8, '\\t': 9, '\\n': 10, '\\v': 11, '\\f': 12, '\\r': 13, "\\'": 39, '\\\\': 92}

def charval(lit):
    if lit in ESC: return ESC[lit]
    if lit.startswith('\\x'): return int(lit[2:], 16)
    return ord(lit)

funcs = re.split(r'^// ==== ', src, flags=re.M)[1:]
rows = []
for f in funcs:
    head, body = f.split('\n', 1)
    addr, name = head.split()[:2]
    first = body.find(RD)
    if first < 0:
        continue
    window = body[first:first + 600]
    cls = re.search(r"\(char\)\w+ != '(\\x[0-9a-f]{2}|\\.|.)'", window) or re.search(r"\w+ != '(\\x[0-9a-f]{2}|\\.|.)'", window)
    if not cls:
        continue
    vmax = re.search(r"\b\w+ < 0x([3-4][0-9a-f])\)", body[first:first + 1500])
    if not vmax:
        continue
    c = charval(cls.group(1))
    v = int(vmax.group(1), 16) - 0x31
    thresholds = sorted({int(x, 16) - 0x30 for x in re.findall(r"\b(?:uVar\d+|bVar\d+|param_\d+) [<>]=? 0x([3-4][0-9a-f])\b", body)}
                        | {int(x, 16) - 0x30 for x in re.findall(r"0x([3-4][0-9a-f]) [<>]=? (?:uVar\d+|bVar\d+|param_\d+)", body)})
    rows.append((c, v, addr, name, thresholds))
for c, v, a, n, t in sorted(rows):
    print(f'{c:#04x} max v{v:<3} {a} {n}  version thresholds {t}')
