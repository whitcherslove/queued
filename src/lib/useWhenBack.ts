import { useEffect, useRef } from 'react';
/** Run fn when you come back to the app after being away at least `minSeconds` (other device, friends' changes). */
export function useWhenBack(fn: () => void, minSeconds = 30) {
  const away = useRef<number | null>(null);
  const cb = useRef(fn); cb.current = fn;
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'hidden') away.current = Date.now();
      else if (away.current && Date.now() - away.current > minSeconds * 1000) { away.current = null; cb.current(); }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [minSeconds]);
}
