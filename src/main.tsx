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

// splash: fade out after the first screen is up (but let the Q draw and the dots drip first)
const t0 = performance.now();
const hideSplash = () => { const el = document.getElementById('splash'); if (!el) return; el.classList.add('gone'); setTimeout(() => el.remove(), 400); };
requestAnimationFrame(() => setTimeout(hideSplash, Math.max(0, 2200 - (performance.now() - t0))));
