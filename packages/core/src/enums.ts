// Enumerations recovered from the OS 3.22 firmware and confirmed by captures.
// See docs/FORMAT.md §12. Index = value stored in the file.

/** Ticks per 16th step; the sequencer runs at 192 PPQN. */
export const TICKS_PER_STEP = 48;

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Hapax note naming: C0 = 0 … G10 = 127 (so 62 = D5). */
export const noteName = (pitch: number): string => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12)}`;

const ratios = (from: number, to: number, label: (n: number) => string): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => label(from + i));

/** Note "Math" (conditional trig). 23 = no condition (default). 69 values. */
export const MATH: readonly string[] = [
  'PB<5', 'PB<4', 'PB<3', 'PB<2', 'PB=0',
  'PS<5', 'PS<4', 'PS<3', 'PS<2', 'PS=0',
  'NT<5', 'NT<4', 'NT<3', 'NT<2', 'NT=0',
  '!SYNC', 'SYNC', '!PRE', 'PRE', '!FIRST', 'FIRST', '!FILL', 'FILL',
  '',
  '1:2', '2:2', '1:3', '2:3', '3:3', '1:4', '2:4', '3:4', '4:4',
  ...ratios(5, 16, (n) => `1:${n}`),
  '!1:2', '!2:2', '!1:3', '!2:3', '!3:3', '!1:4', '!2:4', '!3:4', '!4:4',
  ...ratios(5, 16, (n) => `!1:${n}`),
  'FX IF FILL', 'NO FX IF FILL', 'NO FX',
];
export const MATH_OFF = 23;

export const ROLL = ['', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64', '1/96', '1/128', '1/256'] as const;

export const PSCALE_MODE = ['OFF', 'STICK DOWN', 'STICK UP', 'FILTER'] as const;
export const PQUANT = ['––', '1/64', '1/32', '1/24', '1/16'] as const;
export const TRSP_MODE = ['––', 'TRANSPOSE', 'MATCH CHORD'] as const;
export const SIGNATURE_LOWER = [1, 2, 4, 8] as const;

export const RUN_MODE = ['––', 'REVERSE', 'PING-PONG', 'RANDOM BAR', 'RANDOM BEAT', 'RANDOM 1/16'] as const;
/** 🟡 stored default is 1; the manual names FREE as the default. */
export const TRIG_MODE = ['FREE', 'RESTART'] as const;
export const FOLLOW_ACTION = ['––', 'STOP', 'PREVIOUS', 'NEXT', 'ANY', 'OTHER', 'FIRST', 'LAST', 'RSTR'] as const;

export const TRACK_TYPE = ['POLY', 'MPE', 'DRUM'] as const;
export const PORT_KIND = ['MIDI', 'USB DEVICE', 'USB HOST'] as const;
export const INPUT_MODE = ['––', 'ALL ACTIVE', 'PORT'] as const;
export const CV_OUTPUT = ['GATE 1', 'GATE 2', 'GATE 3', 'GATE 4', 'CV 1', 'CV 2', 'CV 3', 'CV 4', 'CV/G 1', 'CV/G 2', 'CV/G 3', 'CV/G 4'] as const;

export const LFO_WAVE = ['SINE', 'TRIANGLE', 'RAMP', 'SQUARE', 'RANDOM', 'FLAT'] as const;

export const FX_TYPE: Readonly<Record<number, string>> = {
  0x00: 'ModMatrix', 0x01: 'Arpeggiator', 0x02: 'Chance', 0x03: 'Euclid', 0x04: 'Filter',
  0x05: 'Harmonizer', 0x06: 'LFO', 0x07: 'Randomizer', 0x08: 'Scaler', 0x09: 'Swing',
  0x0a: 'Envelope', 0x0b: 'Output', 0x0c: 'Echo', 0x0e: 'Register', 0x10: 'Shaper',
  0x11: 'Mono', 0x12: 'Arpoly', 0x13: 'Spring',
};

/** Automation / modulation target type: byte 0 of a `16 31` target. */
export const TARGET_TYPE: Readonly<Record<number, string>> = {
  0x00: 'CC', 0x03: 'FX PARAM', 0x04: 'POLY AFTERTOUCH', 0x05: 'AFTERTOUCH',
  0x06: 'PITCHBEND', 0x08: 'PROGRAM CHANGE', 0x0a: 'MOD TARGET',
};

export interface ScaleInfo {
  readonly name: string;
  readonly color: string;
}

const scaleGroup = (color: string, names: string[]): ScaleInfo[] => names.map((name) => ({ name, color }));

/** 67 scales (0–66). Colour is derived from the index, not stored. */
export const SCALES: readonly ScaleInfo[] = [
  { name: 'CHROMATIC', color: '' },
  ...scaleGroup('MAJ', ['MAJOR', 'HARMONIC', 'AUGMENTED', 'PENTATONIC', 'PENTATONIC (V)', 'PENTATONIC (ION)', 'ARABIC', 'LYDIAN', 'LYDIAN AUGMENTED']),
  ...scaleGroup('MIN', ['DORIAN', 'AEOLIAN', 'PHRYGIAN', 'JAPANESE', 'SPANISH', 'PENTATONIC', 'PENTA (DORIAN)', 'PENTA (PELOG)', 'BLUES', 'ROMANIAN', 'GYPSY b7', 'HAWAIIAN', 'MELODIC', 'HARMONIC', 'DIMINISHED', 'GYPSY', 'LYDIAN b6']),
  ...scaleGroup('DOMI', ['MIXOLYDIAN', 'ARABIC (7)', 'BLUES', 'PENTATONIC', 'PENTA (IV)', 'PENTA (D II)', 'LYDIAN DOMINANT', 'MELODIC MAJOR', 'PHRYGIAN DOMINANT', 'DIMINISHED', 'TRITONE', 'ALTERED', 'ROCK N ROLL', 'WHOLE TONE', 'INVERTED (AUG)']),
  ...scaleGroup('SUS', ['MIXOLYDIAN', 'PENTATONIC', 'RITUSEN', 'DORIAN (b2)']),
  ...scaleGroup('HALF', ['HALF DIMINISHED', 'LOCRIAN', 'PENTA MINOR b5']),
  ...scaleGroup('DIMI', ['DIMINISHED', 'HALF TONE', 'ROMANIAN', 'ULTRALOCRIAN', 'BLUES HEPTATONIC']),
  ...scaleGroup('MESS', ['2ND MODE T', '3RD MODE', '4TH MODE', '4TH I MODE', '5TH MODE', '5TH I MODE', '6TH MODE', '6TH I MODE']),
  ...scaleGroup('INT', ['MINOR THIRDS', 'MAJOR THIRDS', 'FOURTHS', 'FIFTH OCTAVE', 'OCTAVE']),
];

/** Label lookup that never throws: unknown values render as `#n`. */
export const label = (table: Readonly<Record<number, string>> | readonly string[], v: number): string =>
  (table as Record<number, string>)[v] ?? `#${v}`;
