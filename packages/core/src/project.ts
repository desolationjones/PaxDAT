// project.dat codec (docs/FORMAT.md §3). Every reader has a mirror-image writer
// so that unknown fields round-trip byte for byte. Field names prefixed `f_0x..`
// are in-memory struct offsets from the firmware; `u_` fields are not understood yet.

import { Reader, Writer } from './bytes';

// ------------------------------------------------------------------ shared

/** `16 31` target: CC knob, automation lane or mod destination (FORMAT §3.5). */
export interface Target {
  bytes: Uint8Array; // 8 bytes; byte 0 = target type, byte 5 = CC number for CC targets
}

export const readTarget = (r: Reader): Target => {
  r.tag(0x16, 1);
  return { bytes: r.raw(8) };
};
export const writeTarget = (w: Writer, t: Target): void => {
  w.tag(0x16, 1);
  w.raw(t.bytes);
};

/** MIDI port: kind 0 = DIN A–D, 1 = USB device cable, 2 = USB host cable. */
export interface Port {
  kind: number;
  index: number;
}
const readPort = (r: Reader): Port => ({ kind: r.u32(), index: r.u8() });
const writePort = (w: Writer, p: Port): void => {
  w.u32(p.kind);
  w.u8(p.index);
};

// ------------------------------------------------------------------ track parts

export interface TrackOutput {
  channel: number; // 0-based MIDI channel
  outType: number; // 0 = MIDI port; other values = CV/gate (not captured yet)
  port: Port | null; // when outType == 0
  u_portCode: number; // u16 derived by the firmware from the port (0x0f00 seen)
  u_cvIndex: number; // when outType != 0
}

const readOutput = (r: Reader): TrackOutput => {
  r.tag(0x2c, 4);
  const channel = r.val();
  const outType = r.u32();
  if (outType === 0) return { channel, outType, port: readPort(r), u_portCode: r.u16(), u_cvIndex: 0 };
  return { channel, outType, port: null, u_cvIndex: r.u8(), u_portCode: r.u16() };
};
const writeOutput = (w: Writer, o: TrackOutput): void => {
  w.tag(0x2c, 4);
  w.val(o.channel);
  w.u32(o.outType);
  if (o.outType === 0) {
    writePort(w, o.port ?? { kind: 0, index: 0 });
  } else {
    w.u8(o.u_cvIndex);
  }
  w.u16(o.u_portCode);
};

export interface TrackInput {
  channel: number; // 0-based; 16 = ALL?
  u_modeA: number;
  u_portA: Port | null;
  mode: number; // 0 = ––, 1 = ALL ACTIVE, 2 = specific port
  port: Port | null;
}

const readInput = (r: Reader): TrackInput => {
  r.tag(0x2b, 3);
  const channel = r.val();
  const u_modeA = r.u32();
  const u_portA = u_modeA === 2 ? readPort(r) : null;
  const mode = r.u32();
  const port = mode === 2 ? readPort(r) : null;
  return { channel, u_modeA, u_portA, mode, port };
};
const writeInput = (w: Writer, i: TrackInput): void => {
  w.tag(0x2b, 3);
  w.val(i.channel);
  w.u32(i.u_modeA);
  if (i.u_modeA === 2) writePort(w, i.u_portA ?? { kind: 0, index: 0 });
  w.u32(i.mode);
  if (i.mode === 2) writePort(w, i.port ?? { kind: 0, index: 0 });
};

/** Pattern header: unpacked bitfields (FORMAT §3.2). Meanings marked 🟡 are inferred. */
export interface PatternHeader {
  index: number;
  run: number; // RUN_MODE
  trig: number; // TRIG_MODE 🟡
  viewNote: number; // piano-roll scroll (UI state) 🟡
  length: number; // in 16th steps
  u_flag6: number; // 1 bit (mute? 🟡)
  loopStart: number; // 🟡
  loopEnd: number; // 🟡 0xffff = none
  pc: number; // 0xff = none
  msb: number;
  lsb: number;
  u_flag14: number;
  follow1: number; // 🟡 4 bits
  follow2: number; // 🟡 4 bits
  u_nibble17: number; // 🟡 colour?
  followChance: number; // 🟡 7 bits
  followLength: number; // 🟡 10 bits
}

const readPattern = (r: Reader): PatternHeader => {
  r.tag(0x0b, 5);
  return {
    index: r.u8(), run: r.u8(), trig: r.u8(), viewNote: r.u8(), length: r.u16(), u_flag6: r.u8(),
    loopStart: r.u16(), loopEnd: r.u16(), pc: r.u8(), msb: r.u8(), lsb: r.u8(), u_flag14: r.u8(),
    follow1: r.u8(), follow2: r.u8(), u_nibble17: r.u8(), followChance: r.u8(), followLength: r.u16(),
  };
};
const writePattern = (w: Writer, p: PatternHeader): void => {
  w.tag(0x0b, 5);
  w.u8(p.index); w.u8(p.run); w.u8(p.trig); w.u8(p.viewNote); w.u16(p.length); w.u8(p.u_flag6);
  w.u16(p.loopStart); w.u16(p.loopEnd); w.u8(p.pc); w.u8(p.msb); w.u8(p.lsb); w.u8(p.u_flag14);
  w.u8(p.follow1); w.u8(p.follow2); w.u8(p.u_nibble17); w.u8(p.followChance); w.u16(p.followLength);
};

export interface FxParam {
  idx: number; // 0xff = ON/OFF (always last)
  value: number; // stored value
  liveValue: number; // runtime value (automation/modulation applied)
  locks: (number | null)[]; // 16 per-pattern locked values
  name: string;
}

export interface ModRoute {
  source: Uint8Array | null; // `15 31` + 8 bytes
  target: Target | null;
  depth: number; // f32
  u_a: number;
  u_b: number;
}

export interface FxSlot {
  position: number; // order in the chain
  type: number; // FX_TYPE
  u_hdr: Uint8Array; // 3 bytes
  liveOff: number; // 1 when the live ON/OFF value is 0
  u_subVersion: number; // 0x31 or 0x32
  params: FxParam[];
  modRoutes: ModRoute[]; // only for type 0 (ModMatrix)
}

const readFxSlot = (r: Reader): FxSlot | null => {
  r.tag(0x10, 5);
  if (!r.u8()) return null;
  const slot: FxSlot = {
    position: r.u8(), type: r.u8(), u_hdr: r.raw(3), liveOff: r.u8(), u_subVersion: r.u8(),
    params: [], modRoutes: [],
  };
  for (;;) {
    r.tag(0x18, 4);
    const idx = r.u8();
    const value = r.u16();
    const liveValue = r.u16();
    const locks: (number | null)[] = [];
    for (let i = 0; i < 16; i++) locks.push(r.u8() ? r.u16() : null);
    slot.params.push({ idx, value, liveValue, locks, name: r.cstr() });
    if (idx === 0xff) break;
  }
  if (slot.type === 0) {
    for (let i = 0; i < 4; i++) {
      r.tag(0x11, 3);
      let source: Uint8Array | null = null;
      if (r.u8()) {
        r.tag(0x15, 1);
        source = r.raw(8);
      }
      const target = r.u8() ? readTarget(r) : null;
      slot.modRoutes.push({ source, target, depth: r.f32(), u_a: r.u16(), u_b: r.u16() });
    }
  }
  return slot;
};
const writeFxSlot = (w: Writer, s: FxSlot | null): void => {
  w.tag(0x10, 5);
  if (!s) {
    w.u8(0);
    return;
  }
  w.u8(1);
  w.u8(s.position); w.u8(s.type); w.raw(s.u_hdr); w.u8(s.liveOff); w.u8(s.u_subVersion);
  for (const p of s.params) {
    w.tag(0x18, 4);
    w.u8(p.idx); w.u16(p.value); w.u16(p.liveValue);
    for (const l of p.locks) {
      if (l === null) w.u8(0);
      else { w.u8(1); w.u16(l); }
    }
    w.cstr(p.name);
  }
  if (s.type === 0) {
    for (const m of s.modRoutes) {
      w.tag(0x11, 3);
      if (m.source) { w.u8(1); w.tag(0x15, 1); w.raw(m.source); } else w.u8(0);
      if (m.target) { w.u8(1); writeTarget(w, m.target); } else w.u8(0);
      w.f32(m.depth); w.u16(m.u_a); w.u16(m.u_b);
    }
  }
};

export interface FxChain {
  /** 0x13 v2 on track 16 (value = TR16 TRSP mode), 0x14 v1 elsewhere. */
  headClass: number;
  headVersion: number;
  headValue: number;
  slots: (FxSlot | null)[]; // 8
  ccKnobs: (Target | null)[]; // 8 assignable CC knobs
  quantize: number; // 🟡
  strength: number; // %
}

const readFxChain = (r: Reader): FxChain => {
  r.tag(0x12, 2);
  const head = r.peekTag();
  if (!head || !((head.cls === 0x13 && head.version === 2) || (head.cls === 0x14 && head.version === 1))) {
    r.fail('expected FX chain head 13 v2 or 14 v1');
  }
  r.pos += 2;
  const headValue = r.val();
  const slots = Array.from({ length: 8 }, () => readFxSlot(r));
  const ccKnobs = Array.from({ length: 8 }, () => (r.u8() ? readTarget(r) : null));
  return { headClass: head.cls, headVersion: head.version, headValue, slots, ccKnobs, quantize: r.val(), strength: r.val() };
};
const writeFxChain = (w: Writer, c: FxChain): void => {
  w.tag(0x12, 2);
  w.tag(c.headClass, c.headVersion);
  w.val(c.headValue);
  c.slots.forEach((s) => writeFxSlot(w, s));
  for (const t of c.ccKnobs) {
    if (t) { w.u8(1); writeTarget(w, t); } else w.u8(0);
  }
  w.val(c.quantize);
  w.val(c.strength);
};

export interface DrumLane {
  name: string;
  record: Uint8Array; // 7 bytes: output note, index/channel bytes (FORMAT §3.6)
}

// ------------------------------------------------------------------ track

export interface Track {
  version: number; // 18 (OS 3.10) or 19 (OS 3.22)
  type: number; // TRACK_TYPE
  output: TrackOutput;
  input: TrackInput;
  // the 16 scalar track fields, by firmware struct offset (FORMAT §3.1)
  f_0x18: number; // 🟡 root/range for live mode (60 default)
  f_0x19: number; // live-mode scale (scale enum; remapped < v18)
  f_0x1a: number;
  f_0x1b: number;
  f_0x1d: number;
  f_0x1c: number;
  f_0x1e: number;
  f_0x2b: number;
  lastMicroTime: number; // @0x2e, signed 16-bit 🟡
  newNoteLength: number; // @0x36, ticks
  newVelocity: number; // @0x3f
  newChance: number; // @0x40
  newMath: number; // @0x41
  newRoll: number; // @0x42
  elasticity: number; // @0x48, ×100 (10000 = 100.00 %)
  f_0x14: number;
  indexAgain: number;
  monoEdit: number;
  name: string | null; // track name (instrument definitions set it)
  f_0x4a: number;
  u_0x284: number;
  u_0x280: number;
  instrumentFile: string | null;
  pScale: number; // follow the project scale
  pTrsp: number; // transposed by track 16
  u_0x289: number;
  patterns: PatternHeader[]; // 16
  fx: FxChain;
  lanes: DrumLane[]; // 16, highest lane first
  u_laneTail: number;
  u_1f: { a: number; b: number };
  u_2a: number[]; // 8
  aftr: number | null; // v19+: 1 = AFTR track
}

const SCALARS: [keyof Track, 1 | 2][] = [
  ['f_0x18', 1], ['f_0x19', 1], ['f_0x1a', 1], ['f_0x1b', 1], ['f_0x1d', 1], ['f_0x1c', 1], ['f_0x1e', 1], ['f_0x2b', 1],
  ['lastMicroTime', 2], ['newNoteLength', 2], ['newVelocity', 1], ['newChance', 1], ['newMath', 1], ['newRoll', 1],
  ['elasticity', 2], ['f_0x14', 1],
];

const readTrack = (r: Reader): Track => {
  const version = r.tag(0x0c, [18, 19]);
  const t = { version, type: r.val(4), output: readOutput(r), input: readInput(r) } as Partial<Track>;
  for (const [k, width] of SCALARS) (t as Record<string, unknown>)[k] = r.val(width);
  if (t.lastMicroTime! >= 0x8000) t.lastMicroTime! -= 0x10000;
  t.indexAgain = r.u8();
  t.monoEdit = r.u8();
  t.name = r.optStr();
  t.f_0x4a = r.val();
  t.u_0x284 = r.u16();
  t.u_0x280 = r.u8();
  t.instrumentFile = r.optStr();
  t.pScale = r.u8();
  t.pTrsp = r.u8();
  t.u_0x289 = r.u8();
  t.patterns = [];
  for (let i = 0; i < 16; i++) {
    const p = readPattern(r);
    if (p.index !== i) r.fail(`pattern index ${p.index}, expected ${i}`);
    t.patterns.push(p);
  }
  t.fx = readFxChain(r);
  r.tag(0x2d, 3);
  const names = Array.from({ length: 16 }, () => r.cstr());
  t.lanes = names.map((name) => ({ name, record: r.raw(7) }));
  t.u_laneTail = r.u8();
  r.tag(0x1f, 1);
  t.u_1f = { a: r.u32(), b: r.val() };
  t.u_2a = [];
  for (let i = 0; i < 8; i++) {
    r.tag(0x2a, 1);
    t.u_2a.push(r.u8());
  }
  t.aftr = version >= 19 ? r.val(4) : null;
  return t as Track;
};

const writeTrack = (w: Writer, t: Track): void => {
  w.tag(0x0c, t.version);
  w.val(t.type, 4);
  writeOutput(w, t.output);
  writeInput(w, t.input);
  for (const [k, width] of SCALARS) {
    const v = t[k] as number;
    w.val(width === 2 && v < 0 ? v + 0x10000 : v, width);
  }
  w.u8(t.indexAgain);
  w.u8(t.monoEdit);
  w.optStr(t.name);
  w.val(t.f_0x4a);
  w.u16(t.u_0x284);
  w.u8(t.u_0x280);
  w.optStr(t.instrumentFile);
  w.u8(t.pScale);
  w.u8(t.pTrsp);
  w.u8(t.u_0x289);
  t.patterns.forEach((p) => writePattern(w, p));
  writeFxChain(w, t.fx);
  w.tag(0x2d, 3);
  t.lanes.forEach((l) => w.cstr(l.name));
  t.lanes.forEach((l) => w.raw(l.record));
  w.u8(t.u_laneTail);
  w.tag(0x1f, 1);
  w.u32(t.u_1f.a);
  w.val(t.u_1f.b);
  for (const v of t.u_2a) {
    w.tag(0x2a, 1);
    w.u8(v);
  }
  if (t.version >= 19) w.val(t.aftr ?? 0, 4);
};

// ------------------------------------------------------------------ project

export interface Section {
  u_index: number;
  name: string;
  patterns: number[]; // pattern index per track (16)
}

export interface SongEntry {
  section: number;
  length: number; // 🟡 units
}

export interface ProjectLfo {
  wave: number; // LFO_WAVE
  sync: number;
  rate: number;
  u_3: number;
  phase: number;
  level: number; // FLAT level
}

export interface TargetValue {
  target: Target;
  value: number;
}

export interface Project {
  tempoX10: number;
  pScaleMode: number;
  key: number;
  scale: number;
  signatureUpper: number;
  signatureLowerIndex: number; // SIGNATURE_LOWER
  pQuant: number;
  u_global11: number;
  u_global12: number;
  tracks: Track[]; // 16
  trackOrder: number[]; // 16 bytes, 0..15
  sections: Section[];
  song: SongEntry[];
  lfos: ProjectLfo[]; // 2
  u_25: TargetValue[][]; // 16 per-track lists (empty in all samples)
  u_perTrack: number[]; // 16
  mpePorts: { port: Port; u_a: number; u_b: number }[];
}

export const readProject = (buf: Uint8Array): Project => {
  const r = new Reader(buf, 'project.dat');
  r.tag(0x0f, 1);
  r.tag(0x0d, 12);
  const p = { tempoX10: r.u16() } as Partial<Project>;
  [p.pScaleMode, p.key, p.scale, p.signatureUpper, p.signatureLowerIndex, p.pQuant, p.u_global11, p.u_global12] =
    Array.from({ length: 8 }, () => r.val());
  p.tracks = [];
  for (let i = 0; i < 16; i++) {
    if (r.u8() !== i) {
      r.pos--;
      r.fail(`expected track index ${i}`);
    }
    p.tracks.push(readTrack(r));
  }
  p.trackOrder = Array.from(r.raw(16));
  r.tag(0x1c, 1);
  p.sections = Array.from({ length: r.u32() }, () => {
    const u_index = r.u8();
    r.tag(0x1b, 3);
    return { u_index, name: r.cstr(), patterns: Array.from(r.raw(16)) };
  });
  r.tag(0x1e, 1);
  p.song = Array.from({ length: r.u32() }, () => {
    r.tag(0x1d, 1);
    return { section: r.u8(), length: r.u16() };
  });
  p.lfos = Array.from({ length: 2 }, () => {
    r.tag(0x24, 2);
    return { wave: r.val(), sync: r.val(), rate: r.val(), u_3: r.val(), phase: r.val(2), level: r.val() };
  });
  p.u_25 = Array.from({ length: 16 }, () => {
    r.tag(0x25, 1);
    return Array.from({ length: r.u32() }, () => ({ target: readTarget(r), value: r.u16() }));
  });
  p.u_perTrack = Array.from(r.raw(16));
  p.mpePorts = Array.from({ length: r.u8() }, () => ({ port: readPort(r), u_a: r.u8(), u_b: r.u8() }));
  if (!r.eof()) r.fail('unconsumed bytes at end of project.dat');
  return p as Project;
};

export const writeProject = (p: Project): Uint8Array => {
  const w = new Writer();
  w.tag(0x0f, 1);
  w.tag(0x0d, 12);
  w.u16(p.tempoX10);
  for (const v of [p.pScaleMode, p.key, p.scale, p.signatureUpper, p.signatureLowerIndex, p.pQuant, p.u_global11, p.u_global12]) w.val(v);
  p.tracks.forEach((t, i) => {
    w.u8(i);
    writeTrack(w, t);
  });
  w.raw(Uint8Array.from(p.trackOrder));
  w.tag(0x1c, 1);
  w.u32(p.sections.length);
  for (const s of p.sections) {
    w.u8(s.u_index);
    w.tag(0x1b, 3);
    w.cstr(s.name);
    w.raw(Uint8Array.from(s.patterns));
  }
  w.tag(0x1e, 1);
  w.u32(p.song.length);
  for (const e of p.song) {
    w.tag(0x1d, 1);
    w.u8(e.section);
    w.u16(e.length);
  }
  for (const l of p.lfos) {
    w.tag(0x24, 2);
    w.val(l.wave); w.val(l.sync); w.val(l.rate); w.val(l.u_3); w.val(l.phase, 2); w.val(l.level);
  }
  for (const list of p.u_25) {
    w.tag(0x25, 1);
    w.u32(list.length);
    for (const e of list) {
      writeTarget(w, e.target);
      w.u16(e.value);
    }
  }
  w.raw(Uint8Array.from(p.u_perTrack));
  w.u8(p.mpePorts.length);
  for (const m of p.mpePorts) {
    writePort(w, m.port);
    w.u8(m.u_a);
    w.u8(m.u_b);
  }
  return w.bytes();
};
