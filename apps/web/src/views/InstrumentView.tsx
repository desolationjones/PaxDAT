import type { InstrumentDef } from '@paxdat/core';

export const InstrumentView = ({ ins }: { ins: { name: string; def: InstrumentDef } }) => (
  <section>
    <h2>{ins.name}</h2>
    <div className="cards">
      <dl className="card">
        {Object.entries(ins.def.fields).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || <span className="muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      {Object.entries(ins.def.sections)
        .filter(([, lines]) => lines.some((l) => l.trim()))
        .map(([name, lines]) => (
          <div key={name} className="card">
            <h5>
              {name} <span className="muted">({lines.filter((l) => l.trim()).length})</span>
            </h5>
            <pre className="lines">{lines.join('\n')}</pre>
          </div>
        ))}
    </div>
  </section>
);
