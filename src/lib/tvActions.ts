import type { ItemLog, LibItem, Mark, SeasonEps, Title } from './types';
import { deleteLog, insertLog, setMarks, updateItem } from './remote';
import { coveredSeasons, logScope, planOf, progress, seasonsOf, todayIso } from './tv';

/**
 * Mark or unmark episodes, then move the show between Backlog / Watching / Watched
 * and write (or withdraw) the journal entry. Returns the new marks and whether the plan was just finished.
 */
export async function applyEpisodeMarks(item: LibItem, t: Title, eps: SeasonEps[], marks: Mark[], logs: ItemLog[], list: { season: number; episode: number }[], on: boolean): Promise<{ marks: Mark[]; finished: boolean }> {
  const now = new Date().toISOString();
  const keep = marks.filter((m) => !(m.library_id === item.id && list.some((x) => x.season === m.season && x.episode === m.episode)));
  const next = on ? keep.concat(list.map((x) => ({ library_id: item.id, season: x.season, episode: x.episode, watched_at: now }))) : keep;
  await setMarks(item.id, list, on);

  // Ticking an episode of a season you haven't logged yet (a new season, the rest of an ended show) starts watching it
  if (on && item.status === 'done') {
    const covered = coveredSeasons(t, logs);
    const fresh = [...new Set(list.map((x) => x.season))].filter((n) => !covered.has(n));
    if (fresh.length) {
      const rest = seasonsOf(t).map((x) => x.n).filter((n) => !covered.has(n) && n >= Math.min(...fresh));
      await updateItem(item.id, { status: 'playing', plan_seasons: rest, plan_from: rest[0], plan_to: rest[rest.length - 1], run_started_at: new Date(Date.now() - 1000).toISOString(), started_on: todayIso(), up_next: false });
      return { marks: next, finished: false };
    }
  }
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

// ---------- state changes, named after where the show ends up ----------
const planPatch = (seasons: number[] | null) => ({ plan_seasons: seasons && seasons.length ? seasons : null, plan_from: seasons && seasons.length ? seasons[0] : null, plan_to: seasons && seasons.length ? seasons[seasons.length - 1] : null });

/** → Watching: start these seasons now. */
export function startWatching(item: LibItem, seasons: number[] | null) {
  return updateItem(item.id, { status: 'playing', ...planPatch(seasons), run_started_at: new Date().toISOString(), started_on: todayIso(), up_next: false });
}
/** → Backlog: watch these seasons later. */
export function moveToBacklog(item: LibItem, seasons: number[] | null, position: number) {
  return updateItem(item.id, { status: 'backlog', ...planPatch(seasons), run_started_at: new Date().toISOString(), position, up_next: false });
}
/** → Dropped: gone from every list (search still finds it); journal entries stay. */
export function dropShow(item: LibItem) {
  return updateItem(item.id, { status: 'dropped', up_next: false });
}
/** Dropped → back: to Watched-based states if you've logged it, otherwise to Backlog. */
export function bringBack(item: LibItem, hasLogs: boolean, position: number) {
  return hasLogs ? updateItem(item.id, { status: 'done', ...planPatch(null) }) : updateItem(item.id, { status: 'backlog', position });
}
