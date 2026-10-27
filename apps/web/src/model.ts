// Small helpers over a LoadedProject used by several views.

import type { EventFile, LoadedProject, NoteEvent } from '@paxdat/core';

const countIn = <E>(f: EventFile<E> | null, track: number): number =>
  f?.tracks.find((t) => t.track === track)?.patterns.reduce((n, p) => n + p.events.length, 0) ?? 0;

export const eventCount = (lp: LoadedProject, track: number): number =>
  countIn(lp.notes, track) + countIn(lp.drums, track) + countIn(lp.mpe, track);

export const laneCount = (lp: LoadedProject, track: number): number =>
  lp.autom?.tracks.find((t) => t.track === track)?.lanes.length ?? 0;

/** Events of one track/pattern from whichever file holds them (notes, drums or mpe). */
export const patternEvents = (lp: LoadedProject, track: number, pattern: number): { file: string; events: NoteEvent[] } => {
  for (const [file, f] of [['notes', lp.notes], ['drums', lp.drums], ['mpe', lp.mpe]] as const) {
    const events = f?.tracks.find((t) => t.track === track)?.patterns.find((p) => p.pattern === pattern)?.events;
    if (events) return { file, events };
  }
  return { file: '', events: [] };
};
