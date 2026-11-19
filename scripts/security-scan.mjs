#!/usr/bin/env node
/**
 * Secret-like content scan with a concise summary (issue #559).
 *
 * Walks the source tree and reports which files contain a match for each rule.
 * It prints only the rule name, path and line number, never the matched text,
 * so a real secret cannot leak into CI logs or a PR summary. A finding makes
 * the exit code 1. When GITHUB_STEP_SUMMARY is set the same summary is appended
 * there so maintainers see the outcome without opening raw logs.
 *
 * Files that intentionally hold secret-shaped placeholders are listed in
 * `ALLOWED_PATHS`; anything else is a finding.
 *
 * Usage: node scripts/security-scan.mjs [root]
 */

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const RULES = [
  { id: "stellar-secret-seed", pattern: /\bS[A-D][A-Z2-7]{54}\b/ },
  { id: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "github-token", pattern: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{36,}\b/ },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
];

/** Paths whose secret-shaped values are documented placeholders or test fixtures. */
export const ALLOWED_PATHS = [/^tests\//, /^docs\/guides\/agent-integration\.md$/];

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  ".git",
  ".next",
  "out",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
]);
const SKIP_FILES = /\.(?:png|jpe?g|gif|ico|webp|woff2?|tgz|zip|wasm|pdf)$/i;

export function scan(root = process.cwd()) {
  const findings = [];
  let scanned = 0;
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile() || SKIP_FILES.test(entry.name)) continue;
      const path = relative(root, join(directory, entry.name)).split(sep).join("/");
      if (ALLOWED_PATHS.some((allowed) => allowed.test(path))) continue;
      let text;
      try {
        text = readFileSync(join(directory, entry.name), "utf8");
      } catch {
        continue;
      }
      scanned += 1;
      text.split(/\r?\n/).forEach((line, index) => {
        for (const rule of RULES) {
          if (rule.pattern.test(line)) findings.push({ rule: rule.id, path, line: index + 1 });
        }
      });
    }
  };
  walk(root);
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { scanned, findings };
}

export function summarize({ scanned, findings }) {
  if (findings.length === 0) {
    return `### Security scan: passed\n\nScanned ${scanned} file(s); no secret-like content found.\n`;
  }
  const rows = findings.map((f) => `| ${f.rule} | \`${f.path}\` | ${f.line} |`);
  return [
    "### Security scan: FAILED",
    "",
    `Scanned ${scanned} file(s); ${findings.length} finding(s). Matched content is never printed.`,
    "",
    "| Rule | Path | Line |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** @param {string} [root] @param {Record<string, string | undefined>} [env] */
export function run(root = process.cwd(), env = process.env) {
  const result = scan(root);
  const summary = summarize(result);
  (result.findings.length > 0 ? console.error : console.log)(summary);
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, summary + "\n");
    } catch {
      // The summary is a convenience; the exit code is the gate.
    }
  }
  return result.findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv[2]);
}
