// Device-level files: settings.dat, AUTO.LOAD, instrument definitions (FORMAT.md §8–§10).

import { Reader, Writer } from './bytes';

export interface Settings {
  header: number[]; // 9 val8
  groups: { version: number; entries: [string, number][] }[];
  /** Everything after the last decoded group (colour palette etc.), kept verbatim. */
  tail: Uint8Array;
}

/**
 * Groups written by OS ≤ 3.10 (`09 v1`) are decoded. Newer group versions and
 * the palette tail (`21 …`) are kept as raw bytes.
 */
export const readSettings = (buf: Uint8Array): Settings => {
  const r = new Reader(buf, 'settings.dat');
  r.tag(0x1a, 4);
  const header = Array.from({ length: 9 }, () => r.val());
  const groups: Settings['groups'] = [];
  for (let t = r.peekTag(); t && t.cls === 0x09 && t.version === 1; t = r.peekTag()) {
    r.pos += 2;
    const entries = Array.from({ length: r.u32() }, (): [string, number] => [r.cstr(), r.u32()]);
    groups.push({ version: 1, entries });
  }
  return { header, groups, tail: r.rest() };
};

export const writeSettings = (s: Settings): Uint8Array => {
  const w = new Writer();
  w.tag(0x1a, 4);
  s.header.forEach((v) => w.val(v));
  for (const g of s.groups) {
    w.tag(0x09, g.version);
    w.u32(g.entries.length);
    for (const [k, v] of g.entries) {
      w.cstr(k);
      w.u32(v);
    }
  }
  w.raw(s.tail);
  return w.bytes();
};

/** AUTO.LOAD: NUL-terminated name of the project folder opened at boot. */
export const readAutoload = (buf: Uint8Array): string => {
  const r = new Reader(buf, 'AUTO.LOAD');
  const name = r.cstr();
  if (!r.eof()) r.fail('unconsumed bytes');
  return name;
};

export const writeAutoload = (name: string): Uint8Array => {
  const w = new Writer();
  w.cstr(name);
  return w.bytes();
};

/** Instrument definition text file; syntax documented by Squarp inside the file. */
export interface InstrumentDef {
  fields: Record<string, string>; // TRACKNAME, TYPE, OUTPORT, OUTCHAN, INPORT, INCHAN, VERSION
  sections: Record<string, string[]>; // DRUMLANES, PC, CC, NRPN, ASSIGN, AUTOMATION, COMMENT
  text: string;
}

export const parseInstrumentDef = (text: string): InstrumentDef => {
  const fields: Record<string, string> = {};
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const open = rawLine.match(/^\s*\[([A-Z]+)\]\s*$/);
    const close = rawLine.match(/^\s*\[\/([A-Z]+)\]\s*$/);
    if (open) {
      current = open[1];
      sections[current] = [];
      continue;
    }
    if (close) {
      current = null;
      continue;
    }
    if (current === 'COMMENT') {
      sections[current].push(rawLine);
      continue;
    }
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (current) {
      sections[current].push(line);
    } else {
      const m = line.match(/^([A-Z]+)\s*(.*)$/);
      if (m) fields[m[1]] = m[2].trim();
    }
  }
  return { fields, sections, text };
};
