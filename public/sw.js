/*
 * Stellar Agent Guard — service worker.
 *
 * The dashboard is a pure client-side console whose every number comes from a
 * live Soroban RPC read. Caching is therefore only ever applied to the *static
 * shell* (documents, scripts, styles, fonts, icons) so a phone can open the
 * console instantly or after a local network drop. Nothing that carries chain
 * state is ever stored:
 *
 *   - `/soroban/rpc` and any Horizon endpoint are hard-bypassed below. The fetch
 *     handler returns without calling `respondWith`, which hands the request
 *     straight to the browser's own network path — no cache read, no cache write,
 *     and no chance of a stale policy, freeze flag or balance being rendered as
 *     if it were live.
 *
 * A stale shell is recoverable — reloading fetches it again. A stale freeze flag
 * is not: during an incident the console must show what the chain says now.
 */

const CACHE_NAME = "stellar-agent-guard-static-v1";
const OFFLINE_URL = "/offline.html";

/** Everything the shell needs to render without the network. */
const PRECACHE_URLS = [
  "/",
  OFFLINE_URL,
  "/manifest.json",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
];

/*
 * Chain endpoints are matched on host *and* path, because the RPC can be reached
 * as either `https://soroban-testnet.stellar.org` or a path on a gateway
 * (`/soroban/rpc`), and Horizon is always a `horizon*.stellar.org` host.
 */
const NETWORK_ONLY_HOST_MARKERS = ["soroban", "horizon"];
const NETWORK_ONLY_PATH_MARKERS = ["/soroban/rpc", "/rpc", "/horizon"];

/**
 * True for any request that must go to the network, uncached, every time.
 * Unknown or unparsable URLs return true: bypassing is always the safe default.
 */
function isNetworkOnlyRequest(url) {
  let parsed;
  try {
    parsed = new URL(url, self.location.origin);
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (NETWORK_ONLY_HOST_MARKERS.some((marker) => host.includes(marker))) return true;
  if (NETWORK_ONLY_PATH_MARKERS.some((marker) => path.includes(marker))) return true;
  return false;
}

function isSameOrigin(url) {
  try {
    return new URL(url, self.location.origin).origin === self.location.origin;
  } catch {
    return false;
  }
}

/** Only a successful, non-opaque response is worth storing. */
function isCacheable(response) {
  return Boolean(response) && response.status === 200 && (response.type === "basic" || response.type === "default");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Writes are never cached and never served from a cache.
  if (request.method !== "GET") return;

  // ── The hard bypass: chain reads go straight to the network ──────────────
  if (isNetworkOnlyRequest(request.url)) return;

  // Document navigations: fresh when online, cached shell when not.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request));
    return;
  }

  // Static same-origin assets: cache-first with a background refresh.
  if (isSameOrigin(request.url)) {
    event.respondWith(handleStatic(event, request));
  }
});

async function handleStatic(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Serve the cached copy now and let the refresh settle in the background.
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  return fresh || Response.error();
}

async function handleNavigation(event, request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/")) ||
      (await cache.match(OFFLINE_URL)) ||
      Response.error()
    );
  }
}
