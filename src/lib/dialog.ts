/** In-app dialogs and toasts (the browser's own confirm/prompt look foreign in the home-screen app and sometimes don't show at all). */
export type DialogReq =
  | { kind: 'confirm'; text: string; ok?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'text'; title: string; value?: string; placeholder?: string; resolve: (v: string | null) => void };
type Listener = (d: DialogReq | null, toast: string | null) => void;
let listener: Listener | null = null;
let current: DialogReq | null = null;
let toast: string | null = null;
let toastTimer: number | undefined;
export const onDialog = (l: Listener) => { listener = l; return () => { if (listener === l) listener = null; }; };
const emit = () => listener?.(current, toast);
export function askConfirm(text: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  if (!listener) return Promise.resolve(window.confirm(text));
  return new Promise((resolve) => { current = { kind: 'confirm', text, ...opts, resolve: (v) => { current = null; emit(); resolve(v); } }; emit(); });
}
export function askText(title: string, value = '', placeholder = ''): Promise<string | null> {
  if (!listener) return Promise.resolve(window.prompt(title, value));
  return new Promise((resolve) => { current = { kind: 'text', title, value, placeholder, resolve: (v) => { current = null; emit(); resolve(v); } }; emit(); });
}
/** A short message at the bottom ("Added ✓", "Couldn't save — check the connection"). */
export function notify(text: string, ms = 2600) {
  toast = text; emit();
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toast = null; emit(); }, ms);
}
/** Run an action: on failure say so instead of failing silently. */
export async function attempt<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
  try { const r = await fn(); if (ok) notify(ok); return r; }
  catch (e) { notify(navigator.onLine ? 'Couldn’t save — ' + ((e as Error).message || 'try again') : 'You’re offline — nothing was saved'); return undefined; }
}
