import { useState } from 'react';
import type { Title } from '../lib/types';
import { FORMATS, type BookFormat } from '../lib/formats';
import { Poster } from './Rows';
import FormatIcon from './FormatIcon';

export type BookAddMode = 'backlog' | 'playing' | 'past';

/** Adding a book: the format you read in (paper / e-book / audio) and where it goes. */
export default function BookAddSheet({ t, shown, today, onCancel, onDone }: {
  t: Title; shown: string; today: string; onCancel: () => void; onDone: (r: { format: BookFormat; mode: BookAddMode }) => void;
}) {
  const [format, setFormat] = useState<BookFormat>('paper');
  const unreleased = !!t.release_date && t.release_date > today;
  const author = t.directors?.slice(0, 2).join(', ');
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label={'Add ' + shown}>
        <div className="action-head"><Poster t={t} w={40} h={58} /><span className="stack-sm"><strong>{shown}</strong><span className="muted small">{[author, t.year].filter(Boolean).join(' · ')}</span></span></div>
        <span className="list-group-title">Format</span>
        <div className="fmt-grid" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.key} role="radio" aria-checked={format === f.key} className={'chip fmt-chip' + (format === f.key ? ' on' : '')} onClick={() => setFormat(f.key)}><FormatIcon f={f.key} />{f.label}</button>
          ))}
        </div>
        <div className="choice-buttons">
          <button className="choice primary" onClick={() => onDone({ format, mode: 'backlog' })}><strong>Add to Backlog</strong><span>Goes to the top of your Backlog</span></button>
          {!unreleased && <button className="choice" onClick={() => onDone({ format, mode: 'playing' })}><strong>Reading now</strong><span>Straight to Reading</span></button>}
          {!unreleased && <button className="choice" onClick={() => onDone({ format, mode: 'past' })}><strong>I’ve read it</strong><span>Add a past reading: date and rating</span></button>}
          <button className="choice ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
