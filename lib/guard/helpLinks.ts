/**
 * In-app help destinations, in one place.
 *
 * Every "how do I…" link the console renders points into this repository's
 * `docs/` tree on GitHub. Keeping the paths here — rather than as string
 * literals scattered through components — lets a unit test assert that each
 * one names a document that actually exists in the repository, so a renamed
 * guide cannot silently leave the interface linking to a 404.
 *
 * Links are plain external anchors: the console is a static, client-only
 * bundle with no server routes, so it never proxies or renders the docs itself.
 */

export const DOCS_BASE =
  "https://github.com/Stellar-Agent-Guard/stellar-agent-guard-dashboard/blob/main";

/** Repository-relative paths of the documents the interface links to. */
export const HELP_DOCS = {
  /** Keyboard shortcuts and screen-reader patterns (issue #541). */
  keyboard: "docs/guides/keyboard-and-screen-reader.md",
  /** How to read the overview status panel (issue #531). */
  overview: "docs/screens/overview.md",
  /** What the guard does and does not enforce. */
  enforcementScope: "docs/enforcement-scope.md",
  /** Emergency freeze and incident response. */
  incidentRunbook: "docs/runbooks/emergency-freeze.md",
} as const;

export type HelpDoc = keyof typeof HELP_DOCS;

/** Absolute URL for a help document, optionally at a heading anchor. */
export function helpHref(doc: HelpDoc, anchor?: string): string {
  const base = `${DOCS_BASE}/${HELP_DOCS[doc]}`;
  return anchor ? `${base}#${anchor}` : base;
}
