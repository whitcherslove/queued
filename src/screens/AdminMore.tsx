import { useEffect, useState } from 'react';
import Avatar from '../components/Avatar';
import PlatformIcon from '../components/PlatformIcon';
import { ALL_PLATFORMS, registerCustomPlatforms, type CustomPlatform, type GameSection } from '../lib/platforms';
import { makeWhiteLogo } from '../lib/logo';
import { allEntries, latestVersion, newer, setDbChangelog, type ChangeEntry, type ChangeItem } from '../lib/changelog';
import { adminTgConnect, deleteTgGroup, renameTgGroup, transferTgOwner } from '../lib/telegram';
import { adminTgGroups, adminTgRemove, adminTgTest, deleteChangelog, deleteCustomPlatform, loadChangelogDb, loadCustomPlatforms, saveChangelog, saveCustomPlatform, seenCount, uploadLogo, type AdminTgGroup } from '../lib/admin';

const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

/** Admin → Platforms: add a console or change a logo; everyone gets it right away. */
export function PlatformsTab({ say }: { say: (m: string) => void }) {
  const [list, setList] = useState<CustomPlatform[]>([]);
  const [form, setForm] = useState<(CustomPlatform & { isNew: boolean; file?: File; preview?: string; blob?: Blob }) | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => loadCustomPlatforms().then((l) => { setList(l); registerCustomPlatforms(l); }).catch(() => undefined);
  useEffect(() => { load(); }, []);
  const groups = [...new Set(ALL_PLATFORMS.map((p) => p.group))];
  const pickFile = async (f: File | undefined) => { if (!f || !form) return; try { const r = await makeWhiteLogo(f); setForm({ ...form, file: f, preview: r.url, blob: r.blob }); } catch (e) { say((e as Error).message); } };
  const save = async () => {
    if (!form) return; setBusy(true);
    try {
      const key = form.isNew ? slug(form.key || form.label) : form.key;
      if (!key || !form.label) throw new Error('Name it first');
      const logo_url = form.blob ? await uploadLogo(key, form.blob) : form.logo_url;
      const row: CustomPlatform = { key, label: form.label.trim(), grp: form.grp || 'Other', section: form.section, match: form.match.filter(Boolean), logo_url };
      await saveCustomPlatform(row); registerCustomPlatforms([row]); setForm(null); say('Saved — everyone gets it next time they open the app.'); load();
    } catch (e) { say((e as Error).message); }
    setBusy(false);
  };
  return (
    <>
      <section className="panel"><div className="panel-head"><span>Platforms from Admin</span></div>
        {list.length === 0 && <span className="muted small">None yet. Add a new console, or give a built-in platform a better logo.</span>}
        {list.map((p) => (
          <button key={p.key} className="friend-open" onClick={() => setForm({ ...p, isNew: false })}>
            <span className="adm-logo">{p.logo_url ? <img src={p.logo_url} alt="" /> : <span className="muted tiny">no logo</span>}</span>
            <span className="grow stack-0"><strong className="small">{p.label}</strong><span className="muted tiny">{p.key} · {p.section} · {p.grp}{p.match.length ? ' · IGDB: ' + p.match.join(', ') : ''}</span></span>
          </button>
        ))}
        <div className="row nowrap">
          <button className="btn primary grow" onClick={() => setForm({ key: '', label: '', grp: 'Other', section: 'console', match: [], logo_url: null, isNew: true })}>Add a platform</button>
          <select className="text-input grow" value="" onChange={(e) => { const p = ALL_PLATFORMS.find((x) => x.key === e.target.value); if (p) setForm({ key: p.key, label: p.label, grp: p.group, section: p.section, match: [], logo_url: null, isNew: false }); }}>
            <option value="">Change a built-in…</option>
            {ALL_PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      </section>
      {form && <div className="sheet-wrap">
        <button className="sheet-scrim" aria-label="Close" onClick={() => setForm(null)} />
        <div className="sheet" role="dialog" aria-label="Platform">
          <strong>{form.isNew ? 'New platform' : form.label}</strong>
          <input className="text-input" placeholder="Name, e.g. PlayStation 6" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          {form.isNew && <span className="muted tiny">Key: {slug(form.key || form.label) || '—'}</span>}
          <div className="row nowrap">
            <select className="text-input grow" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value as GameSection })}>
              <option value="console">Console</option><option value="pc">PC</option><option value="retro">Retro</option>
            </select>
            <input className="text-input grow" list="plat-groups" placeholder="Group, e.g. PlayStation" value={form.grp} onChange={(e) => setForm({ ...form, grp: e.target.value })} />
            <datalist id="plat-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </div>
          <input className="text-input" placeholder="IGDB names (comma-separated), e.g. PlayStation 6" value={form.match.join(', ')} onChange={(e) => setForm({ ...form, match: e.target.value.split(',').map((x) => x.trim().toLowerCase()) })} />
          <span className="muted tiny">How IGDB calls the platform — games on it then get this platform automatically.</span>
          <label className="btn">Choose a logo picture<input type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} /></label>
          {(form.preview || form.logo_url) && <div className="adm-previews">
            <span className="adm-prev dark"><img src={form.preview ?? form.logo_url!} alt="" /></span>
            <span className="adm-prev light"><img src={form.preview ?? form.logo_url!} alt="" /></span>
          </div>}
          {!form.isNew && !form.preview && <span className="muted tiny">Now: <PlatformIcon k={form.key} size={14} /></span>}
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          {!form.isNew && list.some((p) => p.key === form.key) && <button className="btn danger" onClick={async () => { if (!confirm('Remove this from Admin? Built-in platforms go back to their usual logo.')) return; await deleteCustomPlatform(form.key).catch(() => undefined); setForm(null); say('Removed. Restart the app to see the built-in again.'); load(); }}>Remove</button>}
          <button className="btn" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </div>}
    </>
  );
}

/** Admin → What's new: write entries without a new app version. */
export function NewsTab({ say }: { say: (m: string) => void }) {
  const [entries, setEntries] = useState<ChangeEntry[]>(allEntries());
  const [dbVersions, setDbVersions] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<number | null>(null);
  const [form, setForm] = useState<ChangeEntry | null>(null);
  const load = () => loadChangelogDb().then((l) => { setDbChangelog(l); setDbVersions(new Set(l.map((e) => e.version))); setEntries(allEntries()); seenCount(latestVersion()).then(setSeen).catch(() => undefined); }).catch(() => undefined);
  useEffect(() => { load(); }, []);
  const nextVersion = () => { const v = latestVersion().split('.').map(Number); v[v.length - 1] += 1; return v.join('.'); };
  const setItem = (i: number, patch: Partial<ChangeItem>) => form && setForm({ ...form, items: form.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return (
    <>
      <section className="panel"><div className="panel-head"><span>What’s new</span></div>
        <span className="muted small">Latest: {latestVersion()}{seen !== null ? ` · seen by ${seen}` : ''}</span>
        <button className="btn primary" onClick={() => setForm({ version: nextVersion(), title: '', items: [{ icon: '✨', title: '', text: '' }] })}>Write a new entry</button>
        {entries.slice(0, 8).map((e) => (
          <div key={e.version} className="adm-news">
            <span className="grow stack-0"><strong className="small">{e.version} · {e.title}</strong><span className="muted tiny">{e.items.map((i) => i.icon + ' ' + i.title).join(' · ')}</span></span>
            {dbVersions.has(e.version) ? <button className="link" onClick={() => setForm(e)}>Edit</button> : <span className="muted tiny">built in</span>}
          </div>
        ))}
      </section>
      {form && <div className="sheet-wrap">
        <button className="sheet-scrim" aria-label="Close" onClick={() => setForm(null)} />
        <div className="sheet" role="dialog" aria-label="What's new entry">
          <div className="row nowrap"><input className="text-input" style={{ width: 90 }} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value.trim() })} />
            <input className="text-input grow" placeholder="Title, e.g. Specials and reactions" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          {form.items.map((it, i) => (
            <div key={i} className="adm-item">
              <div className="row nowrap"><input className="text-input" style={{ width: 56, textAlign: 'center' }} value={it.icon} onChange={(e) => setItem(i, { icon: e.target.value })} />
                <input className="text-input grow" placeholder="Headline" value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} />
                <button className="link danger" aria-label="Remove" onClick={() => setForm({ ...form, items: form.items.filter((_, k) => k !== i) })}>✕</button></div>
              <textarea className="text-input" rows={2} placeholder="One or two sentences" value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} />
            </div>
          ))}
          <button className="btn" onClick={() => setForm({ ...form, items: [...form.items, { icon: '✨', title: '', text: '' }] })}>Add a point</button>
          <button className="btn primary" onClick={async () => {
            try {
              if (!/^\d+(\.\d+)*$/.test(form.version)) throw new Error('Version like 4.17');
              if (!form.title || !form.items.some((i) => i.title)) throw new Error('Add a title and at least one point');
              const isNewest = !newer(latestVersion(), form.version);
              await saveChangelog({ ...form, items: form.items.filter((i) => i.title) }); setForm(null);
              say(isNewest ? 'Saved — everyone sees it the next time they open the app.' : 'Saved (an older version — people who saw newer ones won’t get it).'); load();
            } catch (e) { say((e as Error).message); }
          }}>Save</button>
          {dbVersions.has(form.version) && <button className="btn danger" onClick={async () => { if (!confirm('Delete this entry?')) return; await deleteChangelog(form.version).catch(() => undefined); setForm(null); load(); }}>Delete</button>}
          <button className="btn" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </div>}
    </>
  );
}

/** Admin → Telegram: every company, who's in it, the bot's status; remove people, send a test. */
export function TelegramTab({ say }: { say: (m: string) => void }) {
  const [groups, setGroups] = useState<AdminTgGroup[] | null>(null);
  const load = () => adminTgGroups().then(setGroups).catch((e) => say(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (fn: () => Promise<void>) => async () => { try { await fn(); load(); } catch (e) { say((e as Error).message); } };
  return (
    <section className="panel"><div className="panel-head"><span>Telegram companies</span></div>
      {!groups ? <span className="muted small">Loading…</span> : groups.length === 0 ? <span className="muted small">No companies yet.</span> : groups.map((g) => (
        <div key={g.id} className="tg-group">
          <div className="row nowrap"><strong className="grow">{g.title}</strong>{!g.chat_id ? <span className="muted tiny">no chat</span> : g.active ? <span className="muted tiny">{g.posts_7d} posts this week</span> : <span className="tier-under none">bot removed</span>}</div>
          <div className="row nowrap tg-owner">
            <button className="link" onClick={act(async () => { const t = prompt('New name', g.title); if (t && t.trim() && t !== g.title) await renameTgGroup(g.id, t); })}>Rename</button>
            <button className="link" onClick={act(async () => { const c = prompt('Telegram chat ID (like -100…)', g.chat_id ? String(g.chat_id) : ''); if (c && /^-?\d+$/.test(c.trim())) await adminTgConnect(g.id, Number(c.trim())); })}>{g.chat_id ? 'Change chat' : 'Connect chat by ID'}</button>
            <span className="grow" />
            <button className="link danger" onClick={act(async () => { if (confirm('Delete ' + g.title + ' for everyone? The bot leaves the chat.')) await deleteTgGroup(g.id); })}>Delete</button>
          </div>
          <div className="tg-members">{g.members.map((m) => (
            <span key={m.id} className="tg-member"><Avatar url={m.avatar_url} email={m.name ?? '?'} size={22} />{m.id === g.owner && <span aria-label="owner">👑</span>}{m.name ?? 'Friend'}{!m.posting && <span className="muted tiny"> · muted</span>}
              {m.id !== g.owner && <button className="tg-friend" aria-label={'Make ' + (m.name ?? '') + ' the owner'} onClick={act(async () => { if (confirm('Make ' + (m.name ?? 'them') + ' the owner of ' + g.title + '?')) await transferTgOwner(g.id, m.id); })}>👑</button>}
              <button className="tg-remove" aria-label={'Remove ' + (m.name ?? '')} onClick={async () => { if (!confirm('Remove ' + (m.name ?? 'them') + ' from ' + g.title + '?')) return; try { await adminTgRemove(g.id, m.id); load(); } catch (e) { say((e as Error).message); } }}>×</button></span>
          ))}</div>
          <button className="btn sm" onClick={async () => { try { await adminTgTest(g.id); say('Test message sent to ' + g.title + '.'); setTimeout(load, 1500); } catch (e) { say((e as Error).message); } }}>Send a test message</button>
        </div>
      ))}
    </section>
  );
}
