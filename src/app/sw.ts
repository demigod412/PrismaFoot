/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist, ExpirationPlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined }
}
declare const self: ServiceWorkerGlobalScope;

/*
 * Offline plan:
 *  - precache the app shell (build manifest) + /~offline
 *  - fixture lists and match pages: NetworkFirst (3s timeout), keep last 40 pages for 3 days
 *  - /settings and /api/*: NetworkOnly — never cached, keys never touch the SW
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: ({ url }) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/settings"), handler: new NetworkOnly() },
    {
      matcher: ({ request, url }) => request.mode === "navigate" && (url.pathname === "/" || /^\/(fixtures|match|league|scanner)/.test(url.pathname)),
      handler: new NetworkFirst({
        cacheName: "pages",
        networkTimeoutSeconds: 3,
        plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 3 * 24 * 3600 })],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: { entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }] },
});
serwist.addEventListeners();
