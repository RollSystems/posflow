// PosFlow - service worker: permite abrir la app sin internet.
const V = 'posflow-v3';
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(V)
      .then((c) => Promise.all(['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'favicon.ico'].concat(LIBS).map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // Librerías externas: primero la copia guardada
  if (LIBS.indexOf(r.url) >= 0) {
    e.respondWith(caches.match(r).then((m) => m || fetch(r).then((x) => { const cp = x.clone(); caches.open(V).then((c) => c.put(r, cp)); return x; })));
    return;
  }
  // Datos (API) y otros sitios (Supabase): siempre a la red, sin tocar
  if (u.origin !== location.origin || u.pathname.indexOf('/api/') === 0) return;
  // La app: red primero (así se actualiza sola) y, sin internet, la copia guardada
  e.respondWith(
    fetch(r).then((x) => { if (x.ok) { const cp = x.clone(); caches.open(V).then((c) => c.put(r, cp)); } return x; })
      .catch(() => caches.match(r).then((m) => m || caches.match('index.html')))
  );
});
