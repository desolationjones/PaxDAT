// notes.dat / drums.dat / mpe.dat / autom.dat codecs (docs/FORMAT.md §4–§6).

import { Reader, Writer } from './bytes';
import { MATH_OFF } from './enums';
import { readTarget, writeTarget, type Target } from './project';

/**
 * The 10-byte note payload is a raw copy of the firmware's note struct.
 * `raw` is the source of truth; the decoded fields are views onto it.
 */
export interface NotePayload {
  raw: Uint8Array;
}

export interface DecodedPayload {
  selected: boolean; // byte 0 bit 0 (UI selection)
  pitch: number; // 0–127
  disabled: boolean; // pitch byte bit 7
  velocity: number;
  releaseVelocity: number;
  laneOrPad: number; // drum lane on drum tracks; padding elsewhere
  chance: number; // %
  math: number; // MATH index (23 = none)
  roll: number; // ROLL index
  length: number; // ticks
}

export const decodePayload = (p: NotePayload): DecodedPayload => {
  const b = p.raw;
  return {
    selected: (b[0] & 1) === 1,
    pitch: b[1] & 0x7f,
    disabled: (b[1] & 0x80) !== 0,
    velocity: b[2],
    releaseVelocity: b[3],
    laneOrPad: b[4],
    chance: b[5],
    math: b[6],
    roll: b[7],
    length: b[8] | (b[9] << 8),
  };
};

export const hasMath = (d: DecodedPayload): boolean => d.math !== MATH_OFF;

export interface NoteEvent {
  position: number; // ticks, µTime included
  payload: NotePayload;
}

export interface Curve {
  u_flag: number;
  points: { position: number; value: number }[];
}

export interface MpeEvent extends NoteEvent {
  curves: Curve[]; // 3, in file order (first = pitch bend, centre 8192)
}

export interface PatternEvents<E> {
  pattern: number;
  events: E[];
}

export interface TrackEvents<E> {
  track: number;
  patterns: PatternEvents<E>[];
}

export interface EventFile<E> {
  tracks: TrackEvents<E>[];
}

// --------------------------------------------------------------- nesting

const readNested = <E>(r: Reader, readList: (r: Reader) => E[]): EventFile<E> => {
  const tracks = Array.from({ length: r.u8() }, () => ({
    track: r.u8(),
    patterns: Array.from({ length: r.u8() }, () => ({ pattern: r.u8(), events: readList(r) })),
  }));
  if (!r.eof()) r.fail('unconsumed bytes');
  return { tracks };
};

const writeNested = <E>(w: Writer, f: EventFile<E>, writeList: (w: Writer, l: E[]) => void): void => {
  w.u8(f.tracks.length);
  for (const t of f.tracks) {
    w.u8(t.track);
    w.u8(t.patterns.length);
    for (const p of t.patterns) {
      w.u8(p.pattern);
      writeList(w, p.events);
    }
  }
};

// --------------------------------------------------------------- notes.dat

export type NotesFile = EventFile<NoteEvent>;

export const readNotes = (buf: Uint8Array): NotesFile => {
  const r = new Reader(buf, 'notes.dat');
  r.tag(0x05, 2);
  return readNested(r, (r) => {
    r.tag(0x00, 1);
    return Array.from({ length: r.u32() }, () => {
      if (r.u8() !== 0x08) {
        r.pos--;
        r.fail('expected note event type 0x08');
      }
      return { position: r.u16(), payload: { raw: r.raw(10) } };
    });
  });
};

export const writeNotes = (f: NotesFile): Uint8Array => {
  const w = new Writer();
  w.tag(0x05, 2);
  writeNested(w, f, (w, list) => {
    w.tag(0x00, 1);
    w.u32(list.length);
    for (const n of list) {
      w.u8(0x08);
      w.u16(n.position);
      w.raw(n.payload.raw);
    }
  });
  return w.bytes();
};

// --------------------------------------------------------------- drums.dat

export type DrumsFile = EventFile<NoteEvent>;

export const readDrums = (buf: Uint8Array): DrumsFile => {
  const r = new Reader(buf, 'drums.dat');
  r.tag(0x06, 2);
  return readNested(r, (r) => {
    r.tag(0x02, 2);
    return Array.from({ length: r.u32() }, () => ({ position: r.u16(), payload: { raw: r.raw(10) } }));
  });
};

export const writeDrums = (f: DrumsFile): Uint8Array => {
  const w = new Writer();
  w.tag(0x06, 2);
  writeNested(w, f, (w, list) => {
    w.tag(0x02, 2);
    w.u32(list.length);
    for (const n of list) {
      w.u16(n.position);
      w.raw(n.payload.raw);
    }
  });
  return w.bytes();
};

// --------------------------------------------------------------- mpe.dat

export type MpeFile = EventFile<MpeEvent>;

const readCurve = (r: Reader): Curve => {
  r.tag(0x28, 2);
  const u_flag = r.u8();
  return { u_flag, points: Array.from({ length: r.u32() }, () => ({ position: r.u16(), value: r.u16() })) };
};

export const readMpe = (buf: Uint8Array): MpeFile => {
  const r = new Reader(buf, 'mpe.dat');
  r.tag(0x26, 2);
  return readNested(r, (r) => {
    r.tag(0x27, 1);
    return Array.from({ length: r.u32() }, () => {
      if (r.u8() !== 0x08) {
        r.pos--;
        r.fail('expected MPE note event 0x08');
      }
      const position = r.u16();
      r.tag(0x29, 1);
      const payload = { raw: r.raw(10) };
      return { position, payload, curves: [readCurve(r), readCurve(r), readCurve(r)] };
    });
  });
};

export const writeMpe = (f: MpeFile): Uint8Array => {
  const w = new Writer();
  w.tag(0x26, 2);
  writeNested(w, f, (w, list) => {
    w.tag(0x27, 1);
    w.u32(list.length);
    for (const n of list) {
      w.u8(0x08);
      w.u16(n.position);
      w.tag(0x29, 1);
      w.raw(n.payload.raw);
      for (const c of n.curves) {
        w.tag(0x28, 2);
        w.u8(c.u_flag);
        w.u32(c.points.length);
        for (const pt of c.points) {
          w.u16(pt.position);
          w.u16(pt.value);
        }
      }
    }
  });
  return w.bytes();
};

// --------------------------------------------------------------- autom.dat

export interface PointList {
  u_a: number;
  flag: number; // per-pattern flag (mute or interpolation 🟡)
  u_b: number;
  u_c: number;
  points: { position: number; value: number }[];
}

export interface AutomationLane {
  target: Target;
  defaultValue: number | null;
  patterns: PointList[]; // 17 (16 patterns + 1 🟡)
  rowSnap: number[] | null; // 8 per-row snap values
}

export interface AutomationTrack {
  track: number;
  lanes: AutomationLane[];
}

export interface AutomFile {
  tracks: AutomationTrack[];
}

export const readAutom = (buf: Uint8Array): AutomFile => {
  const r = new Reader(buf, 'autom.dat');
  r.tag(0x07, 1);
  const tracks = Array.from({ length: r.u8() }, () => {
    const track = r.u8();
    r.tag(0x17, 3);
    const lanes = Array.from({ length: r.u8() }, (): AutomationLane => {
      r.tag(0x2e, 2);
      const target = readTarget(r);
      const defaultValue = r.u8() ? r.u16() : null;
      const patterns = Array.from({ length: 17 }, (): PointList => {
        r.tag(0x03, 4);
        const [u_a, flag, u_b, u_c] = [r.u8(), r.u8(), r.u8(), r.u8()];
        return { u_a, flag, u_b, u_c, points: Array.from({ length: r.u32() }, () => ({ position: r.u16(), value: r.u16() })) };
      });
      const rowSnap = r.u8() ? Array.from({ length: 8 }, () => r.u16()) : null;
      return { target, defaultValue, patterns, rowSnap };
    });
    return { track, lanes };
  });
  if (!r.eof()) r.fail('unconsumed bytes');
  return { tracks };
};

export const writeAutom = (f: AutomFile): Uint8Array => {
  const w = new Writer();
  w.tag(0x07, 1);
  w.u8(f.tracks.length);
  for (const t of f.tracks) {
    w.u8(t.track);
    w.tag(0x17, 3);
    w.u8(t.lanes.length);
    for (const l of t.lanes) {
      w.tag(0x2e, 2);
      writeTarget(w, l.target);
      if (l.defaultValue === null) w.u8(0);
      else { w.u8(1); w.u16(l.defaultValue); }
      for (const p of l.patterns) {
        w.tag(0x03, 4);
        w.u8(p.u_a); w.u8(p.flag); w.u8(p.u_b); w.u8(p.u_c);
        w.u32(p.points.length);
        for (const pt of p.points) { w.u16(pt.position); w.u16(pt.value); }
      }
      if (l.rowSnap === null) w.u8(0);
      else { w.u8(1); l.rowSnap.forEach((v) => w.u16(v)); }
    }
  }
  return w.bytes();
};
