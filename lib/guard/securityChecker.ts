/**
 * Simple embedded malicious address registry and helpers.
 *
 * The registry is intentionally small and versioned; real deployments should
 * update the list and bump the `REGISTRY_VERSION` when new addresses are
 * flagged.
 */

export const REGISTRY_VERSION = "2026-09-25";

const FLAGGED_ADDRESSES = new Set([
  // example flagged addresses for testing and initial protection
  "GBADFLAGEXAMPLE000000000000000000000000000000000000000",
  "GPHISHINGADDR0000000000000000000000000000000000000000",
]);

function normalize(address: string) {
  return address.trim();
}

export function isFlagged(address: string): boolean {
  if (!address) return false;
  return FLAGGED_ADDRESSES.has(normalize(address));
}

export function findFlagged(addresses: string[] | undefined): string[] {
  if (!addresses) return [];
  return addresses.map(normalize).filter((a) => a.length > 0 && isFlagged(a));
}

/**
 * Given the freeform fields from the policy form, return the list of flagged
 * addresses present. This is convenient for consumers (UI) and for unit tests.
 */
export function findFlaggedInDraft(options: { assets?: string; recipients?: string; protocols?: string }): string[] {
  const { assets = "", recipients = "", protocols = "" } = options;

  const assetsList = assets.split(/\r?\n/).map((s) => s.split(" ")[0]).map((s) => s.trim()).filter(Boolean);
  const recipientsList = recipients.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // protocols lines may be of the form: ADDRESS or ADDRESS:fn
  const protocolsList = protocols
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(":") ? s.split(":")[0].trim() : s));

  const all = [...assetsList, ...recipientsList, ...protocolsList];
  return Array.from(new Set(findFlagged(all)));
}

export function registryVersion() {
  return REGISTRY_VERSION;
}
