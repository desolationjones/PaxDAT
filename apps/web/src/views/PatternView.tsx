import {
  TICKS_PER_STEP, decodePayload, drumLaneName, drumLaneRow, hasMath, mathLabel, noteName, rollLabel, type LoadedProject,
} from '@paxdat/core';
import { patternEvents } from '../model';

interface Props {
  lp: LoadedProject;
  track: number;
  pattern: number;
}

const W = 900;
const ROW = 12;

/** Piano roll (poly/MPE) or lane grid (drums) for one pattern, plus an event table. */
export const PatternView = ({ lp, track, pattern }: Props) => {
  const t = lp.project!.tracks[track];
  const { file, events } = patternEvents(lp, track, pattern);
  const isDrum = t.type === 2;
  const lengthTicks = Math.max(1, t.patterns[pattern].length) * TICKS_PER_STEP;
  if (!events.length) return <p className="muted">No events in this pattern.</p>;

  const decoded = events.map((e) => ({ e, d: decodePayload(e.payload) }));
  // drums: y axis is the device row (1 = bottom); poly/MPE: pitch
  const rowOf = (d: ReturnType<typeof decodePayload>) => (isDrum ? drumLaneRow(d.laneOrPad) : d.pitch);
  const laneAtRow = (row: number) => (row <= 8 ? 8 - row : 24 - row);
  const rows = decoded.map(({ d }) => rowOf(d));
  const lo = isDrum ? 1 : Math.min(...rows) - 2;
  const hi = isDrum ? 16 : Math.max(...rows) + 2;
  const height = (hi - lo + 1) * ROW;
  const end = Math.max(lengthTicks, ...decoded.map(({ e, d }) => e.position + d.length));
  const x = (tick: number) => (tick / end) * W;
  const y = (row: number) => (hi - row) * ROW;
  const rowLabel = (row: number) => (isDrum ? drumLaneName(t, laneAtRow(row)) : noteName(row));
  const steps = Math.ceil(end / TICKS_PER_STEP);

  return (
    <div className="pattern">
      <div className="roll-wrap">
        <svg className="roll" viewBox={`-60 0 ${W + 60} ${height}`} width="100%" role="img" aria-label="piano roll">
          {Array.from({ length: hi - lo + 1 }, (_, i) => {
            const row = hi - i;
            const black = !isDrum && [1, 3, 6, 8, 10].includes(row % 12);
            return (
              <g key={row}>
                <rect x={0} y={i * ROW} width={W} height={ROW} className={black ? 'row black' : 'row'} />
                <text x={-4} y={i * ROW + ROW - 3} className="rowlabel">
                  {rowLabel(row)}
                </text>
              </g>
            );
          })}
          {Array.from({ length: steps + 1 }, (_, s) => (
            <line key={s} x1={x(s * TICKS_PER_STEP)} x2={x(s * TICKS_PER_STEP)} y1={0} y2={height} className={s % 4 ? 'grid' : 'grid beat'} />
          ))}
          <line x1={x(lengthTicks)} x2={x(lengthTicks)} y1={0} y2={height} className="pattern-end" />
          {decoded.map(({ e, d }, i) => (
            <rect
              key={i}
              x={x(e.position)}
              y={y(rowOf(d)) + 1}
              width={Math.max(2, x(isDrum ? TICKS_PER_STEP / 2 : d.length))}
              height={ROW - 2}
              rx={2}
              className={`note${hasMath(d) ? ' math' : ''}${d.roll ? ' roll' : ''}`}
              style={{ opacity: 0.35 + (0.65 * d.velocity) / 127 }}
            >
              <title>
                {rowLabel(rowOf(d))} · vel {d.velocity} · pos {e.position} · len {d.length}
                {hasMath(d) ? ` · math ${mathLabel(d.math)}` : ''}
                {d.roll ? ` · roll ${rollLabel(d.roll)}` : ''}
              </title>
            </rect>
          ))}
        </svg>
      </div>
      <table className="compact">
        <thead>
          <tr>
            <th>Step</th>
            <th>Tick</th>
            <th>{isDrum ? 'Lane' : 'Note'}</th>
            <th>Vel</th>
            <th>Len</th>
            <th>Chance</th>
            <th>Math</th>
            <th>Roll</th>
            <th>Rel. vel</th>
            {file === 'mpe' && <th>Curves</th>}
          </tr>
        </thead>
        <tbody>
          {decoded.map(({ e, d }, i) => {
            const step = Math.floor(e.position / TICKS_PER_STEP);
            const micro = e.position - step * TICKS_PER_STEP;
            const curves = 'curves' in e ? (e as { curves: { points: unknown[] }[] }).curves : null;
            return (
              <tr key={i}>
                <td>
                  {step + 1}
                  {micro ? <span className="muted"> +{micro}t</span> : null}
                </td>
                <td className="mono">{e.position}</td>
                <td>{rowLabel(rowOf(d))}</td>
                <td>{d.velocity}</td>
                <td>{d.length >= TICKS_PER_STEP && d.length % TICKS_PER_STEP === 0 ? `${d.length / TICKS_PER_STEP} st` : `${d.length}t`}</td>
                <td>{d.chance}%</td>
                <td>{mathLabel(d.math)}</td>
                <td>{rollLabel(d.roll)}</td>
                <td>{d.releaseVelocity || ''}</td>
                {curves && <td className="muted">{curves.map((c) => c.points.length).join('/')} pts</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
