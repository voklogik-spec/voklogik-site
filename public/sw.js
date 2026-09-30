// Voklogik service worker.
// Design goal: NEVER let this cause the "stale site" problem again.
// Strategy: always try the network first for the page itself; the cache is
// only a fallback for when the device is genuinely offline. Static icon/
// manifest files are cached for speed, but everything else (the app page,
// Netlify functions, Stripe, fonts, the PDF library) always goes to the
// network untouched.

const CACHE = "voklogik-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept payment/entitlement calls or anything off-site
  // (Netlify functions, Stripe, Google Fonts, cdnjs, Google Analytics, etc.)
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/.netlify/")) return;

  // The page itself: network first, always. Cache is only an offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Known static shell assets: cache-first (fast), network as backup.
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // Everything else: just let it go to the network normally.
});
