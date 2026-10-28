import { useEffect, useRef, useState } from 'react';
import { displayScore, myScoreColor } from '../lib/scores';

interface Props {
  id: string; value: number | null; scale: 5 | 10; label: string;
  onCommit: (v: number | null) => void;
  onPreview?: (v: number | null) => void;
  compact?: boolean;
}

/**
 * Smooth score slider: the thumb glides freely while you drag, the value snaps to the nearest half point
 * and is saved once you let go (no saving on every pixel, so nothing jumps).
 */
export default function ScoreSlider({ id, value, scale, label, onCommit, onPreview, compact }: Props) {
  const toDisplay = (v: number | null) => (v === null ? 0 : displayScore(v, scale));
  const [raw, setRaw] = useState<number>(toDisplay(value));
  const [dragging, setDragging] = useState(false);
  const touched = useRef(false);
  useEffect(() => { if (!dragging) setRaw(toDisplay(value)); }, [value, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = (d: number) => Math.round(d * 2) / 2;                 // half points on the visible scale
  const stored = (d: number) => (scale === 10 ? snap(d) / 2 : snap(d)); // stored 0–5
  const shown = touched.current || value !== null ? stored(raw) : null;
  const commit = () => { if (!touched.current) return; setDragging(false); setRaw(snap(raw)); onCommit(stored(raw)); touched.current = false; };
  const ticks = scale === 10 ? [0, 2, 4, 6, 8, 10] : [0, 1, 2, 3, 4, 5];

  return (
    <div className={'score-slider' + (compact ? ' compact' : '')}>
      <input id={id} type="range" min={0} max={scale} step={0.01} value={raw}
        aria-label={label} aria-valuetext={shown === null ? 'No score' : `${displayScore(shown, scale)} out of ${scale}`}
        className={'range' + (value === null && !touched.current ? ' faint' : '')}
        style={{ accentColor: myScoreColor(shown) ?? 'var(--muted)' }}
        onPointerDown={() => setDragging(true)}
        onChange={(e) => { touched.current = true; const d = Number(e.target.value); setRaw(d); onPreview?.(stored(d)); }}
        onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit} />
      <div className="ticks" aria-hidden="true">{ticks.map((n) => <span key={n}>{n}</span>)}</div>
    </div>
  );
}
