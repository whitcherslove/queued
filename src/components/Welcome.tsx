import { useRef, useState } from 'react';
import Logo from './Logo';

const CARDS = [
  { icon: null, title: 'Welcome to Queued', text: 'Movies, shows, games and books — what you’re watching, playing and reading, what’s next, and what you thought of it.' },
  { icon: '🏠', title: 'Home', text: 'What you’re watching, playing and reading, what’s ready to start, what’s coming up — and “Tonight’s pick” when you can’t decide.' },
  { icon: '🗂️', title: 'Sections and tabs', text: 'Movies, TV Shows, Console and PC below; Books, Retro, Friends and more in the menu. Each has three tabs: what you finished, Now & Next (what you’re in and your Up next) and Backlog. Search at the top to add.' },
  { icon: '⭐', title: 'The card', text: 'Open a title to start it, mark it watched or finished, and pin it to Up next. The arrow on the status block opens My take — your rating and score — and more actions.' },
  { icon: '👋', title: 'Friends and notifications', text: 'Invite friends from Friends in the menu to see what they start, finish and rate. Turn on notifications in Profile and settings to hear about new episodes and releases.' }
];

/** First-time welcome: a few swipeable cards, "Skip" in the corner. */
export default function Welcome({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const x0 = useRef<number | null>(null);
  const last = i === CARDS.length - 1;
  const c = CARDS[i];
  return (
    <div className="welcome" role="dialog" aria-label="Welcome"
      onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (x0.current === null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null;
        if (dx < -50 && !last) setI(i + 1); if (dx > 50 && i > 0) setI(i - 1); }}>
      <button className="welcome-skip link" onClick={onDone}>Skip</button>
      <div className="welcome-card" key={i}>
        {c.icon ? <span className="welcome-icon" aria-hidden="true">{c.icon}</span> : <Logo size={96} breathing />}
        <h2 className="welcome-title">{c.title}</h2>
        <p className="welcome-text">{c.text}</p>
      </div>
      <div className="welcome-dots" aria-hidden="true">{CARDS.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
      <button className="btn primary welcome-next" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? 'Let’s go' : 'Next'}</button>
    </div>
  );
}
