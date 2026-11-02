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
  // Only a sideways drag changes the score: a tap or a vertical scroll that happens to start on the slider is ignored
  const ptr = useRef<{ x: number; y: number; armed: boolean } | null>(null);
  useEffect(() => { if (!dragging) setRaw(toDisplay(value)); }, [value, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = (d: number) => Math.round(d * 2) / 2;                 // half points on the visible scale
  const stored = (d: number) => (scale === 10 ? snap(d) / 2 : snap(d)); // stored 0–5
  const shown = touched.current || value !== null ? stored(raw) : null;
  const commit = () => { ptr.current = null; if (!touched.current) { setDragging(false); return; } setDragging(false); setRaw(snap(raw)); onCommit(stored(raw)); touched.current = false; };
  const cancel = () => { ptr.current = null; setDragging(false); if (touched.current) { touched.current = false; setRaw(toDisplay(value)); onPreview?.(value); } };
  const ticks = scale === 10 ? [0, 2, 4, 6, 8, 10] : [0, 1, 2, 3, 4, 5];

  return (
    <div className={'score-slider' + (compact ? ' compact' : '')}>
      <input id={id} type="range" min={0} max={scale} step={0.01} value={raw}
        aria-label={label} aria-valuetext={shown === null ? 'No score' : `${displayScore(shown, scale)} out of ${scale}`}
        className={'range' + (value === null && !touched.current ? ' faint' : '')}
        style={{ accentColor: myScoreColor(shown) ?? 'var(--muted)' }}
        onPointerDown={(e) => { ptr.current = { x: e.clientX, y: e.clientY, armed: false }; setDragging(true); }}
        onPointerMove={(e) => { const p = ptr.current; if (p && !p.armed) { const dx = Math.abs(e.clientX - p.x), dy = Math.abs(e.clientY - p.y); if (dx > 6 && dx > dy) p.armed = true; else if (dy > 8) cancel(); } }}
        onPointerCancel={cancel}
        onChange={(e) => { if (ptr.current && !ptr.current.armed) return; touched.current = true; const d = Number(e.target.value); setRaw(d); onPreview?.(stored(d)); }}
        onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit} />
      <div className="ticks" aria-hidden="true">{ticks.map((n) => <span key={n}>{n}</span>)}</div>
    </div>
  );
}
