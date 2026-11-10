import { useRef, useState } from 'react';
import Logo from './Logo';

const CARDS = [
  { icon: null, title: 'Welcome to Queued', text: 'Movies, shows, games and books — what you’re watching, playing and reading, what’s next, and what you thought of it.' },
  { icon: '🏠', title: 'Home', text: 'Everything you’re in right now, what’s ready to start, what’s coming out — and “What tonight?” when you can’t decide.' },
  { icon: '🗂️', title: 'Sections and tabs', text: 'Each section has Watched · Now & Next · Backlog. Search to add, pin things to Up next, long-press a row for quick actions.' },
  { icon: '⭐', title: 'The card', text: 'Open anything to start, finish or rate it. The arrow opens more; “My take” is your rating and score.' },
  { icon: '👋', title: 'Friends and notifications', text: 'Invite friends to see what they finish and rate. Turn on notifications to hear about new episodes and releases.' }
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
