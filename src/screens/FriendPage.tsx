import { useEffect, useState } from 'react';
import { friendSummary, type FriendSummary, type MiniTitle } from '../lib/friends';
import { TIERS } from '../lib/scores';
import Avatar from '../components/Avatar';
import { IconBack } from '../components/Icons';
import { Poster } from '../components/Rows';
import PlatformIcon from '../components/PlatformIcon';
import FormatIcon from '../components/FormatIcon';
import { useBackLayer } from '../lib/back';

const tierOf = (id?: string | null) => TIERS.find((t) => t.id === id) ?? null;
const SEC: Record<string, string> = { movies: 'Movies', tv: 'Shows', console: 'Games', pc: 'Games', retro: 'Games', books: 'Books' };

/** A friend's page: a summary their app builds for you — what they're on now, what they finished, their year, favourites and how your tastes match. */
export default function FriendPage({ id, onClose, onTitle }: { id: string; onClose: () => void; onTitle: (t: MiniTitle) => void }) {
  useBackLayer(true, onClose);
  const [s, setS] = useState<FriendSummary | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { friendSummary(id).then(setS).catch((e) => setErr((e as Error).message)); }, [id]);
  const name = s?.profile?.name || (s?.profile?.handle ? '@' + s.profile.handle : 'Friend');
  const year: [string, number][] = [];
  Object.entries(s?.year ?? {}).forEach(([k, n]) => { const key = SEC[k] ?? k; const f = year.find((x) => x[0] === key); if (f) f[1] += n; else year.push([key, n]); });
  const poster = (t: MiniTitle) => <Poster t={{ title: t.title, poster_url: t.poster_url }} w={84} h={124} />;
  return (
    <div className="card-screen friend-page">
      <header className="top"><div className="title-row">
        <button className="icon-btn" aria-label="Back" onClick={onClose}><IconBack /></button>
        <div className="title-block"><h1 className="section-title">{name}</h1>{s?.profile?.handle && s.profile.name && <span className="muted small">@{s.profile.handle}</span>}</div>
        {s?.profile && <Avatar url={s.profile.avatar_url} email={s.profile.handle ?? name} size={40} />}
      </div></header>
      <main className="content home">
        {err && <p className="error">{err}</p>}
        {!s && !err && <div className="card-wait"><span className="spinner" aria-hidden="true" /></div>}
        {s && <>
          {s.match && s.match.common > 0 && <section className="panel match">
            <div className="panel-head"><span>You and {name.split(' ')[0]}</span></div>
            <div className="match-big"><b>{s.match.pct ?? 0}%</b><span className="muted small">taste match · {s.match.common} {s.match.common === 1 ? 'title' : 'titles'} you both rated</span></div>
            {s.match.both.length > 0 && <div className="home-strip">{s.match.both.map((b, i) => { const m = tierOf(b.mine), t = tierOf(b.theirs); return (
              <span key={i} className="home-poster centered"><Poster t={{ title: b.title, poster_url: b.poster_url }} w={76} h={112} />
                <span className="both-tiers">{m && <span className="tier-under" style={{ background: m.color }}>You · {m.label}</span>}{t && <span className="tier-under" style={{ background: t.color }}>{name.split(' ')[0]} · {t.label}</span>}</span></span>
            ); })}</div>}
          </section>}

          {s.now.length > 0 && <section className="panel">
            <div className="panel-head"><span>Now</span><span className="count-badge">{s.now.length}</span></div>
            <div className="home-strip">{s.now.map((t, i) => (
              <button key={i} className="home-poster" onClick={() => onTitle(t)}>{poster(t)}
                <span className="tiny muted ellipsis">{t.section === 'books' ? <FormatIcon f={t.format} size={11} /> : t.platform ? <PlatformIcon k={t.platform} size={10} /> : null}{SEC[t.section ?? ''] === 'Shows' ? 'Watching' : SEC[t.section ?? ''] === 'Books' ? 'Reading' : SEC[t.section ?? ''] === 'Games' ? 'Playing' : ''}</span></button>
            ))}</div>
          </section>}

          {s.recent.length > 0 && <section className="panel">
            <div className="panel-head"><span>Recently finished</span></div>
            <div className="home-strip">{s.recent.map((t, i) => { const tr = tierOf(t.tier); return (
              <button key={i} className="home-poster centered" onClick={() => onTitle(t)}>{poster(t)}
                {t.dropped ? <span className="tier-under none">Dropped</span> : tr ? <span className="tier-under" style={{ background: tr.color }}>{tr.label}</span> : <span className="tier-under none">No rating</span>}
                {t.seasons_label && <span className="tiny muted ellipsis">{t.seasons_label}</span>}</button>
            ); })}</div>
          </section>}

          {(year.length > 0 || s.favorites.length > 0) && <section className="panel">
            <div className="panel-head"><span>{new Date().getFullYear()}</span></div>
            {year.length > 0 && <div className="year-chips">{year.map(([k, n]) => <span key={k} className="year-chip"><b>{n}</b>{k}</span>)}</div>}
            {s.favorites.length > 0 && <><span className="muted small">10 out of 10</span>
              <div className="home-strip">{s.favorites.map((t, i) => <button key={i} className="home-poster" onClick={() => onTitle(t)}>{poster(t)}</button>)}</div></>}
          </section>}

          {!s.now.length && !s.recent.length && !s.favorites.length && <div className="empty">Nothing to show yet.</div>}
        </>}
      </main>
    </div>
  );
}
