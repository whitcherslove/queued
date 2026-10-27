import { useEffect, useRef } from 'react';

/**
 * Back gesture / button closes the topmost open layer instead of leaving the app.
 * One history entry per open layer. When a layer is closed from the UI we go back one entry ourselves;
 * any layer opened before that "back" lands is queued, so pushes and pops never cross.
 */
const stack: (() => void)[] = [];
let ignore = 0;   // popstate events we caused ourselves
let queued = 0;   // pushes waiting until those events land

function push() {
  if (ignore > 0) { queued++; return; }
  history.pushState({ queued: true, t: Date.now() }, '');
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignore > 0) {
      ignore--;
      if (ignore === 0) while (queued > 0) { queued--; history.pushState({ queued: true, t: Date.now() }, ''); }
      return;
    }
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
    push();
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i < 0) return;                 // already closed by the back gesture
      stack.splice(i, 1);
      if (queued > 0) queued--;          // its entry was never pushed
      else { ignore++; history.back(); }
    };
  }, [open]);
}
