import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import type { Profile } from '../lib/profile';
import type { Settings } from '../lib/theme';
import { DuoBook, DuoFriends, DuoHome, DuoMovie, DuoPad, DuoPc, DuoRetro, DuoStats, DuoTv, IconBack, IconMenu, IconSearch } from '../components/Icons';
import Home from './Home';
import Welcome from '../components/Welcome';
import Admin from './Admin';
import { amAdmin, loadChangelogDb, loadCustomPlatforms, touchSeen } from '../lib/admin';
import WhatsNew from '../components/WhatsNew';
import { allEntries, latestVersion, setDbChangelog, unseen } from '../lib/changelog';
import { registerCustomPlatforms } from '../lib/platforms';
import { initTips } from '../lib/tips';
import { supabase } from '../lib/supabase';
import Friends from './Friends';
import { normNav } from '../lib/nav';
import Stats from './Stats';
import ProfileScreen from './ProfileScreen';
import Avatar from '../components/Avatar';
import Movies from './Movies';
import { useBackLayer } from '../lib/back';

type SectionId = 'home' | 'movies' | 'tv' | 'console' | 'pc' | 'retro' | 'books' | 'stats' | 'friends';
// Each section has its own color: it lights up the bottom-bar icon when the section is open
const SECTIONS: { id: SectionId; label: string; title: string; icon: JSX.Element; color: string; tabs: string[]; noun: string }[] = [
  { id: 'home', label: 'Home', title: 'Home', icon: <DuoHome />, color: '#FFAC96', tabs: [], noun: '' },
  { id: 'movies', label: 'Movies', title: 'Movies', icon: <DuoMovie />, color: '#FFAC96', tabs: ['Watched', 'Backlog'], noun: 'a movie' },
  { id: 'tv', label: 'TV Shows', title: 'TV Shows', icon: <DuoTv />, color: '#B3A3FF', tabs: ['Watched', 'Watching', 'Backlog'], noun: 'a show' },
  { id: 'console', label: 'Console', title: 'Console games', icon: <DuoPad />, color: '#5CDED2', tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' },
  { id: 'pc', label: 'PC', title: 'PC games', icon: <DuoPc />, color: '#A6D8FF', tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' },
  { id: 'retro', label: 'Retro', title: 'Retro games', icon: <DuoRetro />, color: '#F2D58A', tabs: ['Finished', 'Playing', 'Backlog'], noun: 'a game' },
  { id: 'books', label: 'Books', title: 'Books', icon: <DuoBook />, color: '#F4A7C3', tabs: [], noun: 'a book' },
  { id: 'friends', label: 'Friends', title: 'Friends', icon: <DuoFriends />, color: '#9FD3FF', tabs: [], noun: '' },
  { id: 'stats', label: 'Stats', title: 'Stats', icon: <DuoStats />, color: '#C6B8FF', tabs: [], noun: '' }
];
// Home is the first tab and where the app opens; Retro and Stats live in the side menu

const tick = () => { try { navigator.vibrate?.(10); } catch { /* not supported (iPhone) */ } };

interface Props { profile: Profile; onProfile: (p: Profile) => void; onSettings: (s: Settings) => void }

export default function Shell({ profile, onProfile, onSettings }: Props) {
  // one-time tips, What's new after an update, the welcome cards on the very first visit
  const settingsRef = useRef(profile.settings); settingsRef.current = profile.settings;
  useEffect(() => { initTips(profile.settings.tips, (seen) => onSettings({ ...settingsRef.current, tips: seen })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [intro, setIntro] = useState<'welcome' | 'news' | null>(null);
  // platforms from Admin: the last known list right away, then the fresh one
  const [, setPlatTick] = useState(0);
  useState(() => { try { registerCustomPlatforms(JSON.parse(localStorage.getItem('queued.platforms') ?? '[]')); } catch { /* none yet */ } return 0; });
  useEffect(() => { loadCustomPlatforms().then((l) => { registerCustomPlatforms(l); try { localStorage.setItem('queued.platforms', JSON.stringify(l)); } catch { /* full */ } setPlatTick((x) => x + 1); }).catch(() => undefined); }, []);
  useEffect(() => { loadChangelogDb().then(setDbChangelog).catch(() => undefined).finally(() => {
    const st = profile.settings; const APP_VERSION = latestVersion();
    if (st.seenVersion === APP_VERSION) return;
    if (st.onboarded || st.seenVersion) { if (unseen(st.seenVersion).length) setIntro('news'); else onSettings({ ...st, seenVersion: APP_VERSION }); return; }
    // never seen anything: someone with lists already (a tester) gets What's new; a brand-new account gets the welcome
    supabase.from('library').select('id', { count: 'exact', head: true }).then(({ count }) => setIntro((count ?? 0) > 0 ? 'news' : 'welcome'));
  }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const closeIntro = () => { setIntro(null); onSettings({ ...settingsRef.current, onboarded: true, seenVersion: latestVersion() }); };
  const [newsOpen, setNewsOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  useEffect(() => { touchSeen(); amAdmin().then(setAdmin); }, []);
  const introEl = <>
    {intro === 'welcome' && <Welcome onDone={closeIntro} />}
    {intro === 'news' && <WhatsNew entries={unseen(profile.settings.seenVersion)} onClose={closeIntro} />}
    {newsOpen && <WhatsNew entries={allEntries()} onClose={() => setNewsOpen(false)} />}
  </>;
  // your layout (Profile → Navigation): the bottom bar in its order, the rest in the side menu; the app opens on the first tab
  const nav0 = normNav(profile.settings.nav);
  const BAR = nav0.bar as SectionId[];
  const SIDE = (id: SectionId) => !BAR.includes(id);
  // where the app opens: your choice (Profile → Navigation), otherwise the first tab of the bottom bar
  const startId = (profile.settings.nav?.start && (SECTIONS as { id: string }[]).some((x) => x.id === profile.settings.nav!.start) ? profile.settings.nav.start : BAR[0]) as SectionId;
  // a notification opens Queued at /?open=friends (or home): start there
  const opened = (() => { const o = new URLSearchParams(window.location.search).get('open'); if (o) window.history.replaceState(null, '', window.location.pathname); return o && (SECTIONS as { id: string }[]).some((x) => x.id === o) ? (o as SectionId) : null; })();
  const [section, setSection] = useState<SectionId>(opened ?? startId);
  const [lastBar, setLastBar] = useState<SectionId>(SIDE(startId) ? BAR[0] : startId);
  // Same soft transition as BarTab: the browser cross-fades the old and new screen (View Transitions);
  // the bottom bar stays put and its highlight glides to the new tab.
  const go = (id: SectionId) => {
    tick();
    const apply = () => { if (!SIDE(id)) setLastBar(id); setSection(id); setTab(0); };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // direction follows the bar: a tab to the right slides in from the right, to the left — from the left
    const from = BAR.indexOf(SIDE(section) ? lastBar : section), to = BAR.indexOf(SIDE(id) ? lastBar : id);
    document.documentElement.dataset.nav = SIDE(id) ? 'up' : SIDE(section) ? 'down' : to > from ? 'forward' : 'back';
    if (doc.startViewTransition && !calm && id !== section) doc.startViewTransition(() => flushSync(apply));
    else apply();
  };
  // Retro lives in the side menu: back (arrow, gesture) returns to the tab you came from
  useBackLayer(SIDE(section), () => setSection(lastBar));
  const [tab, setTab] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const sec = SECTIONS.find((s) => s.id === section)!;
  useBackLayer(drawer, () => setDrawer(false));
  useBackLayer(profileOpen, () => setProfileOpen(false));
  useBackLayer(adminOpen, () => setAdminOpen(false));

  if (adminOpen) return <Admin onBack={() => setAdminOpen(false)} />;
  if (profileOpen) return <ProfileScreen profile={profile} onBack={() => setProfileOpen(false)} onProfile={onProfile} onSettings={onSettings} />;

  const nav = (
    <nav className="bottom duo-bar" aria-label="Sections" style={{ '--n': BAR.length, '--i': Math.max(0, BAR.indexOf(section)), '--glide': SECTIONS.find((x) => x.id === section)?.color, ...(section === 'home' ? { '--glide-bg': 'linear-gradient(110deg, rgba(92,222,210,.18), rgba(255,172,150,.18), rgba(156,136,255,.18))' } : {}) } as CSSProperties}>
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
        {nav0.side.map((id) => { const sx = SECTIONS.find((x) => x.id === id)!; return (
          <button key={id} className={'drawer-item with-icon' + (section === id ? ' on' : '')} style={{ ['--sec' as string]: sx.color }} onClick={() => { setDrawer(false); go(id as SectionId); }}>
            <span className="duo-icon drawer-duo">{sx.icon}</span>{sx.title}
          </button>
        ); })}
        {admin && <button className="drawer-item" onClick={() => { setDrawer(false); setAdminOpen(true); }}>Admin</button>}
        <button className="drawer-item" onClick={() => { setDrawer(false); setNewsOpen(true); }}>What’s new</button>
        <span className="muted small drawer-foot">Queued · v4.20.1</span>
      </nav>
      <button className="drawer-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />
    </div>
  );

  if (section === 'home') return (
    <div className="screen">
      <Home settings={profile.settings} onFriends={() => go('friends')} onBack={SIDE('home') ? () => go(lastBar) : undefined} onMenu={() => setDrawer(true)} onStats={() => go('stats')} />
      {nav}{drawerEl}{introEl}
    </div>
  );
  if (section === 'books') return (
    <div className="screen">
      <Movies key="books" kind="book" settings={profile.settings} onSettings={onSettings} onMenu={() => setDrawer(true)} onBack={SIDE('books') ? () => go(lastBar) : undefined} />
      {nav}{drawerEl}{introEl}
    </div>
  );
  if (section === 'friends') return (
    <div className="screen">
      <Friends profile={profile} onProfile={onProfile} onBack={SIDE('friends') ? () => go(lastBar) : undefined} onMenu={() => setDrawer(true)} />
      {nav}{drawerEl}{introEl}
    </div>
  );
  if (section === 'stats') return (
    <div className="screen">
      <Stats settings={profile.settings} onBack={SIDE('stats') ? () => go(lastBar) : undefined} onMenu={() => setDrawer(true)} />
      {nav}{drawerEl}{introEl}
    </div>
  );
  if (section === 'console' || section === 'pc' || section === 'retro') return (
    <div className="screen">
      <Movies key={section} kind="game" gameSection={section} settings={profile.settings} onSettings={onSettings} onMenu={() => setDrawer(true)} onBack={SIDE(section) ? () => go(lastBar) : undefined} />
      {nav}{drawerEl}{introEl}
    </div>
  );
  if (section === 'movies' || section === 'tv') return (
    <div className="screen">
      <Movies key={section} kind={section === 'tv' ? 'tv' : 'movie'} settings={profile.settings} onSettings={onSettings} onMenu={() => setDrawer(true)} onBack={SIDE(section) ? () => go(lastBar) : undefined} />
      {nav}{drawerEl}{introEl}
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
    {nav}{drawerEl}{introEl}
    </div>
  );
}
