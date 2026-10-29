/* REVIEW+ service worker: keeps the app working with no internet.
 * When you change any app file, raise the number in CACHE so phones get the update. */
const CACHE = 'reviewhub-v2';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './js/core.js', './js/quiz.js', './js/student.js', './js/teacher.js', './js/admin.js', './js/reports.js', './js/main.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the Google server is handled by the app itself

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // App files: answer from the saved copy right away, refresh it in the background.
  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
