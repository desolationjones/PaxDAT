// Turn a folder picker selection or a drag-and-drop into CardFile[].
// Both paths work in Firefox: <input webkitdirectory> and DataTransferItem.webkitGetAsEntry().

import type { CardFile } from '@paxdat/core';

const SKIP = /(^|\/)(\.|__MACOSX)|:Zone\.Identifier$/;

const toCardFile = async (file: File, path: string): Promise<CardFile> => ({
  path,
  data: new Uint8Array(await file.arrayBuffer()),
});

export const fromFileList = async (list: FileList): Promise<CardFile[]> => {
  const files = Array.from(list).filter((f) => !SKIP.test(f.webkitRelativePath || f.name));
  return Promise.all(files.map((f) => toCardFile(f, f.webkitRelativePath || f.name)));
};

const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const entryFile = (entry: FileSystemFileEntry): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject));

const walkEntry = async (entry: FileSystemEntry, out: CardFile[]): Promise<void> => {
  const path = entry.fullPath.replace(/^\//, '');
  if (SKIP.test(path)) return;
  if (entry.isFile) {
    out.push(await toCardFile(await entryFile(entry as FileSystemFileEntry), path));
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns results in batches until it yields an empty array
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await walkEntry(child, out);
  }
};

export const fromDataTransfer = async (dt: DataTransfer): Promise<CardFile[]> => {
  const out: CardFile[] = [];
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  for (const e of entries) await walkEntry(e, out);
  return out;
};

/** Offer a JSON (or any text) download from the browser. */
export const download = (name: string, text: string, type = 'application/json'): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
