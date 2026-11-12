/** What's new — one entry per version, newest first. Shown once after an update (only the entries you haven't seen). */
export const APP_VERSION = '4.14';
export interface ChangeItem { icon: string; title: string; text: string }
export interface ChangeEntry { version: string; title: string; items: ChangeItem[] }

export const CHANGELOG: ChangeEntry[] = [
  {
    version: '4.14',
    title: 'Specials, seasons, reactions',
    items: [
      { icon: '★', title: 'Specials', text: 'A folded Specials row under a show’s seasons. Add the specials that matter — they move into the season they aired after and count toward your progress. The rest count for nothing.' },
      { icon: '📺', title: 'Seasons in Activity', text: 'Finishing a season posts “finished · Season 2”; rate it later and the rating joins the same entry.' },
      { icon: '🔥', title: 'Reactions', text: 'React 🔥 😂 👀 😢 to your friends’ updates — they get a notification.' }
    ]
  },
  {
    version: '4.13',
    title: 'A tidier Activity',
    items: [
      { icon: '🗓️', title: 'Days and bursts', text: 'Activity is split by day, and several updates from one person in a row fold into one card.' },
      { icon: '🆕', title: 'Only what’s new', text: '“Finished” shows up in Activity only on the day it happened — past viewings and old entries stay out.' },
      { icon: '🎮', title: 'Played together', text: 'Mark a co-op friend and they get “played together — Add?” in Friends → People. Co-op partners are named only to people who share a company with them.' }
    ]
  },
  {
    version: '4.12',
    title: 'Tonight’s pick',
    items: [
      { icon: '✦', title: 'Tonight’s pick', text: 'The AI now weighs movies, shows, games and books equally — and the block on Home has a new name.' },
      { icon: '📺', title: 'Which season', text: 'When you start a show, the feed, notifications and Telegram say which season you’re starting.' }
    ]
  },
  {
    version: '4.11',
    title: 'Telegram companies',
    items: [
      { icon: '✈️', title: 'Your companies', text: 'Friends → Telegram: each Telegram chat is a company. Your posts go to the companies you’re in; anyone in a company can add their friends to it. Connect a new chat with one link.' },
      { icon: '⏳', title: 'No “Start watching” before the premiere', text: 'Shows that haven’t aired a single episode yet don’t offer to start them.' }
    ]
  },
  {
    version: '4.10',
    title: 'Up next for any show',
    items: [
      { icon: '📌', title: 'Pin any show', text: 'Shows with a new season, last-chance shows and shows you’re up to date with can go to Up next too.' },
      { icon: '✓', title: 'Finished, only while watching', text: 'The “Finished” button in a show’s card shows up only for shows you’re watching.' },
      { icon: '👋', title: 'Clearer invites', text: 'Opening a friend’s invite link now tells you right away whether it worked.' }
    ]
  },
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
      { icon: '🏠', title: 'Home', text: 'What you’re watching, playing and reading, “Tonight’s pick” with Random or AI, what’s ready to start and what’s coming.' }
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
