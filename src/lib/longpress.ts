import { useRef } from 'react';

/** Long press (≈450 ms without moving) → callback; swallows the click that follows. */
export function useLongPress(onLong: (key: string) => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } start.current = null; };
  const bind = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button > 0) return;
      fired.current = false; start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true; timer.current = null;
        if (navigator.vibrate) navigator.vibrate(12);
        onLong(key);
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && (Math.abs(e.clientX - start.current.x) > 8 || Math.abs(e.clientY - start.current.y) > 8)) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!fired.current) { fired.current = true; clear(); onLong(key); } },
    onClickCapture: (e: React.MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } }
  });
  return bind;
}
