import { fxName, targetLabel, type FxChain } from '@paxdat/core';

/** FX slots in chain order, with stored value, live value and per-pattern locks. */
export const FxChainView = ({ chain, pattern }: { chain: FxChain; pattern: number }) => {
  const slots = chain.slots.filter((s): s is NonNullable<typeof s> => s !== null).sort((a, b) => a.position - b.position);
  return (
    <div className="cards">
      {slots.map((s, i) => {
        const onOff = s.params.find((p) => p.idx === 0xff);
        const off = onOff ? onOff.value === 0 : false;
        return (
          <div key={i} className={`card fx${off ? ' off' : ''}`}>
            <h5>
              {s.position + 1}. {fxName(s.type)} {off && <span className="badge">OFF</span>}
              {s.liveOff ? <span className="badge warn" title="live state at save time">live off</span> : null}
            </h5>
            <table className="compact">
              <tbody>
                {s.params
                  .filter((p) => p.idx !== 0xff)
                  .map((p) => {
                    const lock = p.locks[pattern];
                    return (
                      <tr key={p.idx}>
                        <th>{p.name}</th>
                        <td>
                          {lock ?? p.value}
                          {lock !== null && lock !== undefined && <span className="badge" title={`stored ${p.value}`}>🔒 P{pattern + 1}</span>}
                          {p.liveValue !== p.value && (
                            <span className="muted" title="live value at save time">
                              {' '}
                              (live {p.liveValue})
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {s.modRoutes.some((m) => m.source || m.target) && (
              <>
                <h6>Mod matrix</h6>
                <ul className="compact">
                  {s.modRoutes
                    .filter((m) => m.source || m.target)
                    .map((m, j) => (
                      <li key={j}>
                        src <span className="mono">{m.source ? Array.from(m.source.slice(0, 5)).join(',') : '—'}</span> → {m.target ? targetLabel(m.target) : '—'} · depth{' '}
                        {m.depth.toFixed(2)}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
