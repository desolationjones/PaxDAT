// Golden tests against the local sample projects in ../../Samples (git-ignored).
// Tests are skipped when the samples are not present (e.g. in CI).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodePayload, hex, loadCard, readAutom, readDrums, readMpe, readNotes, readProject, readSettings,
  writeAutom, writeDrums, writeMpe, writeNotes, writeProject, writeSettings, type CardFile,
} from '../src';

const SAMPLES = resolve(__dirname, '../../../Samples');
const ROOT = resolve(__dirname, '../../..');
const have = existsSync(SAMPLES);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const projectDirs = have
  ? [...new Set(walk(SAMPLES).filter((p) => p.endsWith('/project.dat')).map((p) => p.slice(0, -'/project.dat'.length)))]
  : [];

const codecs = {
  'project.dat': [readProject, writeProject],
  'notes.dat': [readNotes, writeNotes],
  'drums.dat': [readDrums, writeDrums],
  'mpe.dat': [readMpe, writeMpe],
  'autom.dat': [readAutom, writeAutom],
} as const;

describe.skipIf(!have)('golden round-trip: parse → write reproduces every byte', () => {
  for (const dir of projectDirs) {
    for (const [file, [read, write]] of Object.entries(codecs)) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      it(`${relative(SAMPLES, dir)}/${file}`, () => {
        const original = new Uint8Array(readFileSync(path));
        const again = (write as (m: unknown) => Uint8Array)((read as (b: Uint8Array) => unknown)(original));
        expect(hex(again)).toBe(hex(original));
      });
    }
  }
  for (const path of have ? walk(SAMPLES).filter((p) => p.endsWith('/settings.dat')) : []) {
    it(relative(SAMPLES, path), () => {
      const original = new Uint8Array(readFileSync(path));
      expect(hex(writeSettings(readSettings(original)))).toBe(hex(original));
    });
  }
});

const capture = join(SAMPLES, 'OS 3.22/102726A');

describe.skipIf(!existsSync(capture))('capture 102726A decodes to the values set on the device', () => {
  const p = readProject(new Uint8Array(readFileSync(join(capture, 'project.dat'))));
  const notes = readNotes(new Uint8Array(readFileSync(join(capture, 'notes.dat'))));

  it('project settings', () => {
    expect(p.tempoX10).toBe(1205);
    expect([p.pScaleMode, p.key, p.scale, p.signatureUpper, p.signatureLowerIndex, p.pQuant]).toEqual([3, 2, 10, 7, 3, 3]);
    expect(p.tracks[15].fx.headValue).toBe(2); // MATCH CHORD
  });

  it('track 1 routing and settings', () => {
    const t = p.tracks[0];
    expect(t.output).toMatchObject({ channel: 1, outType: 0, port: { kind: 2, index: 3 } }); // USB HOST 4 ch 2
    expect(t.input).toMatchObject({ channel: 12, mode: 2, port: { kind: 0, index: 1 } }); // MIDI B ch 13
    expect([t.monoEdit, t.pTrsp, t.pScale, t.fx.strength]).toEqual([1, 1, 0, 57]);
    expect(t.patterns[0].length).toBe(14); // one bar of 7/8
  });

  it('track types: MPE, AFTR, DRUM', () => {
    expect([p.tracks[1].type, p.tracks[2].type, p.tracks[2].aftr, p.tracks[3].type]).toEqual([1, 1, 1, 2]);
  });

  it('the hand-placed note on track 1 pattern 1', () => {
    const n = notes.tracks[0].patterns[0].events[0];
    expect(n.position).toBe(4); // µTime +8 %
    expect(decodePayload(n.payload)).toMatchObject({ pitch: 62, velocity: 89, chance: 74, math: 66, roll: 3, length: 432 });
  });
});

const python = (() => {
  try {
    execFileSync('python3', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!have || !python)('cross-check with tools/paxdat_probe.py', () => {
  for (const dir of projectDirs) {
    it(relative(SAMPLES, dir), () => {
      const out = execFileSync('python3', [join(ROOT, 'tools/paxdat_probe.py'), dir, '--dump'], { encoding: 'utf8' });
      const py = JSON.parse(out.slice(out.indexOf('{')));
      const p = readProject(new Uint8Array(readFileSync(join(dir, 'project.dat'))));
      expect(p.tempoX10).toBe(py['project.dat']['tempo_x10?']);
      p.tracks.forEach((t, i) => {
        const pt = py['project.dat'].tracks[i];
        expect(t.output.channel).toBe(pt.midi_channel_0based);
        expect(t.fx.slots.map((s) => s?.type ?? null)).toEqual(pt.fx.map((s: { type: number } | null) => s?.type ?? null));
      });
      if (py['notes.dat']) {
        const n = readNotes(new Uint8Array(readFileSync(join(dir, 'notes.dat'))));
        const ts = n.tracks.flatMap((t) => t.patterns.flatMap((pat) => pat.events.map((e) => [t.track, pat.pattern, e.position, decodePayload(e.payload).pitch])));
        const ps = py['notes.dat'].tracks.flatMap((t: any) => t.patterns.flatMap((pat: any) => pat.notes.map((e: any) => [t.track, pat.pattern, e.position, e.pitch])));
        expect(ts).toEqual(ps);
      }
    });
  }
});

describe.skipIf(!have)('card loader', () => {
  it('finds every sample project and the device files', () => {
    const files: CardFile[] = walk(SAMPLES).map((p) => ({ path: relative(SAMPLES, p), data: new Uint8Array(readFileSync(p)) }));
    const card = loadCard(files);
    expect(card.projects.length).toBe(projectDirs.length);
    expect(card.issues).toEqual([]);
    expect(card.settings).not.toBeNull();
    expect(card.autoload).toBe('OT_REDUX-101026C');
    expect(card.instruments.map((i) => i.def.fields.TRACKNAME).sort()).toEqual(['OCTATRACK', 'TEO5']);
  });
});
