// Structural diff and JSON export for parsed models.

import { hex } from './bytes';

/** JSON replacer: byte arrays become hex strings. */
export const jsonReplacer = (_key: string, value: unknown): unknown =>
  value instanceof Uint8Array ? hex(value) : value;

export const toJson = (value: unknown, indent = 1): string => JSON.stringify(value, jsonReplacer, indent);

export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

const normalise = (v: unknown): unknown => (v instanceof Uint8Array ? hex(v) : v);

/** Deep diff of two parsed models. Arrays compare by index. */
export const diff = (a: unknown, b: unknown, path = '', out: Change[] = []): Change[] => {
  const x = normalise(a);
  const y = normalise(b);
  if (x === y) return out;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (!isObj(x) || !isObj(y) || Array.isArray(x) !== Array.isArray(y)) {
    out.push({ path: path || '.', before: x, after: y });
    return out;
  }
  if (Array.isArray(x) && Array.isArray(y)) {
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) diff(x[i], y[i], `${path}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], `${path}.${k}`, out);
  return out;
};
