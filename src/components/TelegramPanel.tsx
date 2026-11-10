import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '../lib/profile';
import { setTelegramOff } from '../lib/profile';
import { addTgMember, leaveTgGroup, myTgGroups, removeTgMember, setTgPosting, tgConnectLink, type TgGroup } from '../lib/telegram';
import type { FriendRow } from '../lib/friends';
import Avatar from './Avatar';

/** Friends → Telegram: post or not, your companies (one Telegram chat each), who's in them, connecting a new chat. */
export default function TelegramPanel({ profile, onProfile, friends }: { profile: Profile; onProfile: (p: Profile) => void; friends: FriendRow[] }) {
  const [groups, setGroups] = useState<TgGroup[] | null>(null);
  const [off, setOff] = useState(!!profile.telegram_off);
  const [adding, setAdding] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => { myTgGroups().then(setGroups).catch(() => setGroups([])); }, []);
  useEffect(() => { load(); }, [load]);
  const act = (fn: () => Promise<void>) => async () => { try { await fn(); load(); } catch (e) { setNote((e as Error).message); } };
  const name = (r: { name: string | null }) => r.name || 'Friend';
  return (
    <section className="panel">
      <div className="panel-head"><span>Telegram</span></div>
      <button className="switch-row flat" role="switch" aria-checked={!off} onClick={async () => {
        const v = !off; setOff(v); try { await setTelegramOff(profile.id, v); onProfile({ ...profile, telegram_off: v }); } catch { setOff(!v); }
      }}>
        <span className="stack-sm grow"><strong>Post my activity</strong><span className="muted small">What you start, drop, or finish and rate goes to your companies’ chats</span></span>
        <span className={'switch' + (!off ? ' on' : '')}><span /></span>
      </button>
      {note && <span className="muted small" onClick={() => setNote('')}>{note}</span>}
      {groups === null ? <span className="muted small">Loading…</span> : groups.map((g) => {
        const inIt = new Set(g.members.map((m) => m.id));
        const canAdd = friends.filter((f) => f.kind === 'friend' && f.status === 'accepted' && !inIt.has(f.other));
        return (
          <div key={g.id} className="tg-group">
            <div className="row nowrap"><strong className="grow">{g.title}</strong>{!g.active && <span className="tier-under none">bot removed</span>}</div>
            <div className="tg-members">{g.members.map((m) => (
              <span key={m.id} className="tg-member"><Avatar url={m.avatar_url} email={m.name ?? '?'} size={22} />{name(m)}
                {m.can_remove && <button className="tg-remove" aria-label={'Remove ' + name(m) + ' from ' + g.title}
                  onClick={act(async () => { if (confirm('Remove ' + name(m) + ' from ' + g.title + '? Their posts stop going there.')) await removeTgMember(g.id, m.id); })}>×</button>}
              </span>))}</div>
            <div className="row nowrap tg-actions">
              <button className="switch-row flat grow" role="switch" aria-checked={g.posting} onClick={act(() => setTgPosting(g.id, !g.posting))}>
                <span className="small grow">Post here</span><span className={'switch' + (g.posting ? ' on' : '')}><span /></span>
              </button>
            </div>
            {adding === g.id ? (
              <div className="stack-sm">
                <span className="muted small">Add a friend to {g.title}</span>
                {canAdd.length ? canAdd.map((f) => (
                  <button key={f.other} className="friend-open" onClick={act(async () => { await addTgMember(g.id, f.other); setAdding(null); })}>
                    <Avatar url={f.avatar_url} email={f.handle ?? f.name ?? '?'} size={28} /><span className="grow">{f.name || (f.handle ? '@' + f.handle : 'Friend')}</span><span className="link">Add</span>
                  </button>
                )) : <span className="muted small">All your friends are already here.</span>}
                <button className="link left" onClick={() => setAdding(null)}>Cancel</button>
              </div>
            ) : (
              <div className="row nowrap"><button className="btn sm grow" onClick={() => setAdding(g.id)}>Add a friend</button>
                <button className="link danger" onClick={act(async () => { if (confirm('Leave ' + g.title + '? Your posts stop going there.')) await leaveTgGroup(g.id); })}>Leave</button></div>
            )}
          </div>
        );
      })}
      {groups?.length === 0 && <span className="muted small">You’re not in any company yet. Connect a Telegram chat, or ask a friend to add you to theirs.</span>}
      {link ? (
        <div className="stack-sm tg-connect">
          <span className="small">1. Tap the button and pick the group. 2. Telegram adds the bot there — it says hello. 3. Come back and tap Refresh.</span>
          <div className="row nowrap"><a className="btn primary grow" href={link} target="_blank" rel="noopener">Open Telegram</a><button className="btn" onClick={() => { setLink(null); load(); }}>Refresh</button></div>
        </div>
      ) : (
        <button className="btn" onClick={async () => { try { const l = await tgConnectLink(); if (l) setLink(l); else setNote('The bot isn’t set up yet (tg_bot_username).'); } catch (e) { setNote((e as Error).message); } }}>Connect a Telegram chat</button>
      )}
    </section>
  );
}
