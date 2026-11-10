import { disablePush, enablePush, pushEnabled } from '../lib/push';
import { BAR_MAX, BAR_MIN, DEFAULT_NAV, NAV_LABEL, normNav, type NavId } from '../lib/nav';
import { ALL_PLATFORMS, DEFAULT_RETRO, sectionOf } from '../lib/platforms';
import { enrichGames, metascoreBackfill, resyncGameSections } from '../lib/remote';
import { ChevBtn } from '../components/Icons';
import { ChangeEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ACCENTS, Settings } from '../lib/theme';
import { Profile, removeAvatar, uploadAvatar } from '../lib/profile';
import Avatar from '../components/Avatar';
import { IconBack } from '../components/Icons';
import ImportCard from '../components/ImportCard';

interface Props { profile: Profile; onBack: () => void; onProfile: (p: Profile) => void; onSettings: (s: Settings) => void }

export default function ProfileScreen({ profile, onBack, onProfile, onSettings }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = profile.settings;
  const set = (patch: Partial<Settings>) => onSettings({ ...s, ...patch });
  const [retroOpen, setRetroOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState('');
  useEffect(() => { pushEnabled().then(setPushOn).catch(() => undefined); }, []);
  const [tabsOpen, setTabsOpen] = useState(false);
  const tabs = s.tabs ?? { order: ['watched', 'playing', 'backlog'], def: 'watched' };
  const TAB_LABEL: Record<string, string> = { watched: 'Watched / Finished', playing: 'Now & Next', backlog: 'Backlog' };
  const nav = normNav(s.nav);
  const saveNav = (n: { bar: NavId[]; side: NavId[] }) => set({ nav: normNav(n) });
  const moveNav = (where: 'bar' | 'side', i: number, d: number) => {
    const list = [...nav[where]]; const j = i + d; if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    saveNav({ ...nav, [where]: list });
  };
  const [retroDraft, setRetroDraft] = useState<string[] | null>(null);
  const [retroNote, setRetroNote] = useState('');
  const [mcBusy, setMcBusy] = useState(false);
  const [gBusy, setGBusy] = useState(false);
  const [gNote, setGNote] = useState('');
  const [mcNote, setMcNote] = useState('');

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setError('');
    try { onProfile({ ...profile, avatar_url: await uploadAvatar(profile.id, f) }); }
    catch (err) { setError('Couldn’t upload the photo: ' + ((err as Error).message || 'try another image.')); }
    setBusy(false);
  };

  return (
    <div className="app">
      <header className="top">
        <div className="title-row">
          <button className="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
          <h1 className="section-title">Profile</h1>
        </div>
      </header>
      <main className="content stack-lg">
        <div className="avatar-block">
          <Avatar url={profile.avatar_url} email={profile.email} size={104} />
          <div className="row">
            <label className="btn primary file-btn">{busy ? 'Uploading…' : 'Change photo'}<input type="file" accept="image/*" onChange={pick} /></label>
            {profile.avatar_url && <button className="btn ghost" onClick={async () => { await removeAvatar(profile.id); onProfile({ ...profile, avatar_url: null }); }}>Remove</button>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        <section className="card">
          <span className="muted small">Email</span>
          <strong>{profile.email}</strong>
        </section>

        <section className="card stack">
          <h2 className="h2">Settings</h2>
          <span className="muted small">Theme</span>
          <div className="segmented">
            {(['dark', 'light'] as const).map((t) => <button key={t} aria-pressed={s.theme === t} className={s.theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>{t === 'dark' ? 'Dark' : 'Light'}</button>)}
          </div>
          <span className="muted small">Score scale</span>
          <div className="segmented">
            {([5, 10] as const).map((n) => <button key={n} aria-pressed={s.scale === n} className={s.scale === n ? 'on' : ''} onClick={() => set({ scale: n })}>{n}-point</button>)}
          </div>
          <button className="switch-row flat" role="switch" aria-checked={s.posterScore} onClick={() => set({ posterScore: !s.posterScore })}>
            <span className="stack-sm grow"><strong>My score on posters</strong><span className="muted small">Score ring in the corner of posters in lists and grid</span></span>
            <span className={'switch' + (s.posterScore ? ' on' : '')}><span /></span>
          </button>
          <button className="switch-row flat" role="switch" aria-checked={s.listMetascore} onClick={() => set({ listMetascore: !s.listMetascore })}>
            <span className="stack-sm grow"><strong>Metascore in Watched</strong><span className="muted small">Metascore in the Watched list and grid. Backlog always shows it</span></span>
            <span className={'switch' + (s.listMetascore ? ' on' : '')}><span /></span>
          </button>
          {/* push notifications on this phone */}
          <button className="switch-row flat" role="switch" aria-checked={pushOn} disabled={pushBusy} onClick={async () => {
            setPushBusy(true); setPushNote('');
            try { if (pushOn) { await disablePush(); setPushOn(false); } else { await enablePush(); setPushOn(true); setPushNote('Notifications are on for this device.'); } }
            catch (e) { setPushNote((e as Error).message); }
            setPushBusy(false);
          }}>
            <span className="stack-sm grow"><strong>Notifications</strong><span className="muted small">Friend requests, your friends’ activity, and what comes out today from your lists</span></span>
            <span className={'switch' + (pushOn ? ' on' : '')}><span /></span>
          </button>
          {pushNote && <span className="muted small">{pushNote}</span>}

          {/* navigation: what's in the bottom bar (and in which order) and what's in the side menu */}
          <button className="switch-row flat" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen}>
            <span className="stack-sm grow"><strong>Navigation</strong><span className="muted small">Bottom bar: {nav.bar.map((x) => NAV_LABEL[x]).join(' · ')}</span></span>
            <ChevBtn open={navOpen} size={30} />
          </button>
          {navOpen && (
            <div className="stack-sm nav-edit">
              <span className="list-group-title">Bottom bar · the app opens on the first one</span>
              <div className="list-group">
                {nav.bar.map((id, i) => (
                  <div key={id} className="list-row nav-row">
                    <span className="li-label">{NAV_LABEL[id]}</span>
                    <button className="nav-btn" aria-label={'Move ' + NAV_LABEL[id] + ' up'} disabled={i === 0} onClick={() => moveNav('bar', i, -1)}>↑</button>
                    <button className="nav-btn" aria-label={'Move ' + NAV_LABEL[id] + ' down'} disabled={i === nav.bar.length - 1} onClick={() => moveNav('bar', i, 1)}>↓</button>
                    <button className="nav-btn wide" disabled={nav.bar.length <= BAR_MIN} onClick={() => saveNav({ bar: nav.bar.filter((x) => x !== id), side: [id, ...nav.side] })}>To menu</button>
                  </div>
                ))}
              </div>
              <span className="list-group-title">Side menu</span>
              <div className="list-group">
                {nav.side.map((id, i) => (
                  <div key={id} className="list-row nav-row">
                    <span className="li-label">{NAV_LABEL[id]}</span>
                    <button className="nav-btn" aria-label={'Move ' + NAV_LABEL[id] + ' up'} disabled={i === 0} onClick={() => moveNav('side', i, -1)}>↑</button>
                    <button className="nav-btn" aria-label={'Move ' + NAV_LABEL[id] + ' down'} disabled={i === nav.side.length - 1} onClick={() => moveNav('side', i, 1)}>↓</button>
                    <button className="nav-btn wide" disabled={nav.bar.length >= BAR_MAX} onClick={() => saveNav({ bar: [...nav.bar, id], side: nav.side.filter((x) => x !== id) })}>To bar</button>
                  </div>
                ))}
              </div>
              <span className="muted small">The bottom bar holds {BAR_MIN}–{BAR_MAX} sections. {nav.bar.length >= BAR_MAX ? 'It’s full — move one to the menu first.' : ''}</span>
              <span className="list-group-title">Open the app on</span>
              <div className="tn-chips">{[...nav.bar, ...nav.side].map((id) => <button key={id} className={'chip' + ((s.nav?.start ?? nav.bar[0]) === id ? ' on' : '')} onClick={() => set({ nav: { ...normNav(s.nav), start: id } })}>{NAV_LABEL[id]}</button>)}</div>
              <button className="link left" onClick={() => saveNav(DEFAULT_NAV)}>Reset to default</button>
            </div>
          )}

          {/* tabs inside a section: their order and which one opens first */}
          <button className="switch-row flat" onClick={() => setTabsOpen(!tabsOpen)} aria-expanded={tabsOpen}>
            <span className="stack-sm grow"><strong>Tabs</strong><span className="muted small">{tabs.order.map((t) => TAB_LABEL[t]).join(' · ')} · opens on {TAB_LABEL[tabs.def]}</span></span>
            <ChevBtn open={tabsOpen} size={30} />
          </button>
          {tabsOpen && (
            <div className="stack-sm nav-edit">
              <span className="list-group-title">Order</span>
              <div className="list-group">
                {tabs.order.map((t, i) => (
                  <div key={t} className="list-row nav-row">
                    <span className="li-label">{TAB_LABEL[t]}</span>
                    <button className="nav-btn" aria-label={'Move ' + TAB_LABEL[t] + ' left'} disabled={i === 0} onClick={() => { const o = [...tabs.order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; set({ tabs: { ...tabs, order: o } }); }}>↑</button>
                    <button className="nav-btn" aria-label={'Move ' + TAB_LABEL[t] + ' right'} disabled={i === tabs.order.length - 1} onClick={() => { const o = [...tabs.order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; set({ tabs: { ...tabs, order: o } }); }}>↓</button>
                  </div>
                ))}
              </div>
              <span className="list-group-title">Opens on</span>
              <div className="tn-chips">{tabs.order.map((t) => <button key={t} className={'chip' + (tabs.def === t ? ' on' : '')} onClick={() => set({ tabs: { ...tabs, def: t } })}>{TAB_LABEL[t]}</button>)}</div>
              <span className="muted small">Now & Next: what you’re in, your Up next, what’s out and what’s coming.</span>
            </div>
          )}

          {/* which platforms count as Retro (the rest of the consoles go to Console games) */}
          <button className="switch-row flat" onClick={() => setRetroOpen(!retroOpen)} aria-expanded={retroOpen}>
            <span className="stack-sm grow"><strong>Retro platforms</strong><span className="muted small">{(s.retroPlatforms ?? DEFAULT_RETRO).length} platforms go to Retro games — tap to change</span></span>
            <ChevBtn open={retroOpen} size={30} />
          </button>
          {retroOpen && (
            <div className="stack-sm">
              <div className="plat-grid">
                {ALL_PLATFORMS.filter((p) => p.section !== 'pc' && !p.key.startsWith('psvr2')).map((p) => {
                  const list = retroDraft ?? s.retroPlatforms ?? DEFAULT_RETRO, on = list.includes(p.key);
                  return <button key={p.key} className={'chip plat-chip' + (on ? ' on' : '')} aria-pressed={on}
                    onClick={() => setRetroDraft((d) => { const cur = d ?? list; return on ? cur.filter((k) => k !== p.key) : [...cur, p.key]; })}>{p.label}</button>;
                })}
              </div>
              {retroDraft && <div className="row nowrap">
                <button className="btn grow" onClick={() => setRetroDraft(null)}>Cancel</button>
                <button className="btn primary grow" onClick={async () => { const list = retroDraft; setRetroDraft(null); set({ retroPlatforms: list }); const n = await resyncGameSections((k) => sectionOf(k, list)); setRetroNote(n ? n + (n === 1 ? ' game moved.' : ' games moved.') : 'Saved.'); }}>Save</button>
              </div>}
              {retroNote && <span className="muted small">{retroNote}</span>}
            </div>
          )}
          <span className="muted small">Accent</span>
          <div className="row">
            {ACCENTS.map((a) => (
              <button key={a.id} className={'swatch' + (s.accent === a.id ? ' on' : '')} aria-label={a.label + ' accent'} aria-pressed={s.accent === a.id} onClick={() => set({ accent: a.id })}>
                <span style={{ background: a[s.theme] }} />
              </button>
            ))}
          </div>
        </section>

        <div className="card stack-sm">
          <strong>Fill in game details</strong>
          <span className="muted small">Imported games get time to beat (HowLongToBeat), Metascore and backgrounds. A couple of games at a time — a few minutes for a big library.</span>
          <button className="btn" disabled={gBusy} onClick={async () => { setGBusy(true); setGNote(''); let left = 1, done = 0;
            try { while (left > 0) { const r = await enrichGames(); done += r.done; left = r.left; setGNote(done + ' done · ' + left + ' left'); if (!r.done) break; } setGNote('Done — ' + done + ' games updated.'); }
            catch { setGNote('Stopped — try again later (' + done + ' done).'); } setGBusy(false); }}>{gBusy ? 'Working…' : 'Fill game details'}</button>
          {gNote && <span className="muted small">{gNote}</span>}
        </div>
        <div className="card stack-sm">
          <strong>Metascores from Metacritic</strong>
          <span className="muted small">Movies and shows without a Metascore get one from Metacritic (series almost never had one). Takes a few minutes; you can keep using the app.</span>
          <button className="btn" disabled={mcBusy} onClick={async () => { setMcBusy(true); setMcNote(''); let found = 0, left = 1;
            try { while (left > 0) { const r = await metascoreBackfill(); found += r.found; left = r.left; setMcNote('Found ' + found + ' · ' + left + ' left to check'); if (!r.checked) break; } setMcNote('Done — found ' + found + ' Metascores.'); }
            catch { setMcNote('Stopped — try again later (found ' + found + ').'); } setMcBusy(false); }}>{mcBusy ? 'Checking…' : 'Fill missing Metascores'}</button>
          {mcNote && <span className="muted small">{mcNote}</span>}
        </div>
        <p className="muted small credits">Game data from <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB</a> · <a href="https://rawg.io" target="_blank" rel="noopener">RAWG</a> · <a href="https://thegamesdb.net" target="_blank" rel="noopener">TheGamesDB</a> · <a href="https://www.steamgriddb.com" target="_blank" rel="noopener">SteamGridDB</a>, <a href="https://howlongtobeat.com" target="_blank" rel="noopener">HowLongToBeat</a>, <a href="https://www.metacritic.com" target="_blank" rel="noopener">Metacritic</a>. Movies and shows from TMDB. Platform logos: “Black & White” platform logo set.</p>
        <ImportCard email={profile.email} />

        <button className="btn danger" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </main>
    </div>
  );
}
