import { useEffect, useState } from 'react';
import { friendList, type FriendRow } from '../lib/friends';
import Avatar from './Avatar';
import { useBackLayer } from '../lib/back';

/** Pick friends you played with (co-op). */
export default function FriendPicker({ selected, onCancel, onDone }: { selected: string[]; onCancel: () => void; onDone: (ids: string[]) => void }) {
  useBackLayer(true, onCancel);
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [sel, setSel] = useState<string[]>(selected);
  useEffect(() => { friendList().then((r) => setFriends(r.filter((x) => x.kind === 'friend' && x.status === 'accepted'))).catch(() => setFriends([])); }, []);
  const name = (r: FriendRow) => r.name || (r.handle ? '@' + r.handle : 'Friend');
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label="Played with">
        <strong className="sheet-title">Played with</strong>
        {friends === null ? <span className="muted small">Loading…</span> : !friends.length ? <span className="muted small">No friends yet — invite them in Friends.</span> : (
          <div className="list-group">
            {friends.map((f) => { const on = sel.includes(f.other); return (
              <button key={f.other} className="list-row" role="checkbox" aria-checked={on} onClick={() => setSel(on ? sel.filter((x) => x !== f.other) : [...sel, f.other])}>
                <Avatar url={f.avatar_url} email={f.handle ?? f.name ?? '?'} size={32} /><span className="li-label">{name(f)}</span>
                <span className={'switch' + (on ? ' on-green' : '')}><span /></span>
              </button>
            ); })}
          </div>
        )}
        <div className="row nowrap"><button className="btn grow" onClick={onCancel}>Cancel</button><button className="btn primary grow" onClick={() => onDone(sel)}>Save</button></div>
      </div>
    </div>
  );
}
