import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Profile } from '../lib/profile';
import { saveIdentity } from '../lib/profile';
import { activityFeed, answerRequest, dismissSuggestion, findByHandle, friendList, inviteUrl, myTitleIds, removeFriend, requestFriend, type Activity, type FriendRow, type MiniTitle } from '../lib/friends';
import { addToBacklog } from '../lib/remote';
import { TIERS } from '../lib/scores';
import { Poster } from '../components/Rows';
import PlatformIcon from '../components/PlatformIcon';
import FriendPage from './FriendPage';
import { useBackLayer } from '../lib/back';
import Avatar from '../components/Avatar';
import { IconBack, IconMenu } from '../components/Icons';

/** Friends: your invite link / QR, requests, suggestions from AppSheet, and your friends. */
export default function Friends({ profile, onProfile, onBack, onMenu, onOpenFriend }: {
  profile: Profile; onProfile: (p: Profile) => void; onBack?: () => void; onMenu?: () => void; onOpenFriend?: (f: FriendRow) => void;
}) {
  const [rows, setRows] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [note, setNote] = useState('');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState(profile.display_name ?? '');
  const [handle, setHandle] = useState(profile.handle ?? '');
  const [idErr, setIdErr] = useState('');
  const link = profile.invite_code ? inviteUrl(profile.invite_code) : '';
  const [tab, setTab] = useState<'activity' | 'people'>('activity');
  const [feed, setFeed] = useState<Activity[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [friendOpen, setFriendOpen] = useState<string | null>(null);
  const [titleOpen, setTitleOpen] = useState<(MiniTitle & { section?: string; platform?: string | null }) | null>(null);
  useBackLayer(!!titleOpen, () => setTitleOpen(null));
  useEffect(() => { activityFeed().then(setFeed).catch(() => undefined).finally(() => setFeedLoading(false)); myTitleIds().then(setMine).catch(() => undefined); }, []);
  const tierOf = (id?: string | null) => TIERS.find((t) => t.id === id) ?? null;
  const ago = (iso: string) => { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? Math.max(1, m) + ' min' : m < 1440 ? Math.floor(m / 60) + ' h' : m < 10080 ? Math.floor(m / 1440) + ' d' : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const verb = (a: Activity) => {
    const what = a.section === 'tv' ? 'watching' : a.section === 'books' ? 'reading' : a.section === 'movies' ? 'watching' : 'playing';
    if (a.kind === 'started') return 'started ' + what;
    if (a.kind === 'dropped') return 'dropped';
    if (a.kind === 'season_rated') return 'rated ' + (a.seasons_label ?? 'a season') + ' of';
    return a.section === 'books' ? 'finished reading' : a.section === 'movies' ? 'watched' : a.section === 'tv' ? 'finished' : 'finished';
  };
  const addTitle = async (t: MiniTitle & { section?: string; platform?: string | null }) => {
    if (!t.title_id || !t.section) return;
    try { await addToBacklog(t.title_id, t.section as never, 0, (['console', 'pc', 'retro'].includes(t.section) ? { platform: t.platform ?? null } : t.section === 'books' ? { format: 'paper' } : {}) as never); setMine(new Set([...mine, t.title_id])); setNote('Added to your Backlog.'); }
    catch { setNote('Couldn’t add it. Try again.'); }
    setTitleOpen(null);
  };

  const load = useCallback(async () => { try { setRows(await friendList()); } catch { setNote('Couldn’t load your friends. Try again.'); } setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#111111', light: '#ffffff' } }).then(setQr).catch(() => undefined); }, [link]);

  const friends = rows.filter((r) => r.kind === 'friend' && r.status === 'accepted');
  const incoming = rows.filter((r) => r.kind === 'friend' && r.status === 'pending' && r.incoming);
  const sent = rows.filter((r) => r.kind === 'friend' && r.status === 'pending' && !r.incoming);
  const suggested = rows.filter((r) => r.kind === 'suggestion');
  const label = (r: { name: string | null; handle: string | null }) => r.name || (r.handle ? '@' + r.handle : 'Someone');
  const act = (key: string, fn: () => Promise<void>, done?: string) => async () => { setBusy(key); try { await fn(); if (done) setNote(done); await load(); } catch (e) { setNote((e as Error).message || 'Something went wrong.'); } setBusy(''); };

  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: 'Queued', text: 'Be my friend on Queued', url: link }); else { await navigator.clipboard.writeText(link); setNote('Link copied.'); } }
    catch { /* cancelled */ }
  };
  const needsId = !profile.display_name && !profile.handle;

  return (
    <div className="app section-in">
      <header className="top"><div className="title-row">
        {onBack ? <button className="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button> : <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>}
        <div className="title-block"><h1 className="section-title">Friends</h1><span className="muted small">{friends.length ? friends.length + (friends.length === 1 ? ' friend' : ' friends') : 'Watch, play and read together'}</span></div>
      </div></header>
      <main className="content home">
        <div className="seg" role="tablist"><button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity</button><button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>People{incoming.length ? ' · ' + incoming.length : ''}</button></div>
        {tab === 'activity' && <>
          {feedLoading ? <div className="card-wait"><span className="spinner" aria-hidden="true" /></div>
            : !feed.length ? <div className="empty">{friends.length ? 'Nothing from your friends yet. When they start, finish or rate something, it shows up here.' : 'Add friends to see what they watch, play and read.'}</div>
            : <section className="panel feed">{feed.map((a) => { const tr = tierOf(a.tier); return (
              <div key={a.id} className="feed-row">
                <button className="feed-who" onClick={() => setFriendOpen(a.user_id)} aria-label={a.name ?? a.handle ?? 'Friend'}><Avatar url={a.avatar_url} email={a.handle ?? a.name ?? '?'} size={36} /></button>
                <button className="feed-body" onClick={() => setTitleOpen({ title_id: a.title_id, title: a.title, poster_url: a.poster_url, section: a.section, platform: a.platform })}>
                  <span className="feed-line"><strong>{a.name || (a.handle ? '@' + a.handle : 'Friend')}</strong> {verb(a)} <strong>{a.title}</strong>{a.kind === 'finished' && a.seasons_label ? ' · ' + a.seasons_label : ''}</span>
                  <span className="feed-meta">{tr && <span className="tier-under" style={{ background: tr.color }}>{tr.label}</span>}{a.kind === 'dropped' && <span className="tier-under none">Dropped</span>}
                    {a.platform && ['console', 'pc', 'retro'].includes(a.section) && <PlatformIcon k={a.platform} size={10} />}<span className="muted tiny">{ago(a.created_at)}</span></span>
                </button>
                <Poster t={{ title: a.title, poster_url: a.poster_url }} w={40} h={58} />
              </div>
            ); })}</section>}
        </>}
        {tab === 'people' && <>
        {/* who you are for friends */}
        <section className="panel">
          <div className="panel-head"><span>How friends see you</span></div>
          <div className="row nowrap"><Avatar url={profile.avatar_url} email={profile.email} size={44} />
            <div className="stack-sm grow">
              <input className="text-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
              <input className="text-input" placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Your @handle" autoCapitalize="none" />
            </div></div>
          {idErr && <span className="error small">{idErr}</span>}
          {(name !== (profile.display_name ?? '') || handle.replace(/^@/, '').toLowerCase() !== (profile.handle ?? '')) &&
            <button className="btn primary" onClick={async () => { setIdErr(''); try { await saveIdentity(profile.id, name, handle); onProfile({ ...profile, display_name: name.trim() || null, handle: handle.trim().replace(/^@/, '').toLowerCase() || null }); setNote('Saved.'); } catch (e) { setIdErr((e as Error).message); } }}>Save</button>}
          {needsId && <span className="muted small">Add a name or @handle so friends know it’s you.</span>}
        </section>

        {/* invite */}
        <section className="panel">
          <div className="panel-head"><span>Invite a friend</span></div>
          <span className="muted small">Send this link. When they open it and sign in, you’re friends.</span>
          <div className="row nowrap">
            <button className="btn primary grow" disabled={!link} onClick={share}>Share invite link</button>
            <button className="btn" disabled={!qr} onClick={() => setShowQr(!showQr)}>{showQr ? 'Hide QR' : 'QR code'}</button>
          </div>
          {showQr && qr && <img className="qr-img" src={qr} alt="Invite QR code" />}
          <div className="row nowrap">
            <input className="text-input grow" placeholder="Or add by @handle" value={find} onChange={(e) => setFind(e.target.value)} autoCapitalize="none" aria-label="Find by @handle" />
            <button className="btn" disabled={!find.trim() || busy === 'find'} onClick={act('find', async () => {
              const who = await findByHandle(find.trim()); if (!who) throw new Error('No one with that @handle.');
              await requestFriend(profile.id, who.id); setFind('');
            }, 'Request sent.')}>Add</button>
          </div>
        </section>

        {note && <p className="notice" role="status" onClick={() => setNote('')}>{note}</p>}

        {incoming.length > 0 && <section className="panel">
          <div className="panel-head"><span>Requests</span><span className="count-badge">{incoming.length}</span></div>
          {incoming.map((r) => (
            <div key={r.id!} className="friend-row"><Avatar url={r.avatar_url} email={r.handle ?? r.name ?? '?'} size={40} />
              <span className="grow stack-0"><strong>{label(r)}</strong>{r.handle && r.name && <span className="muted small">@{r.handle}</span>}</span>
              <button className="btn sm" disabled={!!busy} onClick={act('n' + r.id, () => answerRequest(r.id!, false))}>Decline</button>
              <button className="btn primary sm" disabled={!!busy} onClick={act('y' + r.id, () => answerRequest(r.id!, true), 'You’re friends now.')}>Accept</button>
            </div>
          ))}
        </section>}

        {suggested.length > 0 && <section className="panel">
          <div className="panel-head"><span>From AppSheet</span></div>
          <span className="muted small">They moved your old lists here. Add them as a friend?</span>
          {suggested.map((r) => (
            <div key={r.other} className="friend-row"><Avatar url={r.avatar_url} email={r.handle ?? r.name ?? '?'} size={40} />
              <span className="grow stack-0"><strong>{label(r)}</strong>{r.handle && r.name && <span className="muted small">@{r.handle}</span>}</span>
              <button className="btn sm" disabled={!!busy} onClick={act('d' + r.other, () => dismissSuggestion(profile.id, r.other))}>Not now</button>
              <button className="btn primary sm" disabled={!!busy} onClick={act('a' + r.other, () => requestFriend(profile.id, r.other), 'Request sent.')}>Add</button>
            </div>
          ))}
        </section>}

        <section className="panel">
          <div className="panel-head"><span>Your friends</span>{friends.length > 0 && <span className="count-badge">{friends.length}</span>}</div>
          {loading ? <span className="muted small">Loading…</span> : !friends.length ? <span className="muted small">No friends yet — share your invite link.</span> : friends.map((r) => (
            <div key={r.id!} className="friend-row">
              <button className="friend-open" onClick={() => { onOpenFriend?.(r); setFriendOpen(r.other); }}><Avatar url={r.avatar_url} email={r.handle ?? r.name ?? '?'} size={40} />
                <span className="grow stack-0"><strong>{label(r)}</strong>{r.handle && r.name && <span className="muted small">@{r.handle}</span>}</span></button>
              <button className="link danger" disabled={!!busy} onClick={act('r' + r.id, async () => { if (confirm('Remove ' + label(r) + ' from friends?')) await removeFriend(r.id!); })}>Remove</button>
            </div>
          ))}
          {sent.length > 0 && <span className="muted small">Waiting for: {sent.map(label).join(', ')}</span>}
        </section>
        </>}
      </main>
      {friendOpen && <FriendPage id={friendOpen} onClose={() => setFriendOpen(null)} onTitle={(t) => setTitleOpen(t)} />}
      {titleOpen && <div className="sheet-wrap">
        <button className="sheet-scrim" aria-label="Close" onClick={() => setTitleOpen(null)} />
        <div className="sheet" role="dialog" aria-label={titleOpen.title}>
          <div className="action-head"><Poster t={{ title: titleOpen.title, poster_url: titleOpen.poster_url }} w={52} h={76} /><strong>{titleOpen.title}</strong></div>
          {titleOpen.title_id && mine.has(titleOpen.title_id) ? <span className="muted small">Already in your lists.</span>
            : titleOpen.title_id && titleOpen.section ? <button className="btn primary" onClick={() => addTitle(titleOpen)}>Add to Backlog</button> : null}
          <button className="btn" onClick={() => setTitleOpen(null)}>Close</button>
        </div>
      </div>}
    </div>
  );
}
