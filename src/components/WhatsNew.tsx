import { useBackLayer } from '../lib/back';
import { latestVersion, type ChangeEntry } from '../lib/changelog';
import Logo from './Logo';

/** "What's new" — the changes since the version you last saw. */
export default function WhatsNew({ entries, onClose }: { entries: ChangeEntry[]; onClose: () => void }) {
  useBackLayer(true, onClose);
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet whats-new" role="dialog" aria-label="What's new">
        <div className="wn-head"><Logo size={44} /><span className="stack-0"><strong className="wn-title">What’s new</strong><span className="muted small">Queued {latestVersion()}</span></span></div>
        <div className="wn-list">
          {entries.map((e) => (
            <section key={e.version} className="stack-sm">
              {entries.length > 1 && <span className="list-group-title">{e.version} · {e.title}</span>}
              {e.items.map((it) => (
                <div key={it.title} className="wn-item"><span className="wn-icon" aria-hidden="true">{it.icon}</span>
                  <span className="stack-0"><strong>{it.title}</strong><span className="muted small">{it.text}</span></span></div>
              ))}
            </section>
          ))}
        </div>
        <button className="btn primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
