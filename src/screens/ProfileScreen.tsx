import { ALL_PLATFORMS, DEFAULT_RETRO, sectionOf } from '../lib/platforms';
import { resyncGameSections } from '../lib/remote';
import { ChevBtn } from '../components/Icons';
import { ChangeEvent, useState } from 'react';
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
  const [retroDraft, setRetroDraft] = useState<string[] | null>(null);
  const [retroNote, setRetroNote] = useState('');

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setError('');
    try { onProfile({ ...profile, avatar_url: await uploadAvatar(profile.id, f) }); }
    catch { setError('Couldn’t upload the photo. Try a smaller image.'); }
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

        <p className="muted small credits">Game data from <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB</a> · <a href="https://rawg.io" target="_blank" rel="noopener">RAWG</a> · <a href="https://thegamesdb.net" target="_blank" rel="noopener">TheGamesDB</a> · <a href="https://www.steamgriddb.com" target="_blank" rel="noopener">SteamGridDB</a>. Movies and shows from TMDB.</p>
        <ImportCard email={profile.email} />

        <button className="btn danger" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </main>
    </div>
  );
}
