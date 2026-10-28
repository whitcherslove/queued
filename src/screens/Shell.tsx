import { useState } from 'react';
import type { Profile } from '../lib/profile';
import type { Settings } from '../lib/theme';
import { IconMenu, IconMovie, IconPad, IconPc, IconRetro, IconSearch, IconTv } from '../components/Icons';
import ProfileScreen from './ProfileScreen';
import Avatar from '../components/Avatar';
import Movies from './Movies';
import { useBackLayer } from '../lib/back';

type SectionId = 'movies' | 'tv' | 'console' | 'pc' | 'retro';
const SECTIONS: { id: SectionId; label: string; title: string; icon: JSX.Element; tabs: string[]; noun: string }[] = [
  { id: 'movies', label: 'Movies', title: 'Movies', icon: <IconMovie />, tabs: ['Watched', 'Backlog'], noun: 'a movie' },
  { id: 'tv', label: 'TV Shows', title: 'TV Shows', icon: <IconTv />, tabs: ['Watched', 'Watching', 'Backlog'], noun: 'a show' },
  { id: 'console', label: 'Console', title: 'Console games', icon: <IconPad />, tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' },
  { id: 'pc', label: 'PC', title: 'PC games', icon: <IconPc />, tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' },
  { id: 'retro', label: 'Retro', title: 'Retro games', icon: <IconRetro />, tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' }
];

interface Props { profile: Profile; onProfile: (p: Profile) => void; onSettings: (s: Settings) => void }

export default function Shell({ profile, onProfile, onSettings }: Props) {
  const [section, setSection] = useState<SectionId>('movies');
  const [tab, setTab] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const sec = SECTIONS.find((s) => s.id === section)!;
  useBackLayer(drawer, () => setDrawer(false));
  useBackLayer(profileOpen, () => setProfileOpen(false));

  if (profileOpen) return <ProfileScreen profile={profile} onBack={() => setProfileOpen(false)} onProfile={onProfile} onSettings={onSettings} />;

  const nav = (
    <nav className="bottom" aria-label="Sections">
      {SECTIONS.map((s) => (
        <button key={s.id} aria-current={s.id === section ? 'page' : undefined} className={s.id === section ? 'on' : ''} onClick={() => { setSection(s.id); setTab(0); }}>
          {s.icon}<span>{s.label}</span>
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
        <span className="muted small drawer-foot">Queued · v0.4</span>
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
    <div className="screen"><div className="app">
      <header className="top">
        <div className="title-row">
          <button className="icon-btn" aria-label="Open menu" onClick={() => setDrawer(true)}><IconMenu /></button>
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
