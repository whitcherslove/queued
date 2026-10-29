import { useRef, useState } from 'react';

/**
 * A visible "press" on a whole card, driven from JS so it also works on phones
 * (CSS :active / :has are unreliable on mobile, and the card re-renders right after the tap).
 * Keeps the pressed look for at least ~140 ms so the dip is always visible.
 */
export function usePress() {
  const [pressed, setPressed] = useState(false);
  const since = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const release = () => {
    const left = Math.max(0, 140 - (Date.now() - since.current));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPressed(false), left);
  };
  const bind = {
    onPointerDown: () => { window.clearTimeout(timer.current); since.current = Date.now(); setPressed(true); },
    onPointerUp: release,
    onPointerCancel: release,
    onPointerLeave: release
  };
  return { pressed, bind };
}
