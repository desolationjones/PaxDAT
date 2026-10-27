import {
  LFO_WAVE, fxName, inputLabel, label, outputLabel, pQuantLabel, projectScaleLabel, signatureLabel, tempoLabel,
  toJson, trackTypeLabel, trspLabel, type LoadedProject,
} from '@paxdat/core';
import { useState } from 'react';
import { download } from '../loadFiles';
import { eventCount, laneCount } from '../model';
import { TrackView } from './TrackView';

type Tab = 'overview' | 'tracks' | 'song' | 'json';

export const ProjectView = ({ lp }: { lp: LoadedProject }) => {
  const [tab, setTab] = useState<Tab>('tracks');
  const [track, setTrack] = useState<number | null>(null);
  const p = lp.project;

  return (
    <section>
      <div className="title-row">
        <h2>{lp.name}</h2>
        <button onClick={() => download(`${lp.name}.json`, toJson({ project: lp.project, notes: lp.notes, drums: lp.drums, mpe: lp.mpe, autom: lp.autom }))}>
          Export JSON
        </button>
      </div>
      {lp.issues.map((i) => (
        <div key={i.file} className="error">
          <b>{i.file}</b>: {i.message}
        </div>
      ))}
      {!p ? (
        <p>project.dat could not be read.</p>
      ) : track !== null ? (
        <TrackView lp={lp} index={track} onBack={() => setTrack(null)} onSelect={setTrack} />
      ) : (
        <>
          <div className="tabs">
            {(['tracks', 'overview', 'song', 'json'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t === 'json' ? 'JSON' : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="cards">
              <dl className="card">
                <dt>Tempo</dt>
                <dd>{tempoLabel(p)} BPM</dd>
                <dt>Time signature</dt>
                <dd>{signatureLabel(p)}</dd>
                <dt>Project scale</dt>
                <dd>{projectScaleLabel(p)}</dd>
                <dt>pQuant</dt>
                <dd>{pQuantLabel(p)}</dd>
                <dt>TR16 transpose</dt>
                <dd>{trspLabel(p)}</dd>
              </dl>
              {p.lfos.map((l, i) => (
                <dl className="card" key={i}>
                  <dt>Project LFO {'AB'[i]}</dt>
                  <dd>
                    {label(LFO_WAVE, l.wave)} · sync {l.sync ? 'on' : 'off'} · rate #{l.rate} · phase {l.phase} · level {l.level}
                  </dd>
                </dl>
              ))}
              <dl className="card">
                <dt>Unknown globals</dt>
                <dd className="muted">
                  +11 = {p.u_global11}, +12 = {p.u_global12}
                </dd>
                {p.mpePorts.length > 0 && (
                  <>
                    <dt>MPE ports</dt>
                    <dd>{p.mpePorts.map((m) => `kind ${m.port.kind}/${m.port.index} ch ${m.u_a + 1}–${m.u_b + 1}`).join(', ')}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {tab === 'tracks' && (
            <table className="tracks">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Output</th>
                  <th>Input</th>
                  <th>Events</th>
                  <th>Autom</th>
                  <th>FX chain</th>
                </tr>
              </thead>
              <tbody>
                {p.tracks.map((t, i) => {
                  const events = eventCount(lp, i);
                  const lanes = laneCount(lp, i);
                  const fx = t.fx.slots.filter((s) => s && s.type !== 0).map((s) => fxName(s!.type));
                  const idle = !events && !lanes && !fx.length && !t.name;
                  return (
                    <tr key={i} className={idle ? 'idle' : ''} onClick={() => setTrack(i)}>
                      <td>{i + 1}</td>
                      <td>
                        <span className={`type ${trackTypeLabel(t).toLowerCase()}`}>{trackTypeLabel(t)}</span>
                      </td>
                      <td>{t.name ?? <span className="muted">—</span>}</td>
                      <td>{outputLabel(t)}</td>
                      <td>{inputLabel(t)}</td>
                      <td>{events || ''}</td>
                      <td>{lanes || ''}</td>
                      <td>{fx.join(' → ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {tab === 'song' && (
            <div className="cards">
              <div className="card">
                <h3>Sections</h3>
                {p.sections.length === 0 && <p className="muted">No sections.</p>}
                <table>
                  <tbody>
                    {p.sections.map((s, i) => (
                      <tr key={i}>
                        <th>{s.name}</th>
                        <td className="mono">{s.patterns.map((n) => n + 1).join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {p.sections.length > 0 && <p className="muted">Pattern per track, tracks 1–16.</p>}
              </div>
              <div className="card">
                <h3>Song</h3>
                {p.song.length === 0 && <p className="muted">No song entries.</p>}
                <ol>
                  {p.song.map((e, i) => (
                    <li key={i}>
                      {p.sections[e.section]?.name ?? `section #${e.section}`} · length {e.length}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {tab === 'json' && <pre className="json">{toJson(p, 1)}</pre>}
        </>
      )}
    </section>
  );
};
