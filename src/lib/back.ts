import { useEffect, useRef } from 'react';

/** Back gesture / button closes the topmost open layer instead of leaving the app. */
const stack: (() => void)[] = [];
let ignoreNext = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignoreNext > 0) { ignoreNext--; return; }
    const fn = stack.pop();
    if (fn) fn();
  });
}

export function useBackLayer(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    const handler = () => ref.current();
    stack.push(handler);
    history.pushState({ layer: stack.length }, '');
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) { stack.splice(i, 1); ignoreNext++; history.back(); }
    };
  }, [open]);
}
