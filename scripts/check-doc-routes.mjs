#!/usr/bin/env node
/**
 * Check route documentation against the app route tree (issue #558).
 *
 * Routes the README documents as screens (a bold, code-formatted path such as
 * **`/configure`**) must exist as page files under `app/`, and every page must
 * be documented. Documented paths that are not pages (static files) are listed
 * in `NON_PAGE_ROUTES`.
 *
 * Usage: node scripts/check-doc-routes.mjs [root]
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Documented paths that are intentionally not pages under app/. */
export const NON_PAGE_ROUTES = new Set(["/manifest.json", "/sw.js", "/offline.html"]);

const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js)$/;

export function findPageRoutes(root = process.cwd()) {
  const routes = [];
  const walk = (directory, segments) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Route groups such as "(shell)" do not appear in the URL.
        const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(join(directory, entry.name), grouped ? segments : [...segments, entry.name]);
      } else if (entry.isFile() && PAGE_FILE.test(entry.name)) {
        routes.push("/" + segments.join("/"));
      }
    }
  };
  walk(join(root, "app"), []);
  return [...new Set(routes)].sort();
}

/** Routes named in bold code in the README, with any query string removed. */
export function findDocumentedRoutes(root = process.cwd()) {
  const text = readFileSync(join(root, "README.md"), "utf8");
  const found = new Set();
  for (const match of text.matchAll(/\*\*`(\/[A-Za-z0-9/_.-]*)(?:\?[^`]*)?`/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/** Differences between the two lists, as actionable sentences. */
export function compareRoutes(documented, pages, nonPage = NON_PAGE_ROUTES) {
  const problems = [];
  for (const route of documented) {
    if (!pages.includes(route) && !nonPage.has(route)) {
      problems.push(
        `README documents ${route} but the app has no page for it. Remove or fix the entry, or add it to NON_PAGE_ROUTES in scripts/check-doc-routes.mjs if it is not a page.`,
      );
    }
  }
  for (const route of pages) {
    if (!documented.includes(route)) {
      problems.push(
        `The app has the page ${route} but the README Screens section does not document it. Add a bold, code-formatted ${route} entry.`,
      );
    }
  }
  return problems;
}

export function run(root = process.cwd()) {
  if (!existsSync(join(root, "app"))) {
    console.error("route docs: no app/ directory under the root.");
    return 1;
  }
  const pages = findPageRoutes(root);
  const documented = findDocumentedRoutes(root);
  const problems = compareRoutes(documented, pages);
  if (problems.length === 0) {
    console.log(`route docs: consistent - ${pages.length} page route(s) documented.`);
    return 0;
  }
  console.error(
    `route docs: ${problems.length} difference(s) between README and the app route tree:`,
  );
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv[2]);
}
