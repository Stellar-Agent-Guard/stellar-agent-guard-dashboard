"use client";

import { useSyncExternalStore } from "react";
import { isDemoMode } from "./demoFixtures.ts";

/**
 * Read demo mode as external browser state.
 *
 * Demo mode has two sources: a build-time environment flag and a `?demo=true`
 * query parameter. The query string only exists in the browser, so reading it
 * during render would produce different HTML on the server and the client and
 * desynchronise hydration. `useSyncExternalStore` is the tool for exactly this:
 * it serves the environment-only answer while rendering on the server (and
 * during hydration), then adopts the query-aware answer on the client, and
 * re-reads on history navigation. It also keeps demo detection out of a
 * `setState`-in-effect, which React flags as a cascading render.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

/** The client answer, including `?demo=true`. */
function getSnapshot(): boolean {
  return isDemoMode({ search: window.location.search });
}

/** The server answer, where only the environment flag is known. */
function getServerSnapshot(): boolean {
  return isDemoMode();
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
