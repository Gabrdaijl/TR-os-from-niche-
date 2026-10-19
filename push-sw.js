'use strict';

self.addEventListener('push', event => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch {}
  const title = typeof message.title === 'string' ? message.title.slice(0, 80) : 'TR-os';
  const options = {
    body: typeof message.body === 'string' ? message.body.slice(0, 180) : 'Du har en ny avisering.',
    icon: '/logo.png', badge: '/pwa-icon.svg', tag: typeof message.tag === 'string' ? message.tag.slice(0, 100) : 'tr-os',
    renotify: false, data: { url: typeof message.url === 'string' && message.url.startsWith('/') && !message.url.startsWith('//') ? message.url : '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target.href);
  })());
});
