// Human-readable labels shared by the CLI and the web UI.

import {
  CV_OUTPUT, FX_TYPE, INPUT_MODE, MATH, NOTE_NAMES, PORT_KIND, PQUANT, PSCALE_MODE, ROLL, SCALES,
  SIGNATURE_LOWER, TARGET_TYPE, TRACK_TYPE, TRSP_MODE, label, noteName,
} from './enums';
import type { DecodedPayload } from './events';
import type { Port, Project, Target, Track } from './project';

export const portLabel = (p: Port | null): string => {
  if (!p) return '––';
  if (p.kind === 0) return `MIDI ${'ABCD'[p.index] ?? `#${p.index}`}`;
  if (p.kind === 1 || p.kind === 2) return `${PORT_KIND[p.kind]} ${p.index + 1}`;
  return `port ${p.kind}:${p.index}`;
};

export const outputLabel = (t: Track): string =>
  t.output.outType === 0
    ? `${portLabel(t.output.port)} · ch ${t.output.channel + 1}`
    : `${label(CV_OUTPUT, t.output.u_cvIndex)} (type ${t.output.outType}) 🟡`;

export const inputLabel = (t: Track): string => {
  const ch = t.input.channel >= 16 ? 'ALL' : `ch ${t.input.channel + 1}`;
  if (t.input.mode === 2) return `${portLabel(t.input.port)} · ${ch}`;
  return `${label(INPUT_MODE, t.input.mode)} · ${ch}`;
};

export const trackTypeLabel = (t: Track): string => (t.aftr ? 'AFTR' : label(TRACK_TYPE, t.type));

export const isTransposeLeader = (t: Track): boolean => t.fx.headClass === 0x13;

export const tempoLabel = (p: Project): string => (p.tempoX10 / 10).toFixed(1);

export const signatureLabel = (p: Project): string =>
  `${p.signatureUpper}/${SIGNATURE_LOWER[p.signatureLowerIndex] ?? `#${p.signatureLowerIndex}`}`;

export const scaleLabel = (scale: number, key?: number): string => {
  const s = SCALES[scale];
  const name = s ? `${s.name}${s.color ? ` (${s.color})` : ''}` : `#${scale}`;
  return key === undefined ? name : `${NOTE_NAMES[key % 12] ?? `#${key}`} ${name}`;
};

export const projectScaleLabel = (p: Project): string =>
  p.pScaleMode === 0 ? 'off' : `${scaleLabel(p.scale, p.key)} · ${label(PSCALE_MODE, p.pScaleMode)}`;

export const pQuantLabel = (p: Project): string => label(PQUANT, p.pQuant);

export const trspLabel = (p: Project): string => {
  const t16 = p.tracks[15];
  return t16 && isTransposeLeader(t16) ? label(TRSP_MODE, t16.fx.headValue) : '––';
};

export const fxName = (type: number): string => FX_TYPE[type] ?? `FX #${type}`;

export const targetLabel = (t: Target): string => {
  const b = t.bytes;
  const type = TARGET_TYPE[b[0]] ?? `type ${b[0]}`;
  if (b[0] === 0x00) return `CC ${b[5]}`;
  if (b[0] === 0x03) return `FX slot ${b[4] >> 5} · ${b[5] === 0xff ? 'ON/OFF' : `param ${b[5]}`}`;
  return type;
};

export const mathLabel = (m: number): string => label(MATH, m) || '–';
export const rollLabel = (r: number): string => label(ROLL, r) || '–';

export const noteLabel = (d: DecodedPayload): string => noteName(d.pitch);

/**
 * Drum lanes are stored as a 16-entry list (names + 7-byte records) and drum
 * events reference a lane by its list index. 🟡 Index 0–7 are rows 8…1 of the
 * first page (index 7 = row 1, the bottom row: KICK by default; the Octatrack
 * definition's row 8 lands at index 0), index 8–15 are rows 16…9.
 */
export const drumLaneRow = (index: number): number => (index < 8 ? 8 - index : 24 - index);

export const drumLaneName = (t: Track, index: number): string => t.lanes[index]?.name ?? `lane ${index}`;
