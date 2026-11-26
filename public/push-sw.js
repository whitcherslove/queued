// Queued · push handling inside the service worker (imported by the generated sw.js)
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Queued', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Queued', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: '/icons/notify-192.png', badge: '/icons/badge-96.png', data: { url: d.url || '/' }
  }));
});

// Tapping a notification: show the app FIRST (browsers allow that only right after the tap),
// then tell it where to go; no open window → open one at the full address; anything fails → open the app anyway.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    try {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const c = all.find((x) => x.url.startsWith(self.location.origin)) || all[0];
      if (c) {
        try { await c.focus(); } catch (e) { /* not allowed — open a window below */ }
        c.postMessage({ type: 'open', url });
        if (c.focused || c.visibilityState === 'visible') return;
      }
      await self.clients.openWindow(url);
    } catch (e) {
      try { await self.clients.openWindow(self.location.origin + '/'); } catch (e2) { /* nothing more we can do */ }
    }
  })());
});
