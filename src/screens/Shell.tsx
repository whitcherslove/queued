import { useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import type { Profile } from '../lib/profile';
import type { Settings } from '../lib/theme';
import { DuoMovie, DuoPad, DuoPc, DuoRetro, DuoTv, IconBack, IconMenu, IconSearch } from '../components/Icons';
import ProfileScreen from './ProfileScreen';
import Avatar from '../components/Avatar';
import Movies from './Movies';
import { useBackLayer } from '../lib/back';

type SectionId = 'movies' | 'tv' | 'console' | 'pc' | 'retro';
// Each section has its own color: it lights up the bottom-bar icon when the section is open
const SECTIONS: { id: SectionId; label: string; title: string; icon: JSX.Element; color: string; tabs: string[]; noun: string }[] = [
  { id: 'movies', label: 'Movies', title: 'Movies', icon: <DuoMovie />, color: '#E8714A', tabs: ['Watched', 'Backlog'], noun: 'a movie' },
  { id: 'tv', label: 'TV Shows', title: 'TV Shows', icon: <DuoTv />, color: '#9A8CF0', tabs: ['Watched', 'Watching', 'Backlog'], noun: 'a show' },
  { id: 'console', label: 'Console', title: 'Console games', icon: <DuoPad />, color: '#2FB98A', tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' },
  { id: 'pc', label: 'PC', title: 'PC games', icon: <DuoPc />, color: '#4C9BEA', tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' },
  { id: 'retro', label: 'Retro', title: 'Retro games', icon: <DuoRetro />, color: '#E0A43A', tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' }
];
const BAR: SectionId[] = ['movies', 'tv', 'console', 'pc'];
const tick = () => { try { navigator.vibrate?.(10); } catch { /* not supported (iPhone) */ } };

interface Props { profile: Profile; onProfile: (p: Profile) => void; onSettings: (s: Settings) => void }

export default function Shell({ profile, onProfile, onSettings }: Props) {
  const [section, setSection] = useState<SectionId>('movies');
  const [lastBar, setLastBar] = useState<SectionId>('movies');
  // Same soft transition as BarTab: the browser cross-fades the old and new screen (View Transitions);
  // the bottom bar stays put and its highlight glides to the new tab.
  const go = (id: SectionId) => {
    tick();
    const apply = () => { if (id !== 'retro') setLastBar(id); setSection(id); setTab(0); };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (doc.startViewTransition && !calm && id !== section) doc.startViewTransition(() => flushSync(apply));
    else apply();
  };
  // Retro lives in the side menu: back (arrow, gesture) returns to the tab you came from
  useBackLayer(section === 'retro', () => setSection(lastBar));
  const [tab, setTab] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const sec = SECTIONS.find((s) => s.id === section)!;
  useBackLayer(drawer, () => setDrawer(false));
  useBackLayer(profileOpen, () => setProfileOpen(false));

  if (profileOpen) return <ProfileScreen profile={profile} onBack={() => setProfileOpen(false)} onProfile={onProfile} onSettings={onSettings} />;

  const nav = (
    <nav className="bottom duo-bar" aria-label="Sections" style={{ '--n': BAR.length, '--i': Math.max(0, BAR.indexOf(section)), '--glide': SECTIONS.find((x) => x.id === section)?.color } as CSSProperties}>
      {BAR.includes(section) && <span className="tab-glider" aria-hidden="true" />}
      {SECTIONS.filter((s) => BAR.includes(s.id)).map((s) => (
        <button key={s.id} aria-current={s.id === section ? 'page' : undefined} className={s.id === section ? 'on' : ''} style={{ ['--sec' as string]: s.color }} onClick={() => go(s.id)}>
          <span className="duo-icon">{s.icon}</span><span>{s.label}</span>
        </button>
      ))}
    </nav>
  );
  const drawerEl = drawer && (
    <div className="drawer-wrap">
      <nav className="drawer" aria-label="Menu">
        <button className="drawer-profile" onClick={() => { setDrawer(false); setProfileOpen(true); }}>
          <Avatar url={profile.avatar_url} email={profile.email} size={48} />
          <span className="drawer-who"><strong>Your profile</strong><span className="muted small">{profile.email}</span></span>
        </button>
        <button className="drawer-item" onClick={() => { setDrawer(false); setProfileOpen(true); }}>Profile and settings</button>
        <span className="drawer-sec muted small">More</span>
        <button className={'drawer-item with-icon' + (section === 'retro' ? ' on' : '')} style={{ ['--sec' as string]: '#E0A43A' }} onClick={() => { setDrawer(false); go('retro'); }}>
          <span className="duo-icon drawer-duo"><DuoRetro /></span>Retro games
        </button>
        <span className="muted small drawer-foot">Queued · v0.5</span>
      </nav>
      <button className="drawer-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />
    </div>
  );

  if (section === 'movies' || section === 'tv') return (
    <div className="screen">
      <Movies key={section} kind={section === 'tv' ? 'tv' : 'movie'} settings={profile.settings} onSettings={onSettings} onMenu={() => setDrawer(true)} />
      {nav}{drawerEl}
    </div>
  );

  return (
    <div className="screen"><div className="app section-in" key={section}>
      <header className="top">
        <div className="title-row">
          {section === 'retro'
            ? <button className="icon-btn" aria-label="Back" onClick={() => go(lastBar)}><IconBack /></button>
            : <button className="icon-btn" aria-label="Open menu" onClick={() => setDrawer(true)}><IconMenu /></button>}
          <h1 className="section-title">{sec.title}</h1>
        </div>
        <div className="search">
          <IconSearch />
          <label htmlFor="q" className="sr">Search your lists or add {sec.noun}</label>
          <input id="q" type="text" placeholder={`Search your lists or add ${sec.noun}`} disabled />
        </div>
        <div className="segmented" role="tablist">
          {sec.tabs.map((t, i) => (
            <button key={t} role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>
      </header>

      <main className="content">
        <div className="empty">
          <p><strong>{sec.tabs[tab]}</strong> is empty for now.</p>
          <p className="muted">This section arrives in a later update.</p>
        </div>
      </main>

    </div>
    {nav}{drawerEl}
    </div>
  );
}
