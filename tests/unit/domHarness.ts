/**
 * Shared jsdom + React harness for component-level tests.
 *
 * Node's test runner has no DOM, so these tests borrow jsdom's. The globals
 * must exist before `react-dom/client` or `axe-core` is loaded, which is why
 * those imports are dynamic and go through `loadReact()`/the test file's
 * `before()` hook — `installDom()` runs first, at module top level.
 *
 * Each test file runs in its own child process, so installing globals here
 * cannot leak into the pure-logic test files.
 */
import { JSDOM } from "jsdom";

let installed: JSDOM | null = null;

/** Install jsdom's window/document/navigator (etc.) as globals. Idempotent. */
export function installDom(): JSDOM {
  if (installed) return installed;
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  // Copy the browser constructors and helpers Node does not have (Event,
  // HTMLElement, getComputedStyle, requestAnimationFrame, …). Properties Node
  // already defines are left alone — its own URL/fetch/etc. work fine — except
  // for window/document/navigator, which are explicitly re-pointed below.
  const source = dom.window as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key === "window" || key === "globalThis" || key === "navigator") continue;
    if (key in globalThis) continue;
    try {
      (globalThis as unknown as Record<string, unknown>)[key] = source[key];
    } catch {
      // A read-only global under Node; React reaches it via window instead.
    }
  }

  const define = (key: string, value: unknown): void => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define("window", dom.window);
  define("document", dom.window.document);
  define("navigator", dom.window.navigator);
  define("IS_REACT_ACT_ENVIRONMENT", true);

  installed = dom;
  return dom;
}

export type Act = (callback: () => void | Promise<void>) => Promise<void>;

/**
 * Load React and React DOM *after* the DOM exists, returning the pieces the
 * component tests need.
 */
export async function loadReact(): Promise<{
  react: typeof import("react");
  createRoot: typeof import("react-dom/client").createRoot;
  act: Act;
}> {
  installDom();
  const [react, client] = await Promise.all([import("react"), import("react-dom/client")]);
  return { react, createRoot: client.createRoot, act: react.act as unknown as Act };
}

/** Wait outside React's control so plain timers can elapse inside `act`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
