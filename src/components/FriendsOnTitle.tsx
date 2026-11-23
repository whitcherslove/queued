import { useEffect, useState } from 'react';
import { friendsOnTitle, type FriendOnTitle } from '../lib/friends';
import { TIERS } from '../lib/scores';
import Avatar from './Avatar';
import PlatformIcon from './PlatformIcon';

/** "Friends" in a card: who's in it now (with progress), who finished it (with rating), who has it in the backlog. */
export default function FriendsOnTitle({ titleId, kind }: { titleId: string | null | undefined; kind: 'movie' | 'tv' | 'game' | 'book' }) {
  const [list, setList] = useState<FriendOnTitle[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { if (titleId) friendsOnTitle(titleId).then(setList); }, [titleId]);
  if (!list || !list.length) return null;
  const doing = kind === 'tv' ? 'watching' : kind === 'book' ? 'reading' : kind === 'game' ? 'playing' : 'watching';
  const done = kind === 'book' ? 'read it' : kind === 'game' ? 'finished' : 'watched it';
  const shown = all ? list : list.slice(0, 3);
  return (
    <section className="panel fot">
      <div className="panel-head"><span>Friends</span><span className="count-badge">{list.length}</span></div>
      {shown.map((f) => { const tier = TIERS.find((x) => x.id === f.tier);
        return (
          <div key={f.id} className="fot-row">
            <Avatar url={f.avatar_url} email={f.name ?? '?'} size={30} />
            <span className="grow stack-0">
              <span className="small"><strong>{f.name ?? 'Friend'}</strong> <span className="muted">{f.status === 'playing' ? 'is ' + doing : f.status === 'done' ? done : f.status === 'dropped' ? 'dropped it' : 'has it in the backlog'}</span>
                {kind === 'game' && f.platform && <> <PlatformIcon k={f.platform} size={10} /></>}</span>
              {(f.status === 'playing' || f.status === 'dropped') && f.label && <span className={'fp-prog' + (f.status === 'dropped' ? ' stopped' : '')}>{f.status === 'dropped' && <span className="muted tiny">stopped at</span>}{f.pct != null && <span className="fp-bar"><i style={{ width: Math.max(2, Math.min(100, f.pct)) + '%' }} /></span>}<span className="muted tiny">{f.label}</span></span>}
            </span>
            {f.status === 'done' && tier && <span className="tier-under" style={{ background: tier.color }}>{tier.label}</span>}
            {f.status === 'dropped' && <span className="tier-under" style={{ background: '#A98BE0' }}>Dropped</span>}
          </div>
        ); })}
      {list.length > 3 && <button className="link left" onClick={() => setAll(!all)}>{all ? 'Show less' : '+' + (list.length - 3) + ' more'}</button>}
    </section>
  );
}
