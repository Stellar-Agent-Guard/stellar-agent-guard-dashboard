#!/usr/bin/env node
/**
 * Verify the vendored SDK tarball against its recorded provenance (issue #551).
 *
 * The committed `vendor/stellar-agent-guard-sdk-*.tgz` is a security-sensitive
 * build input. `vendor/sdk-provenance.json` records the expected SHA-256 and
 * SHA-512 digests of those exact bytes plus the SDK source revision they were
 * built from. This script only reads and hashes the file: it never extracts,
 * installs, imports or runs anything from the tarball, so a replaced tarball
 * cannot execute code through this check.
 *
 * Usage: node scripts/verify-sdk-provenance.mjs [root]
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PROVENANCE_PATH = "vendor/sdk-provenance.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** All problems found for the tree at `root`; an empty list means verified. */
export function verifySdkProvenance(root = process.cwd()) {
  const problems = [];
  let record;
  try {
    record = readJson(join(root, PROVENANCE_PATH));
  } catch (error) {
    return [`${PROVENANCE_PATH} is missing or not valid JSON (${error.code ?? error.name}).`];
  }
  for (const field of ["tarball", "sha256", "integrity", "sourceRevision"]) {
    if (typeof record[field] !== "string" || record[field] === "") {
      problems.push(`${PROVENANCE_PATH}: field "${field}" is missing.`);
    }
  }
  if (problems.length > 0) return problems;

  let bytes;
  try {
    bytes = readFileSync(join(root, record.tarball));
  } catch {
    return [`${record.tarball} is recorded in ${PROVENANCE_PATH} but cannot be read.`];
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== record.sha256) {
    problems.push(
      `${record.tarball}: SHA-256 is ${sha256}, expected ${record.sha256}. The tarball changed; ` +
        `rebuild it from SDK revision ${record.sourceRevision} or update ${PROVENANCE_PATH} in a reviewed change.`,
    );
  }
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== record.integrity) {
    problems.push(
      `${record.tarball}: SHA-512 integrity is ${integrity}, expected ${record.integrity}.`,
    );
  }

  try {
    const lock = readJson(join(root, "package-lock.json"));
    const entry = lock.packages?.["node_modules/stellar-agent-guard-sdk"];
    if (!entry) {
      problems.push("package-lock.json has no node_modules/stellar-agent-guard-sdk entry.");
    } else {
      if (entry.resolved !== `file:${record.tarball}`) {
        problems.push(
          `package-lock.json resolves the SDK to ${entry.resolved}, expected file:${record.tarball}.`,
        );
      }
      if (entry.integrity !== record.integrity) {
        problems.push(
          "package-lock.json integrity for the SDK differs from the recorded provenance.",
        );
      }
    }
  } catch {
    problems.push("package-lock.json cannot be read.");
  }
  return problems;
}

export function run(root = process.cwd()) {
  const problems = verifySdkProvenance(root);
  if (problems.length === 0) {
    console.log("sdk provenance: verified - vendored tarball matches the recorded checksum.");
    return 0;
  }
  console.error(`sdk provenance: ${problems.length} problem(s) with the vendored SDK tarball:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nThe tarball was only hashed, never unpacked or executed.");
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv[2]);
}
