import {
  FOLLOW_ACTION, RUN_MODE, TRIG_MODE, drumLaneRow, hex, inputLabel, label, mathLabel, noteName, outputLabel, rollLabel,
  scaleLabel, targetLabel, trackTypeLabel, type LoadedProject, type PatternHeader,
} from '@paxdat/core';
import { useState } from 'react';
import { patternEvents } from '../model';
import { AutomationView } from './AutomationView';
import { FxChainView } from './FxChainView';
import { PatternView } from './PatternView';

interface Props {
  lp: LoadedProject;
  index: number;
  onBack: () => void;
  onSelect: (i: number) => void;
}

const patternSummary = (p: PatternHeader): string => {
  const bits = [`${p.length} steps`];
  if (p.run) bits.push(label(RUN_MODE, p.run));
  if (p.pc !== 0xff) bits.push(`PC ${p.pc + 1}${p.msb !== 0xff ? ` MSB ${p.msb}` : ''}${p.lsb !== 0xff ? ` LSB ${p.lsb}` : ''}`);
  if (p.follow1 || p.follow2) bits.push(`follow ${label(FOLLOW_ACTION, p.follow1)}/${label(FOLLOW_ACTION, p.follow2)} 🟡`);
  return bits.join(' · ');
};

export const TrackView = ({ lp, index, onBack, onSelect }: Props) => {
  const p = lp.project!;
  const t = p.tracks[index];
  const firstUsed = t.patterns.findIndex((_, i) => patternEvents(lp, index, i).events.length > 0);
  const [pattern, setPattern] = useState(Math.max(0, firstUsed));
  const lanes = lp.autom?.tracks.find((a) => a.track === index)?.lanes ?? [];
  const isDrum = t.type === 2;

  return (
    <div>
      <div className="title-row">
        <button onClick={onBack}>← All tracks</button>
        <h3>
          Track {index + 1} · {trackTypeLabel(t)} {t.name && `· “${t.name}”`}
        </h3>
        <span className="spacer" />
        <button disabled={index === 0} onClick={() => onSelect(index - 1)}>
          ‹
        </button>
        <button disabled={index === 15} onClick={() => onSelect(index + 1)}>
          ›
        </button>
      </div>

      <div className="cards">
        <dl className="card">
          <dt>Output</dt>
          <dd>{outputLabel(t)}</dd>
          <dt>Input</dt>
          <dd>{inputLabel(t)}</dd>
          <dt>Instrument definition</dt>
          <dd>{t.instrumentFile ?? <span className="muted">none</span>}</dd>
          <dt>Elasticity</dt>
          <dd>{(t.elasticity / 100).toFixed(2)} %</dd>
        </dl>
        <dl className="card">
          <dt>Quantize / strength</dt>
          <dd>
            #{t.fx.quantize} 🟡 · {t.fx.strength} %
          </dd>
          <dt>pSCALE · pTRSP · mono edit</dt>
          <dd>
            {t.pScale ? 'on' : 'off'} · {t.pTrsp ? 'on' : 'off'} · {t.monoEdit ? 'on' : 'off'}
          </dd>
          <dt>New-note defaults</dt>
          <dd>
            vel {t.newVelocity} · chance {t.newChance} % · len {t.newNoteLength} · math {mathLabel(t.newMath)} · roll{' '}
            {rollLabel(t.newRoll)}
          </dd>
          <dt>Live-mode scale 🟡</dt>
          <dd>{scaleLabel(t.f_0x19)}</dd>
        </dl>
        <dl className="card">
          <dt>Unmapped fields</dt>
          <dd className="mono muted">
            0x18={t.f_0x18} 0x1a={t.f_0x1a} 0x1b={t.f_0x1b} 0x1c={t.f_0x1c} 0x1d={t.f_0x1d} 0x1e={t.f_0x1e} 0x2b={t.f_0x2b}{' '}
            0x14={t.f_0x14} 0x4a={t.f_0x4a} µt={t.lastMicroTime}
          </dd>
          {t.fx.ccKnobs.some(Boolean) && (
            <>
              <dt>CC knobs</dt>
              <dd>{t.fx.ccKnobs.map((k, i) => (k ? `${i + 1}: ${targetLabel(k)}` : null)).filter(Boolean).join(' · ')}</dd>
            </>
          )}
        </dl>
      </div>

      <h4>Patterns</h4>
      <div className="pattern-grid">
        {t.patterns.map((ph, i) => {
          const n = patternEvents(lp, index, i).events.length;
          return (
            <button
              key={i}
              className={`${pattern === i ? 'active' : ''} ${n ? 'used' : ''}`}
              onClick={() => setPattern(i)}
              title={patternSummary(ph)}
            >
              <b>{i + 1}</b>
              <small>{n ? `${n} ev` : '·'}</small>
            </button>
          );
        })}
      </div>
      <p className="muted">
        Pattern {pattern + 1}: {patternSummary(t.patterns[pattern])} · trig {label(TRIG_MODE, t.patterns[pattern].trig)} 🟡
      </p>
      <PatternView lp={lp} track={index} pattern={pattern} />

      <h4>FX chain</h4>
      <FxChainView chain={t.fx} pattern={pattern} />

      {lanes.length > 0 && (
        <>
          <h4>Automation (pattern {pattern + 1})</h4>
          <AutomationView lanes={lanes} pattern={pattern} lengthTicks={t.patterns[pattern].length * 48} />
        </>
      )}

      {isDrum && (
        <>
          <h4>Drum lanes</h4>
          <table className="compact">
            <thead>
              <tr>
                <th>Row 🟡</th>
                <th>Name</th>
                <th>Note</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {t.lanes
                .map((l, i) => ({ l, i, row: drumLaneRow(i) }))
                .sort((a, b) => b.row - a.row)
                .map(({ l, i, row }) => (
                <tr key={i}>
                  <td>{row}</td>
                  <td>{l.name}</td>
                  <td>{noteName(l.record[0])}</td>
                  <td className="mono muted">{hex(l.record)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};
