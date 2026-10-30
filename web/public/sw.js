// Service worker voor Atlas als app op de telefoon. Houdt alleen de schil van de app bij de hand, zodat hij snel opent
// en bij een haperende verbinding een nette pagina toont. Gegevens (/api) gaan altijd naar de server, nooit uit de cache.
const CACHE = 'atlas-schil-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Eerst het netwerk, zodat een nieuwe versie meteen te zien is; lukt dat niet, dan de bewaarde versie.
  e.respondWith(
    fetch(e.request)
      .then((antwoord) => {
        if (antwoord.ok && (url.pathname === '/' || url.pathname.startsWith('/assets/'))) {
          const kopie = antwoord.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwoord;
      })
      .catch(() => caches.match(e.request).then((bewaard) => bewaard ?? caches.match('/'))),
  );
});
