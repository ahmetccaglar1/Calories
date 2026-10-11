// Uygulama kabuğunu önbelleğe alır; API istekleri her zaman doğrudan ağdan gider.
const CACHE = "kalori-v7";
const SHELL = [
  "./", "index.html", "styles.css", "manifest.json",
  "app.js", "nav.js", "store.js", "db.js", "util.js", "ai.js", "prompt.js", "gemini.js", "claude.js", "today.js", "meal.js", "history.js", "charts.js", "suggest.js", "profile.js", "barcode.js", "onboarding.js", "update.js",
  "apple-touch-icon.png", "apple-touch-icon-precomposed.png", "icons/app-icon-192.png", "icons/app-icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
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
  // Sadece kendi dosyalarımızı ve Claude SDK'sını (esm.sh) önbelleğe al; API'ler (Gemini, Anthropic, Open Food Facts) her zaman doğrudan ağdan
  if (e.request.method !== "GET" || (url.origin !== self.location.origin && url.hostname !== "esm.sh")) return;
  // İkon ve manifest isteklerine karışma: iOS ana ekran ikonunu doğrudan ağdan alsın.
  if (/\.png$|manifest\.json$/.test(url.pathname)) return;
  // Ağ öncelikli: güncellemeler hemen gelsin, çevrimdışıyken önbellek kullanılsın.
  // Kendi dosyalarımızda tarayıcı önbelleğini atla (no-cache), böylece deploy sonrası eski sürüm gelmez.
  const sameOrigin = url.origin === self.location.origin;
  e.respondWith(
    (sameOrigin ? fetch(url.href, { cache: "no-cache", credentials: "same-origin" }) : fetch(e.request))
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
