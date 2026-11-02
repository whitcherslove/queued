import type { ItemLog, LibItem, Title } from './types';
import { localDay } from './logic';

export type MovieState = 'upNext' | 'outNow' | 'comingSoon' | 'backlog' | 'watched' | 'didntFinish' | 'dropped';

const today = () => localDay(new Date().toISOString());

/**
 * Where a movie lives — one state, same words as the Backlog sections:
 *  upNext      — pinned to the top of Backlog
 *  outNow      — in Backlog, released this year
 *  comingSoon  — in Backlog, not released yet
 *  backlog     — in Backlog (Deep backlog)
 *  watched / didntFinish — in Watched (the latest viewing was finished / dropped)
 *  dropped     — hidden from every list (search still finds it)
 */
export function movieState(item: Pick<LibItem, 'status' | 'up_next'>, t: Pick<Title, 'release_date' | 'year'>, last: Pick<ItemLog, 'dropped'> | null, now = today()): MovieState {
  if (item.status === 'dropped') return 'dropped';
  if (item.status !== 'backlog') return last?.dropped ? 'didntFinish' : 'watched';
  if (item.up_next) return 'upNext';
  const rel = t.release_date ?? null;
  if (rel && rel > now) return 'comingSoon';
  if (rel && rel.slice(0, 4) === now.slice(0, 4)) return 'outNow';
  return 'backlog';
}

export const MOVIE_STATE_LABEL: Record<MovieState, string> = {
  upNext: 'Up next', outNow: 'Out now', comingSoon: 'Coming soon', backlog: 'Backlog', watched: 'Watched', didntFinish: 'Didn’t finish', dropped: 'Not interested'
};
