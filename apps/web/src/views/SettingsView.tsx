import { hex, type Card } from '@paxdat/core';

export const SettingsView = ({ card }: { card: Card }) => {
  const s = card.settings;
  return (
    <section>
      <h2>Device settings</h2>
      <p>
        AUTO.LOAD → <b>{card.autoload ?? '—'}</b>
      </p>
      {!s ? (
        <p className="muted">No settings.dat on this card.</p>
      ) : (
        <>
          <p className="muted">
            Settings are only rewritten when you select SAVE in the device's settings, so this file may come from an older
            OS than your projects.
          </p>
          <div className="cards">
            {s.groups.map((g, i) => (
              <div key={i} className="card">
                <table className="compact">
                  <tbody>
                    {g.entries.map(([k, v]) => (
                      <tr key={k}>
                        <th className="mono">{k}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <h4>Not decoded yet (colour palette …)</h4>
          <pre className="json">{hex(s.tail)}</pre>
        </>
      )}
    </section>
  );
};
