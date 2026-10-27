// Load a whole SD card (or a single project folder) from a flat file list.
// Works the same in the browser (folder picker) and in Node (directory walk).

import { ParseError } from './bytes';
import { parseInstrumentDef, readAutoload, readSettings, type InstrumentDef, type Settings } from './device';
import { readAutom, readDrums, readMpe, readNotes, type AutomFile, type DrumsFile, type MpeFile, type NotesFile } from './events';
import { readProject, type Project } from './project';

export interface CardFile {
  path: string; // relative path using '/' separators
  data: Uint8Array;
}

export interface FileIssue {
  file: string;
  message: string;
}

export interface LoadedProject {
  name: string; // folder name = project name
  path: string;
  project: Project | null;
  notes: NotesFile | null;
  drums: DrumsFile | null;
  mpe: MpeFile | null;
  autom: AutomFile | null;
  files: Record<string, Uint8Array>;
  issues: FileIssue[];
}

export interface Card {
  projects: LoadedProject[];
  settings: Settings | null;
  autoload: string | null;
  instruments: { name: string; def: InstrumentDef }[];
  issues: FileIssue[];
}

const PROJECT_FILES = ['project.dat', 'notes.dat', 'drums.dat', 'mpe.dat', 'autom.dat'] as const;

const dirname = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

const attempt = <T>(issues: FileIssue[], file: string, fn: () => T): T | null => {
  try {
    return fn();
  } catch (e) {
    issues.push({ file, message: e instanceof ParseError ? e.message : String(e) });
    return null;
  }
};

export const loadProjectFiles = (path: string, files: Record<string, Uint8Array>): LoadedProject => {
  const issues: FileIssue[] = [];
  const get = <T>(name: string, fn: (b: Uint8Array) => T): T | null =>
    files[name] ? attempt(issues, `${path}/${name}`, () => fn(files[name])) : null;
  return {
    name: basename(path) || path,
    path,
    project: get('project.dat', readProject),
    notes: get('notes.dat', readNotes),
    drums: get('drums.dat', readDrums),
    mpe: get('mpe.dat', readMpe),
    autom: get('autom.dat', readAutom),
    files,
    issues,
  };
};

export const loadCard = (input: CardFile[]): Card => {
  const files = input.filter((f) => !f.path.includes(':Zone.Identifier'));
  const issues: FileIssue[] = [];

  const byDir = new Map<string, Record<string, Uint8Array>>();
  for (const f of files) {
    const name = basename(f.path);
    if ((PROJECT_FILES as readonly string[]).includes(name)) {
      const dir = dirname(f.path);
      if (!byDir.has(dir)) byDir.set(dir, {});
      byDir.get(dir)![name] = f.data;
    }
  }
  const projects = [...byDir.entries()]
    .filter(([, fs]) => fs['project.dat'])
    .map(([dir, fs]) => loadProjectFiles(dir, fs))
    .sort((a, b) => a.path.localeCompare(b.path));

  const settingsFile = files.find((f) => basename(f.path) === 'settings.dat');
  const autoloadFile = files.find((f) => basename(f.path).toUpperCase() === 'AUTO.LOAD');
  const decoder = new TextDecoder('utf-8');
  const instruments = files
    .filter((f) => /\.txt$/i.test(f.path))
    .map((f) => ({ name: basename(f.path), def: parseInstrumentDef(decoder.decode(f.data)) }))
    .filter((i) => 'TRACKNAME' in i.def.fields || 'VERSION' in i.def.fields);

  return {
    projects,
    settings: settingsFile ? attempt(issues, settingsFile.path, () => readSettings(settingsFile.data)) : null,
    autoload: autoloadFile ? attempt(issues, autoloadFile.path, () => readAutoload(autoloadFile.data)) : null,
    instruments,
    issues: [...issues, ...projects.flatMap((p) => p.issues)],
  };
};
