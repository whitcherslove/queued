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
  home: 'This is Home: what you’re in right now, what’s ready to start and what’s coming. Not sure what to watch? Try “What tonight?”.',
  list: 'Tabs: Watched · Now & Next · Backlog. Swipe to switch. Long-press a row for quick actions; pin things to Up next.',
  card: 'The arrow on the card opens more: rating, dates, and actions like Backlog or Drop. “My take” is your rating.',
  friends: 'Share your invite link — when a friend opens it, you’re friends. Tap a name in Activity to see their page.'
};
