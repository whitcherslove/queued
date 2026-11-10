/** One-time tips: each shows once per account (kept in your profile settings), "Show tips again" in Settings resets them. */
type Saver = (seen: string[]) => void;
let seen: string[] = [];
let save: Saver | null = null;
const listeners = new Set<() => void>();
export function initTips(list: string[] | undefined, saver: Saver) { seen = list ?? []; save = saver; listeners.forEach((f) => f()); }
export const tipSeen = (key: string) => seen.includes(key);
export function markTip(key: string) { if (seen.includes(key)) return; seen = [...seen, key]; save?.(seen); listeners.forEach((f) => f()); }
export function onTips(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

export const TIPS: Record<string, string> = {
  home: 'Home shows what you’re watching, playing and reading, “Tonight’s pick” when you can’t decide, what’s ready to start, and what’s coming up.',
  list: 'Swipe left or right to switch tabs. Tap a title to open it; long-press for quick actions.',
  card: 'Tap the arrow on the coloured status block for more: My take (your rating and score), dates, and actions like Before, Backlog and Drop.',
  friends: 'Invite friends from People with your link or QR. In Activity, tap a name to see that friend’s page.'
};
/** The list tip names this section's own tabs. */
export const listTip = (kind: 'movie' | 'tv' | 'game' | 'book') => {
  const done = kind === 'game' ? 'Finished' : kind === 'book' ? 'Read' : 'Watched';
  const mid = kind === 'movie' ? 'Up next' : 'Now & Next';
  return `Tabs: ${done} · ${mid} · Backlog — swipe to switch. Tap a title to open it, long-press for quick actions. Pin titles to Up next from their card.`;
};
