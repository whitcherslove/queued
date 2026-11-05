import { Brand } from './components/Logo';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './lib/supabase';
import { applyTheme, DEFAULT_SETTINGS, Settings } from './lib/theme';
import { loadProfile, Profile, saveSettings } from './lib/profile';
import Login from './screens/Login';
import Shell from './screens/Shell';
import { acceptInvite } from './lib/friends';
import { ackPending, claimPending, groupGameRows, groupRows, groupTvRows, importGroups } from './lib/importer';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [claiming, setClaiming] = useState('');
  const [friendNote, setFriendNote] = useState('');

  // an invite link (…/?invite=CODE): remember the code (also through signing in), then clean the address
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('invite');
    if (code) { try { localStorage.setItem('queued.invite', code); } catch { /* ignore */ } window.history.replaceState(null, '', window.location.pathname); }
  }, []);
  // signed in with an invite waiting → become friends
  useEffect(() => {
    if (!profile) return;
    let code: string | null = null; try { code = localStorage.getItem('queued.invite'); } catch { /* ignore */ }
    if (!code) return;
    try { localStorage.removeItem('queued.invite'); } catch { /* ignore */ }
    acceptInvite(code).then((who) => setFriendNote('You and ' + (who.name || (who.handle ? '@' + who.handle : 'your friend')) + ' are friends now.'))
      .catch((e) => setFriendNote((e as Error).message || 'Couldn’t use that invite.'));
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!friendNote) return; const t = setTimeout(() => setFriendNote(''), 5000); return () => clearTimeout(t); }, [friendNote]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); applyTheme(DEFAULT_SETTINGS); return; }
    loadProfile(session.user.id, session.user.email ?? '')
      .then((p) => { setProfile(p); applyTheme(p.settings);
        // rows saved for you from someone's AppSheet import: check at most once a day per device
        const claimKey = 'queued.claimedAt.' + p.id;
        let lastClaim = 0; try { lastClaim = Number(localStorage.getItem(claimKey) || 0); } catch { /* ignore */ }
        if (Date.now() - lastClaim > 20 * 3600e3) claimPending().then(async ({ ids, movies, tv, games }) => {
          if (!movies.length && !tv.length && !games.length) { try { localStorage.setItem(claimKey, String(Date.now())); } catch { /* ignore */ } return; }
          const mg = groupRows(movies), tg = groupTvRows(tv), gg = groupGameRows(games);
          setClaiming(`Bringing in ${mg.length + tg.length + gg.length} titles from AppSheet…`);
          // already-imported titles are skipped, so if this gets interrupted it simply continues next time
          if (mg.length) await importGroups(mg);
          if (tg.length) await importGroups(tg);
          if (gg.length) await importGroups(gg);
          await ackPending(ids);   // only now the server forgets these rows
          try { localStorage.setItem(claimKey, String(Date.now())); } catch { /* ignore */ }
          setClaiming(''); window.location.reload();
        }).catch(() => setClaiming(''));
      })
      .catch(() => {
        const p = { id: session.user.id, email: session.user.email ?? '', avatar_url: null, settings: DEFAULT_SETTINGS };
        setProfile(p); applyTheme(p.settings);
      });
  }, [session]);

  const updateSettings = (s: Settings) => {
    if (!profile) return;
    setProfile({ ...profile, settings: s });
    applyTheme(s);
    saveSettings(profile.id, s).catch(() => undefined);
  };

  if (!supabaseConfigured) {
    return (
      <main className="center-screen">
        <Brand size={84} />
        <p className="muted">Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local (or to Vercel) and reload.</p>
      </main>
    );
  }
  if (!ready) return <main className="center-screen"><Brand size={132} animated /></main>;
  if (!session) return <Login />;
  if (!profile) return <main className="center-screen"><Brand size={132} animated /></main>;
  return <>{claiming && <div className="toast" role="status">{claiming}</div>}{friendNote && <div className="toast" role="status" onClick={() => setFriendNote('')}>{friendNote}</div>}<Shell profile={profile} onProfile={setProfile} onSettings={updateSettings} /></>;
}
