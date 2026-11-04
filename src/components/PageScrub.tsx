import { useRef } from 'react';

/**
 * Progress bar for books that moves page by page.
 * - Drag sideways: about one page per 8 px of finger movement, from wherever it was (so you can land on an exact page).
 * - Tap on the bar: jumps to that spot (for big moves).
 * - Vertical movement scrolls the page and changes nothing.
 * Looks like the other progress bars (thick track, round thumb).
 */
export default function PageScrub({ value, max, label, onInput, onCommit }: {
  value: number; max: number; label: string; onInput: (v: number) => void; onCommit: (v: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const st = useRef<{ x: number; y: number; start: number; armed: boolean; moved: boolean; last: number } | null>(null);
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const clamp = (v: number) => Math.max(0, Math.min(max, Math.round(v)));
  return (
    <div ref={track} className="scrub" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}
      style={{ touchAction: 'pan-y' }}
      onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onCommit(clamp(value + 1)); } if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onCommit(clamp(value - 1)); } }}
      onPointerDown={(e) => { st.current = { x: e.clientX, y: e.clientY, start: value, armed: false, moved: false, last: value }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => {
        const s = st.current; if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (!s.armed) { if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) s.armed = true; else if (Math.abs(dy) > 8) { st.current = null; return; } else return; }
        s.moved = true;
        const v = clamp(s.start + dx / 8);
        if (v !== s.last) { s.last = v; onInput(v); }
      }}
      onPointerUp={(e) => {
        const s = st.current; st.current = null; if (!s) return;
        if (s.moved) { if (s.last !== s.start) onCommit(s.last); return; }
        // a tap: jump to that spot
        const r = track.current?.getBoundingClientRect(); if (!r) return;
        onCommit(clamp(((e.clientX - r.left) / r.width) * max));
      }}
      onPointerCancel={() => { const s = st.current; st.current = null; if (s && s.moved) onInput(s.start); }}>
      <span className="scrub-track"><span className="scrub-fill" style={{ width: pct + '%' }} /></span>
      <span className="scrub-thumb" style={{ left: pct + '%' }} />
    </div>
  );
}
