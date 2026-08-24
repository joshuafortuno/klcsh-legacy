/*
  SW.JS — service worker
  --------------------------------------------------------
  What this is for: a service worker is required for a site to be
  "installable" as a PWA at all (Chrome/Edge's install prompt, or
  mobile "Add to Home Screen") — this is the minimum a browser
  needs to consider the site an app rather than just a page.

  Strategy: NETWORK-FIRST, not cache-first. We've hit real
  confusion more than once in this project already from the
  browser's normal HTTP cache serving stale JS after a deploy —
  a service worker with an aggressive cache-first strategy would
  make that worse, not better, since it sits in front of even a
  hard refresh. So: always try the network first (freshest
  possible), only fall back to whatever's cached if the network
  request actually fails (i.e. genuinely offline). The cache
  updates itself in the background on every successful fetch, so
  it's never more than one page load out of date.

  Only same-origin GET requests are touched — Supabase API calls,
  Google Fonts, and the jsdelivr CDN script all pass straight
  through untouched, exactly as if this service worker didn't
  exist. Auth/session state lives in the browser's own storage,
  not here, so there's nothing sensitive in this cache.
  --------------------------------------------------------
*/

const CACHE_NAME = "klcsh-legacy-v1";

// Small, safe starter set — just enough that the very first
// install has something to fall back to offline. Everything else
// gets cached opportunistically as pages are actually visited.
const APP_SHELL = [
  "/",
  "/style.css",
  "/auth-guard.js",
  "/supabase-client.js",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return; // not ours to handle — let it go straight to the network
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
