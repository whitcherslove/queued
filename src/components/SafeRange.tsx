import { useRef } from 'react';

/**
 * A range slider that only moves when you drag sideways: touching it while scrolling the page up/down does nothing.
 * onInput — live value while dragging; onCommit — final value when you let go.
 */
export default function SafeRange({ value, min = 0, max = 100, step = 1, label, className, onInput, onCommit }: {
  value: number; min?: number; max?: number; step?: number; label: string; className?: string;
  onInput: (v: number) => void; onCommit: (v: number) => void;
}) {
  const ptr = useRef<{ x: number; y: number; armed: boolean; start: number } | null>(null);
  const last = useRef(value);
  const cancel = () => { if (ptr.current && !ptr.current.armed) onInput(ptr.current.start); ptr.current = null; };
  return (
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} className={className} style={{ touchAction: 'pan-y' }}
      onPointerDown={(e) => { ptr.current = { x: e.clientX, y: e.clientY, armed: e.pointerType === 'mouse', start: value }; }}
      onPointerMove={(e) => { const p = ptr.current; if (!p || p.armed) return; const dx = Math.abs(e.clientX - p.x), dy = Math.abs(e.clientY - p.y); if (dx > 6 && dx > dy) p.armed = true; else if (dy > 8) cancel(); }}
      onPointerCancel={cancel}
      onChange={(e) => { if (ptr.current && !ptr.current.armed) return; const v = Number(e.target.value); last.current = v; onInput(v); }}
      onPointerUp={() => { const p = ptr.current; ptr.current = null; if (p && p.armed && last.current !== p.start) onCommit(last.current); }}
      onKeyUp={() => onCommit(last.current)} />
  );
}
