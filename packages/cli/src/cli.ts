#!/usr/bin/env -S npx tsx
// paxdat CLI: inspect, diff and round-trip check Hapax projects (read-only).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  decodePayload, diff, fxName, hex, inputLabel, loadCard, noteName, outputLabel, pQuantLabel, projectScaleLabel,
  readAutom, readDrums, readMpe, readNotes, readProject, signatureLabel, tempoLabel, toJson, trackTypeLabel,
  trspLabel, writeAutom, writeDrums, writeMpe, writeNotes, writeProject, type CardFile, type LoadedProject,
} from '@paxdat/core';

const USAGE = `paxdat — read-only tools for Squarp Hapax projects

  paxdat inspect <card-or-project-dir> [--json]   summary (or full JSON) of every project found
  paxdat diff <project-dir-a> <project-dir-b>      structural differences between two projects
  paxdat roundtrip <card-or-project-dir>           check that parse → write reproduces every file`;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** npm runs workspace scripts from the package dir; resolve user paths against where npm was invoked. */
const userPath = (p: string): string => resolve(process.env.INIT_CWD ?? process.cwd(), p);

const readDir = (dir: string): CardFile[] => {
  const root = userPath(dir);
  return walk(root).map((p) => ({ path: relative(resolve(root, '..'), p), data: new Uint8Array(readFileSync(p)) }));
};

const summarise = (lp: LoadedProject): string => {
  const out: string[] = [`■ ${lp.name}  (${lp.path})`];
  for (const i of lp.issues) out.push(`  ⚠ ${i.file}: ${i.message}`);
  const p = lp.project;
  if (!p) return out.join('\n');
  out.push(
    `  tempo ${tempoLabel(p)} · ${signatureLabel(p)} · scale ${projectScaleLabel(p)} · pQuant ${pQuantLabel(p)} · TR16 ${trspLabel(p)}`,
  );
  if (p.sections.length) out.push(`  sections: ${p.sections.map((s) => s.name).join(', ')} · song: ${p.song.length} entries`);
  const count = (f: typeof lp.notes, track: number) =>
    f?.tracks.find((t) => t.track === track)?.patterns.reduce((n, pat) => n + pat.events.length, 0) ?? 0;
  p.tracks.forEach((t, i) => {
    const events = count(lp.notes, i) + count(lp.drums, i) + count(lp.mpe, i);
    const lanes = lp.autom?.tracks.find((a) => a.track === i)?.lanes.length ?? 0;
    const fx = t.fx.slots.filter((s) => s && s.type !== 0).map((s) => fxName(s!.type));
    const name = t.name ? ` "${t.name}"` : '';
    const isDefault = !events && !lanes && !fx.length && !t.name;
    if (isDefault && process.argv.includes('--brief')) return;
    out.push(
      `  ${String(i + 1).padStart(2)} ${trackTypeLabel(t).padEnd(4)}${name} out ${outputLabel(t)} · in ${inputLabel(t)}` +
        `${events ? ` · ${events} events` : ''}${lanes ? ` · ${lanes} autom lanes` : ''}${fx.length ? ` · FX ${fx.join(' → ')}` : ''}`,
    );
  });
  const first = lp.notes?.tracks[0]?.patterns[0]?.events[0];
  if (first) {
    const d = decodePayload(first.payload);
    out.push(`  first note: ${noteName(d.pitch)} vel ${d.velocity} @${first.position} len ${d.length}`);
  }
  return out.join('\n');
};

const codecs = [
  ['project.dat', readProject, writeProject],
  ['notes.dat', readNotes, writeNotes],
  ['drums.dat', readDrums, writeDrums],
  ['mpe.dat', readMpe, writeMpe],
  ['autom.dat', readAutom, writeAutom],
] as const;

const main = (): number => {
  const [cmd, ...args] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const json = process.argv.includes('--json');
  if (cmd === 'inspect' && args[0]) {
    const card = loadCard(readDir(args[0]));
    if (json) {
      console.log(toJson(card));
      return card.issues.length ? 1 : 0;
    }
    if (card.autoload) console.log(`AUTO.LOAD → ${card.autoload}`);
    if (card.instruments.length) console.log(`instrument definitions: ${card.instruments.map((i) => i.name).join(', ')}`);
    card.projects.forEach((p) => console.log(summarise(p)));
    if (!card.projects.length) console.log('no project.dat found');
    return card.issues.length ? 1 : 0;
  }
  if (cmd === 'diff' && args[1]) {
    const [a, b] = args.map((d) => loadCard(readDir(d)).projects[0]);
    if (!a || !b) {
      console.error('both arguments must contain a project.dat');
      return 2;
    }
    const strip = (p: LoadedProject) => ({ project: p.project, notes: p.notes, drums: p.drums, mpe: p.mpe, autom: p.autom });
    const changes = diff(strip(a), strip(b));
    for (const c of changes) console.log(`${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
    console.log(`${changes.length} difference(s)`);
    return 0;
  }
  if (cmd === 'roundtrip' && args[0]) {
    let bad = 0;
    for (const p of loadCard(readDir(args[0])).projects) {
      for (const [file, read, write] of codecs) {
        const original = p.files[file];
        if (!original) continue;
        let ok = false;
        try {
          ok = hex((write as (m: unknown) => Uint8Array)((read as (b: Uint8Array) => unknown)(original))) === hex(original);
        } catch (e) {
          console.log(`FAIL ${p.path}/${file}: ${(e as Error).message}`);
          bad++;
          continue;
        }
        console.log(`${ok ? 'OK  ' : 'DIFF'} ${p.path}/${file}`);
        if (!ok) bad++;
      }
    }
    return bad ? 1 : 0;
  }
  console.log(USAGE);
  return 2;
};

process.exitCode = main();
