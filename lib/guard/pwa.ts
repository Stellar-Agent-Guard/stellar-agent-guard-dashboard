/**
 * The Progressive Web App contract, in one place.
 *
 * The manifest, the service worker and the document metadata must agree on three
 * things — where the manifest lives, which script is the worker, and what the
 * browser chrome should be tinted — so they are declared once here instead of
 * being repeated as string literals in the layout, the worker registration and
 * the tests. The asset files themselves stay static under `public/`, which is
 * the only directory Next serves verbatim at the URLs recorded here.
 */

/** Public URL of the web app manifest. */
export const PWA_MANIFEST_PATH = "/manifest.json";

/** Public URL of the service worker script. */
export const SERVICE_WORKER_PATH = "/sw.js";

/** Public URL of the offline fallback document the worker precaches. */
export const PWA_OFFLINE_PATH = "/offline.html";

/** Must equal `theme_color` / `background_color` in `public/manifest.json`. */
export const PWA_THEME_COLOR = "#0a0d12";
