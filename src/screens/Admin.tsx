import { useEffect, useState } from 'react';
import { IconBack } from '../components/Icons';
import Avatar from '../components/Avatar';
import { useBackLayer } from '../lib/back';
import { adminConfig, adminOverview, adminSetConfig, adminTool, adminUserAction, adminUsers, type AdminUser, type ConfigRow, type Overview } from '../lib/admin';

const LABEL: Record<string, string> = { site_url: 'Site address', tg_bot_username: 'Telegram bot', cloudinary_cloud: 'Cloudinary cloud', ai_daily_limit: 'AI picks per person per day', push_url: 'Push function', push_secret: 'Push secret', tg_chat_id: 'Old Telegram chat (unused)' };
const ago = (iso: string | null) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

/** Admin (only for the app's admin): Overview · People · Settings & tools. */
export default function Admin({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'overview' | 'people' | 'settings'>('overview');
  const [ov, setOv] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [cfg, setCfg] = useState<ConfigRow[] | null>(null);
  const [who, setWho] = useState<AdminUser | null>(null);
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  useBackLayer(!!who, () => setWho(null));
  const load = () => {
    adminOverview().then(setOv).catch((e) => setNote(e.message));
    adminUsers().then(setUsers).catch(() => undefined);
    adminConfig().then(setCfg).catch(() => undefined);
  };
  useEffect(load, []);
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setNote(ok); load(); } catch (e) { setNote((e as Error).message); } };
  const stat = (label: string, v: number | string | undefined, hint?: string) => (
    <div className="adm-stat"><span className="adm-num">{v ?? '—'}</span><span className="muted tiny">{label}</span>{hint && <span className="muted tiny">{hint}</span>}</div>
  );
  return (
    <div className="screen">
      <header className="top"><div className="title-row">
        <button className="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
        <div className="title-block"><h1 className="section-title">Admin</h1></div>
      </div>
        <div className="seg" role="tablist">
          {(['overview', 'people', 'settings'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'overview' ? 'Overview' : t === 'people' ? 'People' + (users ? ' · ' + users.length : '') : 'Settings'}</button>)}
        </div>
      </header>
      <main className="content stack">
        {note && <div className="toast-inline" onClick={() => setNote('')}>{note}</div>}

        {tab === 'overview' && <>
          <section className="panel"><div className="panel-head"><span>People</span></div>
            <div className="adm-grid">{stat('total', ov?.users)}{stat('new this week', ov?.new_7d)}{stat('active 7 days', ov?.active_7d)}{stat('active 30 days', ov?.active_30d)}</div></section>
          <section className="panel"><div className="panel-head"><span>This week</span></div>
            <div className="adm-grid">{stat('titles added', ov?.added_7d)}{stat('finished', ov?.finished_7d)}{stat('feed updates', ov?.events_7d)}{stat('reactions', ov?.reactions_7d)}</div></section>
          <section className="panel"><div className="panel-head"><span>AI</span></div>
            <div className="adm-grid">{stat('today', ov?.ai_today)}{stat('this month', ov?.ai_month)}</div>
            {ov && Object.keys(ov.ai_by_kind).length > 0 && <span className="muted small">This month: {Object.entries(ov.ai_by_kind).map(([k, n]) => k + ' ' + n).join(' · ')}</span>}</section>
          <section className="panel"><div className="panel-head"><span>Server calls · 24 h</span>{(ov?.failed_24h ?? 0) > 0 && <span className="count-badge danger">{ov!.failed_24h} failed</span>}</div>
            <span className="muted small">{ov ? `${ov.calls_24h} calls, ${ov.failed_24h} failed` : '—'}</span>
            {ov?.errors.map((e, i) => <div key={i} className="adm-err"><span className="muted tiny">{ago(e.at)} · {e.status ?? 'no answer'}</span><code>{e.text}</code></div>)}
            {ov && ov.failed_24h === 0 && <span className="small">✓ Nothing failed</span>}</section>
        </>}

        {tab === 'people' && <section className="panel">
          {!users ? <span className="muted small">Loading…</span> : users.map((u) => (
            <button key={u.id} className="friend-open" onClick={() => setWho(u)}>
              <Avatar url={u.avatar_url} email={u.email} size={36} />
              <span className="grow stack-0"><strong className="small">{u.name || (u.handle ? '@' + u.handle : u.email)}</strong>
                <span className="muted tiny">{u.email} · seen {ago(u.last_seen)} · {u.items} titles · {u.friends} friends</span></span>
            </button>
          ))}
        </section>}

        {tab === 'settings' && <>
          <section className="panel"><div className="panel-head"><span>Server settings</span></div>
            {cfg?.map((c) => (
              <div key={c.key} className="adm-cfg">
                <span className="muted tiny">{LABEL[c.key] ?? c.key}</span>
                {c.editable ? <div className="row nowrap"><input className="text-input grow" value={edit[c.key] ?? c.value} onChange={(e) => setEdit({ ...edit, [c.key]: e.target.value })} />
                  {edit[c.key] !== undefined && edit[c.key] !== c.value && <button className="btn sm primary" onClick={run(() => adminSetConfig(c.key, edit[c.key]), 'Saved.')}>Save</button>}</div>
                  : <span className="small">{c.value} <span className="muted tiny">· read-only</span></span>}
              </div>
            ))}
            {cfg && !cfg.some((c) => c.key === 'ai_daily_limit') && <button className="btn sm" onClick={run(() => adminSetConfig('ai_daily_limit', '30'), 'AI limit set to 30 a day.')}>Set an AI limit (30 a day)</button>}
          </section>
          <section className="panel"><div className="panel-head"><span>Tools</span></div>
            <button className="btn" onClick={run(() => adminTool('test_push'), 'Sent — a test notification should arrive on your devices with notifications on.')}>Send me a test notification</button>
            <button className="btn" onClick={run(() => adminTool('releases'), 'Started — “Out today” notifications go out if anything comes out today.')}>Run “Out today” now</button>
          </section>
        </>}
      </main>

      {who && <div className="sheet-wrap">
        <button className="sheet-scrim" aria-label="Close" onClick={() => setWho(null)} />
        <div className="sheet" role="dialog" aria-label={who.email}>
          <div className="row nowrap"><Avatar url={who.avatar_url} email={who.email} size={48} /><span className="stack-0"><strong>{who.name || who.email}</strong><span className="muted small">{who.handle ? '@' + who.handle + ' · ' : ''}{who.email}</span></span></div>
          <span className="muted small">Joined {new Date(who.joined).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · seen {ago(who.last_seen)}</span>
          <span className="small">{who.items} titles · {who.friends} friends{who.companies.length ? ' · ' + who.companies.join(', ') : ''} · Telegram {who.telegram_off ? 'off' : 'on'}</span>
          <button className="btn" onClick={run(() => adminUserAction(who.id, 'reset_intro'), 'They’ll see the welcome, What’s new and tips again.')}>Show welcome & tips again</button>
          {!who.telegram_off && <button className="btn" onClick={run(() => adminUserAction(who.id, 'telegram_off'), 'Their Telegram posts are off.')}>Turn off their Telegram posts</button>}
          <button className="btn danger" onClick={run(async () => {
            if (!confirm('Delete ' + (who.name || who.email) + ' and everything they have? This can’t be undone.')) return;
            if (!confirm('Really delete? Their lists, ratings, friends and feed go too.')) return;
            await adminUserAction(who.id, 'delete'); setWho(null);
          }, 'Deleted.')}>Delete account</button>
          <button className="btn" onClick={() => setWho(null)}>Close</button>
        </div>
      </div>}
    </div>
  );
}
