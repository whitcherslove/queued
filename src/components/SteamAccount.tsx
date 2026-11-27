import { useState } from 'react';
import type { Profile } from '../lib/profile';
import { loadMySteam, setSteamConnected, steamConnect, steamDisconnect, steamSync } from '../lib/steam';
import { askConfirm, notify } from '../lib/dialog';

/** Profile and settings → Steam: connect your public Steam profile (a link is enough), sync, disconnect. */
export default function SteamAccount({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile) => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { notify((e as Error).message); } setBusy(false); };
  return (
    <div className="steam-account stack-sm">
      <div className="row nowrap"><span className="steam-mark">STEAM</span><strong className="grow">{profile.steam_name ? profile.steam_name : 'Steam'}</strong>
        {profile.steam_synced_at && <span className="muted tiny">synced {new Date(profile.steam_synced_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}</div>
      {profile.steam_name ? (
        <div className="row nowrap">
          <button className="btn sm grow" disabled={busy} onClick={() => run(async () => { const r = await steamSync(); await loadMySteam(); onProfile({ ...profile, steam_synced_at: new Date().toISOString() }); notify('Synced ' + (r.games ?? 0) + ' Steam games ✓'); })}>{busy ? '…' : 'Sync now'}</button>
          <button className="btn sm" disabled={busy} onClick={() => run(async () => { if (!(await askConfirm('Disconnect Steam? Hours and achievements disappear from your cards.', { ok: 'Disconnect', danger: true }))) return; await steamDisconnect(); setSteamConnected(false); onProfile({ ...profile, steam_name: null, steam_synced_at: null }); })}>Disconnect</button>
        </div>
      ) : <>
        <span className="muted small">Paste the link to your Steam profile. The profile and “Game details” must be public in Steam’s privacy settings.</span>
        <div className="row nowrap">
          <input className="text-input grow" placeholder="steamcommunity.com/id/…" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn primary sm" disabled={busy || !link.trim()} onClick={() => run(async () => { const r = await steamConnect(link); setSteamConnected(true); await loadMySteam(); onProfile({ ...profile, steam_name: r.name ?? 'Steam', steam_synced_at: new Date().toISOString() }); notify('Steam connected ✓ — ' + (r.games ?? 0) + ' games'); setLink(''); })}>{busy ? '…' : 'Connect'}</button>
        </div>
      </>}
    </div>
  );
}
