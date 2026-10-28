import type { ItemLog, LibItem, Mark, SeasonEps, Title } from './types';
import { deleteLog, insertLog, setMarks, updateItem } from './remote';
import { logScope, planOf, progress, todayIso } from './tv';

/**
 * Mark or unmark episodes, then move the show between Backlog / Watching / Watched
 * and write (or withdraw) the journal entry. Returns the new marks and whether the plan was just finished.
 */
export async function applyEpisodeMarks(item: LibItem, t: Title, eps: SeasonEps[], marks: Mark[], logs: ItemLog[], list: { season: number; episode: number }[], on: boolean): Promise<{ marks: Mark[]; finished: boolean }> {
  const now = new Date().toISOString();
  const keep = marks.filter((m) => !(m.library_id === item.id && list.some((x) => x.season === m.season && x.episode === m.episode)));
  const next = on ? keep.concat(list.map((x) => ({ library_id: item.id, season: x.season, episode: x.episode, watched_at: now }))) : keep;
  await setMarks(item.id, list, on);

  const mine = next.filter((m) => m.library_id === item.id);
  const p = progress(item, t, eps, mine);
  const isDone = item.status === 'done' || item.status === 'dropped';
  const since = item.run_started_at ?? '';  // the entry written in this run, if any
  const runLog = logs.find((l) => since && l.watched_at >= since) ?? null;
  if (p.complete && !isDone) {
    await insertLog(item.id, { ...logScope(planOf(item)), watched_at: p.lastSeen ?? now, tier: null, score: item.score, rewatch: !!item.rewatch } as Partial<ItemLog>);
    await updateItem(item.id, { status: 'done', up_next: false, rewatch: false, score: null });
    return { marks: next, finished: true };
  }
  if (!p.complete && isDone && runLog && !runLog.tier) {
    await deleteLog(runLog.id);
    await updateItem(item.id, { status: p.anySeen ? 'playing' : 'backlog' });
  } else if (item.status === 'backlog' && p.anySeen) await updateItem(item.id, { status: 'playing', up_next: false, started_on: todayIso() });
  else if (item.status === 'playing' && !p.anySeen) await updateItem(item.id, { status: 'backlog' });
  return { marks: next, finished: false };
}
