import { loadCard, type Card } from '@paxdat/core';
import { useCallback, useRef, useState, type DragEvent } from 'react';
import { DiffView } from './views/DiffView';
import { InstrumentView } from './views/InstrumentView';
import { ProjectView } from './views/ProjectView';
import { SettingsView } from './views/SettingsView';
import { fromDataTransfer, fromFileList } from './loadFiles';

type View =
  | { kind: 'project'; index: number }
  | { kind: 'settings' }
  | { kind: 'instrument'; index: number }
  | { kind: 'diff' };

export const App = () => {
  const [card, setCard] = useState<Card | null>(null);
  const [view, setView] = useState<View>({ kind: 'project', index: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const open = useCallback(async (read: () => Promise<Parameters<typeof loadCard>[0]>) => {
    setBusy(true);
    setError(null);
    try {
      const files = await read();
      const c = loadCard(files);
      if (!c.projects.length && !c.settings) {
        setError('No Hapax files found. Pick the SD card root or a project folder (one that contains project.dat).');
      } else {
        setCard(c);
        const auto = c.projects.findIndex((p) => p.name === c.autoload);
        setView(c.projects.length ? { kind: 'project', index: Math.max(0, auto) } : { kind: 'settings' });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void open(() => fromDataTransfer(e.dataTransfer));
  };

  const picker = (
    <>
      <button className="primary" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Reading…' : card ? 'Open another folder' : 'Open SD card or project folder'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        // non-standard but supported by Firefox, Chrome and Safari
        {...{ webkitdirectory: '', directory: '' }}
        onChange={(e) => e.target.files && open(() => fromFileList(e.target.files!))}
      />
    </>
  );

  return (
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header>
        <h1>
          PaxDAT <span className="muted">· Hapax project inspector (read-only)</span>
        </h1>
        {card && picker}
      </header>
      {error && <div className="error">{error}</div>}
      {!card ? (
        <main className="welcome">
          <p>
            Open a copy of your Hapax SD card, or a single project folder. Files are read locally in your browser and
            never uploaded. Nothing is written back.
          </p>
          {picker}
          <p className="muted">…or drag the folder onto this page.</p>
        </main>
      ) : (
        <div className="layout">
          <nav>
            <h2>Projects</h2>
            {card.projects.map((p, i) => (
              <button
                key={p.path}
                className={view.kind === 'project' && view.index === i ? 'active' : ''}
                onClick={() => setView({ kind: 'project', index: i })}
                title={p.path}
              >
                {p.name}
                {p.name === card.autoload && <span className="badge">AUTO</span>}
                {p.issues.length > 0 && <span className="badge warn">{p.issues.length}⚠</span>}
              </button>
            ))}
            <h2>Device</h2>
            <button className={view.kind === 'settings' ? 'active' : ''} onClick={() => setView({ kind: 'settings' })}>
              settings.dat {!card.settings && <span className="muted">(none)</span>}
            </button>
            {card.instruments.map((ins, i) => (
              <button
                key={ins.name}
                className={view.kind === 'instrument' && view.index === i ? 'active' : ''}
                onClick={() => setView({ kind: 'instrument', index: i })}
              >
                {ins.name}
              </button>
            ))}
            <h2>Tools</h2>
            <button
              className={view.kind === 'diff' ? 'active' : ''}
              onClick={() => setView({ kind: 'diff' })}
              disabled={card.projects.length < 2}
            >
              Compare two projects
            </button>
          </nav>
          <main>
            {view.kind === 'project' && card.projects[view.index] && (
              <ProjectView key={card.projects[view.index].path} lp={card.projects[view.index]} />
            )}
            {view.kind === 'settings' && <SettingsView card={card} />}
            {view.kind === 'instrument' && card.instruments[view.index] && (
              <InstrumentView ins={card.instruments[view.index]} />
            )}
            {view.kind === 'diff' && <DiffView card={card} />}
          </main>
        </div>
      )}
    </div>
  );
};
