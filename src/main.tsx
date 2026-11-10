import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({ immediate: true });

// No pinch or double-tap zoom (iOS ignores user-scalable=no, so block the gestures too)
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 300) e.preventDefault(); lastTouchEnd = now; }, { passive: false });

// Keep the installed app in portrait where the platform allows it
const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
if (window.matchMedia('(display-mode: standalone)').matches && so?.lock) so.lock('portrait').catch(() => undefined);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// splash: hold the full word, then the whole thing goes up and the app slides in (1.7 s → 2.0 s of the animation)
const hideSplash = () => {
  const el = document.getElementById('splash'); if (!el) return;
  el.classList.add('gone');
  document.getElementById('root')?.classList.add('enter');
  setTimeout(() => el.remove(), 450);
};
const waitSplash = () => {
  const start = (window as unknown as { __splashStart?: number }).__splashStart;
  if (start === undefined) { setTimeout(waitSplash, 50); return; }
  setTimeout(hideSplash, Math.max(0, 2300 - (performance.now() - start)));
};
requestAnimationFrame(waitSplash);
