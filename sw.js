// 인터넷 연결이 잠시 끊겨도 마지막으로 받은 화면을 보여 주기 위한 파일입니다.
// 항상 새 파일을 먼저 받아 오므로, 안내 내용을 수정하면 바로 반영됩니다.
const CACHE = 'kiosk-v1';
const FILES = ['./', './index.html', './styles.css', './app.js', './config.js', './vendor/qrcode.js', './assets/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
