import { useEffect, useState } from 'react';
import { friendsOnTitle, type FriendOnTitle } from '../lib/friends';
import { TIERS } from '../lib/scores';
import Avatar from './Avatar';
import PlatformIcon from './PlatformIcon';
import ProgressLine from './ProgressLine';
import Platinum from './Platinum';

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
                {kind === 'game' && f.platform && <> <PlatformIcon k={f.platform} size={10} /></>}{f.platinum && <> <Platinum size={14} /></>}</span>
              {(f.status === 'playing' || f.status === 'dropped') && f.label && <ProgressLine pct={f.pct ?? null} label={f.label} stopped={f.status === 'dropped'} />}
            </span>
            {(f.status === 'done' || f.status === 'dropped') && tier && <span className="tier-under" style={{ background: tier.color }}>{tier.label}</span>}
            {f.status === 'dropped' && <span className="tier-under" style={{ background: '#A98BE0', color: '#fff' }}>Dropped</span>}
          </div>
        ); })}
      {list.length > 3 && <button className="link left" onClick={() => setAll(!all)}>{all ? 'Show less' : '+' + (list.length - 3) + ' more'}</button>}
    </section>
  );
}
