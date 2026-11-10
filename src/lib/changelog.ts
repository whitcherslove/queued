/** What's new — one entry per version, newest first. Shown once after an update (only the entries you haven't seen). */
export const APP_VERSION = '4.9';
export interface ChangeItem { icon: string; title: string; text: string }
export interface ChangeEntry { version: string; title: string; items: ChangeItem[] }

export const CHANGELOG: ChangeEntry[] = [
  {
    version: '4.9',
    title: 'Ratings in the Telegram group',
    items: [
      { icon: '✈️', title: 'Telegram posts', text: 'When you start something, drop it, or finish and rate it, a post with the cover and your avatar goes to the group chat. Change the rating later — the post updates. It’s off by default: turn it on in Profile and settings → Post my ratings to Telegram.' }
    ]
  },
  {
    version: '4.8',
    title: 'Half points on the 10-point scale',
    items: [
      { icon: '🔢', title: 'Scores like 6.5', text: 'On the 10-point scale, − and + now move by 0.5. Imported scores keep their halves too.' }
    ]
  },
  {
    version: '4.7',
    title: 'Coming up and rewatches',
    items: [
      { icon: '📅', title: 'Coming up shows more', text: 'Season premieres of shows in your Backlog and of shows you’ve watched, new shows, and the next episode of what you’re watching — six months ahead.' },
      { icon: '🔁', title: 'Finished works in a rewatch', text: 'Rewatching a show? “Finished” (in the unfolded status block) marks everything you haven’t rewatched yet.' }
    ]
  },
  {
    version: '4.6',
    title: 'Now & Next, a new look, friends',
    items: [
      { icon: '▶️', title: 'Now & Next', text: 'The middle tab of every section is Now & Next (Up next for movies): what you’re in and your Up next queue. New seasons, Out now and Coming soon live in Backlog.' },
      { icon: '✨', title: 'A new look', text: 'New icon and splash screen. The active tab in the bottom bar lights up in its section’s colour.' },
      { icon: '👋', title: 'Friends', text: 'Friends in the menu: invite with a link or QR, see what friends start, finish and rate in Activity, and a summary page for each — your lists stay yours.' },
      { icon: '🔔', title: 'Notifications', text: 'Friend requests, your friends’ activity, and what comes out today from your lists. Turn them on in Profile and settings.' },
      { icon: '📺', title: 'Shows', text: 'Unfold the status block of a show: “Finished” marks every aired episode. Long-press a show you’ve watched → “Stop following” to hide it from new seasons.' },
      { icon: '📖', title: 'Books', text: 'A Books section in the menu: paper, e-book or audio, progress by page, series, covers from editions.' },
      { icon: '🏠', title: 'Home', text: 'What you’re watching, playing and reading, “What tonight?” with Random or AI, what’s ready to start and what’s coming.' }
    ]
  }
];

/** "4.10" > "4.6" */
export const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); }
  return false;
};
export const unseen = (seen?: string) => CHANGELOG.filter((e) => !seen || newer(e.version, seen));
