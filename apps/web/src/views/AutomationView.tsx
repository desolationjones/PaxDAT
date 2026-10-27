import { targetLabel, type AutomationLane } from '@paxdat/core';

const W = 600;
const H = 60;

/** One small chart per automation lane for the selected pattern. */
export const AutomationView = ({ lanes, pattern, lengthTicks }: { lanes: AutomationLane[]; pattern: number; lengthTicks: number }) => (
  <div className="cards">
    {lanes.map((lane, i) => {
      const list = lane.patterns[pattern];
      const pts = list?.points ?? [];
      const max = lane.target.bytes[0] === 0x06 ? 16383 : Math.max(127, ...pts.map((p) => p.value));
      const end = Math.max(lengthTicks, ...pts.map((p) => p.position + 1));
      const x = (t: number) => (t / end) * W;
      const y = (v: number) => H - (v / max) * H;
      const path = pts.length
        ? `M ${x(pts[0].position)} ${y(pts[0].value)} ` +
          pts.slice(1).map((p) => `L ${x(p.position)} ${y(p.value)}`).join(' ') +
          ` L ${W} ${y(pts[pts.length - 1].value)}`
        : '';
      return (
        <div key={i} className="card autom">
          <h5>
            {targetLabel(lane.target)}
            {lane.defaultValue !== null && <span className="muted"> · default {lane.defaultValue}</span>}
          </h5>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="automation curve">
            <rect x={0} y={0} width={W} height={H} className="row" />
            {path && <path d={path} className="curve" />}
            {pts.map((p, j) => (
              <circle key={j} cx={x(p.position)} cy={y(p.value)} r={2} className="point">
                <title>
                  tick {p.position}: {p.value}
                </title>
              </circle>
            ))}
          </svg>
          <p className="muted">
            {pts.length} point{pts.length === 1 ? '' : 's'}
            {lane.rowSnap && ` · row snap ${lane.rowSnap.join(' ')}`}
          </p>
        </div>
      );
    })}
  </div>
);
