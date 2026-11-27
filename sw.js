// Service worker: makes the site installable and lets it open with no signal.
//
// - The app page (index.html) is network-first: online you always get the
//   newest version; offline, or if the network takes longer than a few
//   seconds, you get the last copy saved here.
// - Icons and the manifest are saved on install.
// - Google Fonts are cache-first once seen, so offline keeps the real fonts.
// - /auth/* and /sync/* (sign-in, sync, online games) are never touched,
//   and neither is the JSON API.
//
// Bump VERSION when the PRECACHE list changes. Changes to index.html don't
// need a bump: the page is fetched fresh whenever there's a connection.
const VERSION = "v2";
const CACHE = "sdd-" + VERSION;
const FONTS = "sdd-fonts";
const PRECACHE = ["./", "manifest.webmanifest", "icons/favicon-64.png", "icons/logo.webp", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
const NET_TIMEOUT = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sdd-") && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(fontFirst(req));
    return;
  }
  if (url.origin !== location.origin) return;

  const scope = new URL(self.registration.scope);
  const path = url.pathname.slice(scope.pathname.length); // "" for the app itself
  if (/^(auth|sync|api)\//.test(path)) return;

  if (req.mode === "navigate" && (path === "" || path === "index.html")) {
    e.respondWith(appPage(req));
    return;
  }
  if (PRECACHE.includes(path)) e.respondWith(caches.match(path).then((r) => r || fetch(req)));
});

// Network first, falling back to the saved copy when offline or too slow.
async function appPage(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res.ok && !res.redirected) cache.put("./", res.clone());
    return res;
  });
  const saved = await cache.match("./");
  if (!saved) return net;
  const timeout = new Promise((r) => setTimeout(() => r(saved), NET_TIMEOUT));
  return Promise.race([net.catch(() => saved), timeout]);
}

async function fontFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Offline with no saved font: an empty stylesheet/font beats a failed
    // request, and the page falls back to system fonts.
    return new Response("", { status: 200, headers: { "content-type": req.destination === "style" ? "text/css" : "font/woff2" } });
  }
}
