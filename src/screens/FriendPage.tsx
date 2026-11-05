import { useEffect, useState } from 'react';
import { friendSummary, type FriendSummary, type MiniTitle } from '../lib/friends';
import { TIERS } from '../lib/scores';
import Avatar from '../components/Avatar';
import { ChevBtn, DuoBook, DuoMovie, DuoPad, DuoTv, IconBack } from '../components/Icons';
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
  const [bothOpen, setBothOpen] = useState(false);
  const first = name.split(' ')[0];
  const ago = (iso: string) => { const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); const d = Math.round((day(new Date()) - day(new Date(iso))) / 864e5); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? d + ' days ago' : d < 28 ? Math.floor(d / 7) + (d < 14 ? ' week ago' : ' weeks ago') : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const SEC_ONE: Record<string, string> = { movies: 'Movie', tv: 'Show', console: 'Game', pc: 'Game', retro: 'Game', books: 'Book' };
  const ICON: Record<string, JSX.Element> = { Movies: <DuoMovie />, Shows: <DuoTv />, Games: <DuoPad />, Books: <DuoBook /> };
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
          {/* compact taste match; the titles you both rated open on tap */}
          {s.match && s.match.common > 0 && <section className="panel match-compact">
            <button className="match-row" aria-expanded={bothOpen} onClick={() => setBothOpen(!bothOpen)}>
              <span className="match-pct">{s.match.pct ?? 0}%</span>
              <span className="grow stack-0"><strong>Taste match</strong><span className="muted small">{s.match.common} {s.match.common === 1 ? 'title' : 'titles'} you both rated</span></span>
              <ChevBtn open={bothOpen} size={28} />
            </button>
            {bothOpen && s.match.both.map((b, i) => { const m = tierOf(b.mine), t = tierOf(b.theirs); return (
              <div key={i} className="both-row"><Poster t={{ title: b.title, poster_url: b.poster_url }} w={30} h={44} /><span className="grow ellipsis">{b.title}</span>
                <span className="both-tiers">{m && <span className="tier-under" style={{ background: m.color }}>You · {m.label}</span>}{t && <span className="tier-under" style={{ background: t.color }}>{first} · {t.label}</span>}</span></div>
            ); })}
          </section>}

          {/* now: small rows */}
          {s.now.length > 0 && <section className="panel">
            <div className="panel-head"><span>Now</span></div>
            {s.now.map((t, i) => (
              <button key={i} className="now-row" onClick={() => onTitle(t)}>
                <Poster t={{ title: t.title, poster_url: t.poster_url }} w={30} h={44} />
                <span className="grow stack-0"><span className="row-title ellipsis">{t.title}</span>
                  <span className="muted small now-kind">{t.section === 'books' ? <FormatIcon f={t.format} size={11} /> : t.platform ? <PlatformIcon k={t.platform} size={10} /> : null}{t.section === 'tv' ? 'Watching' : t.section === 'books' ? 'Reading' : t.section === 'movies' ? 'Watching' : 'Playing'}</span></span>
              </button>
            ))}
          </section>}

          {/* recently finished: the same cards as on Home */}
          {s.recent.length > 0 && <section className="panel">
            <div className="panel-head"><span>Recently finished</span></div>
            <div className="home-strip">{s.recent.map((t, i) => { const tr = tierOf(t.tier); const img = (t as MiniTitle & { backdrop_url?: string | null }).backdrop_url ?? t.poster_url; return (
              <button key={i} className="fin-card" onClick={() => onTitle(t)} aria-label={t.title}>
                <span className="fin-img">{img && <img className={(t as MiniTitle & { backdrop_url?: string | null }).backdrop_url ? '' : 'blur'} src={img} alt="" />}<span className="fin-shade" />{t.at && <span className="fin-when">{ago(t.at)}</span>}</span>
                <span className="fin-cover"><Poster t={{ title: t.title, poster_url: t.poster_url }} w={52} h={76} /></span>
                <span className="fin-body"><span className="row-title ellipsis">{t.title}</span>
                  <span className="muted tiny ellipsis">{[SEC_ONE[t.section ?? ''], t.seasons_label].filter(Boolean).join(' · ')}</span>
                  <span className="fin-rate">{t.dropped ? <span className="tier-under none">Dropped</span> : tr ? <span className="tier-under" style={{ background: tr.color }}>{tr.label}</span> : <span className="tier-under none">No rating</span>}</span></span>
              </button>
            ); })}</div>
          </section>}

          {/* the year: tiles with an icon per kind */}
          {year.length > 0 && <section className="panel">
            <div className="panel-head"><span>{new Date().getFullYear()} so far</span></div>
            <div className="year-tiles">{year.map(([k, n]) => (
              <div key={k} className="year-tile"><span className="yt-icon">{ICON[k]}</span><b>{n}</b><span className="muted tiny">{k === 'Shows' ? (n === 1 ? 'show' : 'shows') : k === 'Movies' ? (n === 1 ? 'movie' : 'movies') : k === 'Games' ? (n === 1 ? 'game' : 'games') : n === 1 ? 'book' : 'books'}</span></div>
            ))}</div>
          </section>}

          {/* favourites: their latest 10/10s, newest first */}
          {s.favorites.length > 0 && <section className="panel">
            <div className="panel-head"><span>Latest 10 out of 10</span></div>
            <div className="home-strip">{s.favorites.map((t, i) => <button key={i} className="home-poster" onClick={() => onTitle(t)}><Poster t={{ title: t.title, poster_url: t.poster_url }} w={84} h={124} /><span className="tiny ellipsis">{t.title}</span></button>)}</div>
          </section>}

          {!s.now.length && !s.recent.length && !s.favorites.length && <div className="empty">Nothing to show yet.</div>}
        </>}
      </main>
    </div>
  );
}
