// Uygulama kabuğunu önbelleğe alır; API istekleri her zaman ağdan gider.
const CACHE = "kalori-v5";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "prompt.js", "gemini.js", "claude.js", "manifest.json",
  "apple-touch-icon.png", "apple-touch-icon-precomposed.png", "icons/app-icon-192.png", "icons/app-icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname === "api.anthropic.com" || url.hostname === "generativelanguage.googleapis.com") return;
  // İkon ve manifest isteklerine karışma: iOS ana ekran ikonunu doğrudan ağdan alsın.
  if (/\.png$|manifest\.json$/.test(url.pathname)) return;
  // Ağ öncelikli: güncellemeler hemen gelsin, çevrimdışıyken önbellek kullanılsın.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
