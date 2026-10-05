#!/usr/bin/env python3
"""Exploratory structural parser for Squarp Hapax project files.

This is a *probe*, not a finished library: it walks project.dat strictly,
asserting every class/version marker it expects, and fails loudly on the first
byte that doesn't match the current hypothesis (see docs/FORMAT.md).
Field names prefixed with `u_` are not yet understood.

Usage: paxdat_probe.py <project_dir> [--dump]
"""
import json
import struct
import sys
from pathlib import Path


class ParseError(Exception):
    pass


class Reader:
    def __init__(self, data, name):
        self.d = data
        self.p = 0
        self.name = name

    def fail(self, msg):
        ctx = self.d[self.p:self.p + 16].hex(" ")
        raise ParseError(f"{self.name}@{self.p} (0x{self.p:x}): {msg}  next: {ctx}")

    def raw(self, n):
        if self.p + n > len(self.d):
            self.fail(f"read {n} past EOF")
        b = self.d[self.p:self.p + n]
        self.p += n
        return b

    def u8(self):
        return self.raw(1)[0]

    def u16(self):
        return struct.unpack("<H", self.raw(2))[0]

    def u32(self):
        return struct.unpack("<I", self.raw(4))[0]

    def f32(self):
        return struct.unpack("<f", self.raw(4))[0]

    def cstr(self):
        end = self.d.find(b"\0", self.p)
        if end < 0:
            self.fail("unterminated string")
        s = self.d[self.p:end].decode("ascii")
        self.p = end + 1
        return s

    def tag(self, cls, ver):
        """Object header: class id byte, then version stored as 0x30 + n."""
        c, v = self.d[self.p], self.d[self.p + 1] if self.p + 1 < len(self.d) else None
        if c != cls or v != 0x30 + ver:
            self.fail(f"expected tag {cls:02x} v{ver} ({cls:02x} {0x30 + ver:02x})")
        self.p += 2

    def peek_tag(self):
        return self.d[self.p], self.d[self.p + 1] - 0x30

    def val(self, width=1):
        """Generic scalar wrapper: tag 0e v1 followed by a little-endian int.
        The width is NOT encoded in the stream; callers must know it."""
        self.tag(0x0E, 1)
        return self.u8() if width == 1 else self.u16()

    def optstr(self):
        """u8 presence flag, then a C string if present."""
        return self.cstr() if self.u8() else None

    def eof(self):
        return self.p >= len(self.d)


# ---------------------------------------------------------------- project.dat

# Widths of the 16 `0e 31` values in the per-track settings block (tag 2b v3).
TRACK_SETTING_WIDTHS = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 1]

FX_TYPES = {0: "mod_depth", 1: "arp", 2: "chance", 3: "euclid", 9: "groove",
            0x12: "unknown_0x12 (T1-T8/SPEED/LOOP/SHIFT)"}


def parse_fx_slot(r):
    r.tag(0x10, 5)
    if not r.u8():
        return None
    fx = {"slot": r.u8(), "type": r.u8()}
    fx["type_name"] = FX_TYPES.get(fx["type"], f"unknown_{fx['type']}")
    fx["u_hdr"] = r.raw(5).hex(" ")
    params = []
    while True:
        r.tag(0x18, 4)
        idx = r.u8()
        body = r.raw(20)
        name = r.cstr()
        a, b = struct.unpack_from("<HH", body)
        p = {"idx": idx, "name": name, "value": a, "u_value2": b}
        if any(body[4:]):
            p["u_rest"] = body[4:].hex(" ")
        params.append(p)
        if idx == 0xFF:  # ON/OFF param terminates the list
            break
    fx["params"] = params
    if fx["type"] == 0:
        # Mod-depth slot carries 4 modulation routings (float depth + u16).
        fx["mod_routes"] = []
        for _ in range(4):
            r.tag(0x11, 3)
            u0 = r.u8()
            fx["mod_routes"].append({"u0": u0, "u_f32": r.f32(), "u_rest": r.raw(5).hex(" ")})
    return fx


def parse_track(r, i):
    t = {}
    if r.u8() != i:
        r.p -= 1
        r.fail(f"expected track index {i}")
    r.tag(0x0C, 18)
    t["u_a"] = r.val()
    t["u_b"] = r.raw(3).hex(" ")

    r.tag(0x2C, 4)
    t["midi_channel_0based"] = r.val()
    t["u_out"] = r.raw(11).hex(" ")

    r.tag(0x2B, 3)
    t["u_c"] = r.val()
    t["u_d"] = r.raw(13).hex(" ")
    t["settings"] = [r.val(w) for w in TRACK_SETTING_WIDTHS]

    t["index_again"] = r.u8()
    t["u_e"] = r.u8()
    t["instrument_name"] = r.optstr()
    t["u_f"] = r.val()
    t["u_g"] = r.raw(3).hex(" ")
    t["instrument_file"] = r.optstr()
    t["u_h"] = r.raw(3).hex(" ")

    t["patterns"] = []
    for n in range(16):
        r.tag(0x0B, 5)
        body = r.raw(21)
        if body[0] != n:
            r.fail(f"pattern index {body[0]} != {n}")
        t["patterns"].append(body[1:].hex(" "))

    r.tag(0x12, 2)
    cls, ver = r.peek_tag()  # observed: 14 v1 (most tracks) or 13 v2 (track 16)
    r.p += 2
    t["fx_chain_kind"] = f"{cls:02x} v{ver}"
    t["u_fx_chain_val"] = r.val()
    t["fx"] = [parse_fx_slot(r) for _ in range(8)]

    t["cc_slots"] = []
    for _ in range(8):
        if r.u8():
            r.tag(0x16, 1)
            t["cc_slots"].append(r.raw(8).hex(" "))
        else:
            t["cc_slots"].append(None)

    t["u_i"] = r.val()
    t["u_j"] = r.val()
    r.tag(0x2D, 3)
    t["lane_names"] = [r.cstr() for _ in range(16)]
    t["lane_records"] = [r.raw(7).hex(" ") for _ in range(16)]
    t["u_lane_tail"] = r.u8()

    r.tag(0x1F, 1)
    t["u_k"] = r.u32()
    t["u_l"] = r.val()
    t["u_m"] = []
    for _ in range(8):
        r.tag(0x2A, 1)
        t["u_m"].append(r.u8())
    return t


def parse_project(data):
    r = Reader(data, "project.dat")
    out = {}
    r.tag(0x0F, 1)
    r.tag(0x0D, 12)
    out["tempo_x10?"] = r.u16()
    out["globals"] = [r.val() for _ in range(8)]
    out["tracks"] = [parse_track(r, i) for i in range(16)]
    out["track_order?"] = list(r.raw(16))
    r.tag(0x1C, 1)
    out["u_1c"] = r.u32()
    r.tag(0x1E, 1)
    out["u_1e"] = r.u32()
    out["u_24"] = []
    for _ in range(2):
        r.tag(0x24, 2)
        out["u_24"].append([r.val(w) for w in (1, 1, 1, 1, 2, 1)])
    out["u_25"] = []
    for _ in range(16):
        r.tag(0x25, 1)
        out["u_25"].append(r.u32())
    rest = r.raw(len(data) - r.p)
    if any(rest):
        r.fail("non-zero trailing bytes")
    out["trailing_zero_bytes"] = len(rest)
    return out


# ------------------------------------------------------------- notes / autom

def parse_notes(data):
    """Hypothesis only; validated against a single sample."""
    r = Reader(data, "notes.dat")
    r.tag(0x05, 2)
    out = {"tracks": []}
    for _ in range(r.u8()):
        trk = {"track": r.u8(), "patterns": []}
        for _ in range(r.u8()):
            pat = {"pattern": r.u8()}
            r.tag(0x00, 1)  # ??? could also be u8 0 + u8 '1'
            pat["notes"] = []
            for _ in range(r.u32()):
                b = r.raw(13)
                pat["notes"].append({"raw": b.hex(" "), "pitch?": b[4], "velocity?": b[5]})
            trk["patterns"].append(pat)
        out["tracks"].append(trk)
    if not r.eof():
        r.fail("unconsumed bytes")
    return out


def parse_autom(data):
    """Hypothesis only; validated against a single sample."""
    r = Reader(data, "autom.dat")
    r.tag(0x07, 1)
    out = {"tracks": []}
    for _ in range(r.u8()):
        trk = {"track": r.u8()}
        r.tag(0x17, 3)
        trk["lanes"] = []
        for _ in range(r.u8()):
            lane = {}
            r.tag(0x2E, 2)
            r.tag(0x16, 1)
            lane["target"] = r.raw(8).hex(" ")
            lane["u_flag"] = r.u8()
            lane["u_val"] = r.u16()
            lane["patterns"] = []
            # 17 records in the only sample (16 patterns + 1?); unconfirmed.
            for _ in range(17):
                r.tag(0x03, 4)
                hdr = r.raw(4).hex(" ")
                pts = [(r.u16(), r.u16()) for _ in range(r.u32())]
                lane["patterns"].append({"u_hdr": hdr, "points(pos,val)?": pts})
            lane["u_tail_flag"] = r.u8()
            lane["u_tail_u16s"] = [r.u16() for _ in range(8)]
            trk["lanes"].append(lane)
        out["tracks"].append(trk)
    if not r.eof():
        r.fail("unconsumed bytes")
    return out


def parse_empty(name, cls):
    def f(data):
        r = Reader(data, name)
        r.tag(cls, 2)
        n = r.u8()
        if n or not r.eof():
            r.fail("non-empty file: layout not yet known")
        return {"count": 0}
    return f


PARSERS = {
    "project.dat": parse_project,
    "notes.dat": parse_notes,
    "autom.dat": parse_autom,
    "drums.dat": parse_empty("drums.dat", 0x06),
    "mpe.dat": parse_empty("mpe.dat", 0x26),
}


def main():
    root = Path(sys.argv[1])
    dump = "--dump" in sys.argv
    ok = True
    results = {}
    for name, fn in PARSERS.items():
        path = root / name
        if not path.exists():
            continue
        try:
            results[name] = fn(path.read_bytes())
            print(f"OK   {name} ({path.stat().st_size} bytes fully consumed)")
        except ParseError as e:
            ok = False
            print(f"FAIL {e}")
    if dump:
        print(json.dumps(results, indent=1))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
