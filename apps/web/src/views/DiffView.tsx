import { diff, type Card, type LoadedProject } from '@paxdat/core';
import { useMemo, useState } from 'react';

const strip = (p: LoadedProject) => ({ project: p.project, notes: p.notes, drums: p.drums, mpe: p.mpe, autom: p.autom });

const fmt = (v: unknown): string => (v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v));

export const DiffView = ({ card }: { card: Card }) => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.min(1, card.projects.length - 1));
  const changes = useMemo(() => diff(strip(card.projects[a]), strip(card.projects[b])), [card, a, b]);
  const pick = (value: number, set: (n: number) => void) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))}>
      {card.projects.map((p, i) => (
        <option key={p.path} value={i}>
          {p.path}
        </option>
      ))}
    </select>
  );
  return (
    <section>
      <h2>Compare projects</h2>
      <p>
        {pick(a, setA)} → {pick(b, setB)}
      </p>
      <p className="muted">{changes.length} difference(s). Paths follow the parsed model (see docs/FORMAT.md).</p>
      <table className="compact diff">
        <tbody>
          {changes.slice(0, 2000).map((c, i) => (
            <tr key={i}>
              <th className="mono">{c.path}</th>
              <td className="mono">{fmt(c.before)}</td>
              <td className="mono">{fmt(c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changes.length > 2000 && <p className="muted">Showing the first 2000.</p>}
    </section>
  );
};
