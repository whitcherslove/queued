import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './lib/supabase';
import { applyTheme, DEFAULT_SETTINGS, Settings } from './lib/theme';
import { loadProfile, Profile, saveSettings } from './lib/profile';
import Login from './screens/Login';
import Shell from './screens/Shell';
import { claimPending, groupRows, groupTvRows, importGroups } from './lib/importer';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [claiming, setClaiming] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); applyTheme(DEFAULT_SETTINGS); return; }
    loadProfile(session.user.id, session.user.email ?? '')
      .then((p) => { setProfile(p); applyTheme(p.settings);
        claimPending().then(async ({ movies, tv }) => {
          if (!movies.length && !tv.length) return;
          const mg = groupRows(movies), tg = groupTvRows(tv);
          setClaiming(`Bringing in ${mg.length + tg.length} titles from AppSheet…`);
          if (mg.length) await importGroups(mg);
          if (tg.length) await importGroups(tg);
          setClaiming(''); window.location.reload();
        });
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
        <h1 className="wordmark">Queued</h1>
        <p className="muted">Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local (or to Vercel) and reload.</p>
      </main>
    );
  }
  if (!ready) return <main className="center-screen"><h1 className="wordmark">Queued</h1></main>;
  if (!session) return <Login />;
  if (!profile) return <main className="center-screen"><h1 className="wordmark">Queued</h1></main>;
  return <>{claiming && <div className="toast" role="status">{claiming}</div>}<Shell profile={profile} onProfile={setProfile} onSettings={updateSettings} /></>;
}
