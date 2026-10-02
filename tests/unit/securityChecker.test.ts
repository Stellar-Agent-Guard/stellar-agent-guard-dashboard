import assert from "node:assert/strict";
import { test } from "node:test";
import { Address, StrKey } from "@stellar/stellar-sdk";
import {
  CRITICAL_ADDRESS_WARNING,
  CLOSED_OVERRIDE,
  MALICIOUS_ADDRESS_REGISTRY,
  OVERRIDE_PHRASE,
  REGISTRY_UPDATED_AT,
  REGISTRY_VERSION,
  canonicalIdentity,
  draftAddressCandidates,
  fieldLabel,
  lookupRegistry,
  overrideSatisfied,
  screenDraft,
  screenKey,
} from "../../lib/guard/securityChecker.ts";
import { EMPTY_DRAFT, type PolicyDraft } from "../../lib/guard/policyForm.ts";

/**
 * A real flagged account from the embedded registry, and a clean one from the
 * project's own fixtures. Neither is invented: the flagged address is an entry in
 * `MALICIOUS_ADDRESS_REGISTRY` with a public report behind it, so a test that
 * depends on it is also a test that the entry survived the registry edit.
 */
const FLAGGED = MALICIOUS_ADDRESS_REGISTRY[0]!.address;
const CLEAN_RECIPIENT = "GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH";
const CLEAN_CONTRACT = "CDCYDGBGS5AZ5BZS6XY2SK2PHJHSOEGTN3N4INCK34KF6GU2BGC7Z6MB";

function draft(overrides: Partial<PolicyDraft> = {}): PolicyDraft {
  return { ...EMPTY_DRAFT, perTxCap: "1000", recipients: CLEAN_RECIPIENT, ...overrides };
}

test("the registry is versioned and dated, because a warning nobody can date is a rumour", () => {
  assert.match(REGISTRY_VERSION, /^\d{4}\.\d{2}\.\d+$/);
  assert.match(REGISTRY_UPDATED_AT, /^\d{4}-\d{2}-\d{2}$/);
});

test("every registry entry is a real address with a report the operator can open", () => {
  assert.ok(MALICIOUS_ADDRESS_REGISTRY.length > 0, "the embedded registry must not ship empty");

  for (const entry of MALICIOUS_ADDRESS_REGISTRY) {
    assert.doesNotThrow(
      () => Address.fromString(entry.address),
      `${entry.address} must be a valid Stellar address`,
    );
    assert.ok(entry.reason.trim().length > 0, `${entry.address} needs a reason`);
    assert.match(entry.reportedAt, /^\d{4}-\d{2}-\d{2}$/, `${entry.address} needs an ISO date`);
    assert.match(
      entry.source,
      /^https:\/\//,
      `${entry.address} must cite an https source an operator can re-check`,
    );
  }
});

test("the registry carries no duplicate addresses, which would make a match ambiguous", () => {
  const seen = new Set<string>();
  for (const entry of MALICIOUS_ADDRESS_REGISTRY) {
    assert.equal(seen.has(entry.address), false, `${entry.address} appears twice`);
    seen.add(entry.address);
  }
});

test("the warning the operator reads is the one the issue requires, verbatim", () => {
  assert.equal(
    CRITICAL_ADDRESS_WARNING,
    "CRITICAL: This address has been flagged as malicious or compromised.",
  );
});

test("a flagged address entered as a recipient is found", () => {
  const result = screenDraft(draft({ recipients: FLAGGED }));
  assert.equal(result.flagged, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.address, FLAGGED);
  assert.equal(result.findings[0]!.field, "recipients");
  assert.equal(result.findings[0]!.viaMuxedAlias, false);
});

test("a flagged address is found in every field that becomes an allowlist", () => {
  // Each of these boxes ends up in a contract-enforced allowlist, so screening
  // only one of them would leave the door open through the other four.
  const cases: Array<[keyof PolicyDraft, PolicyDraft]> = [
    ["assets", draft({ assets: FLAGGED, recipients: CLEAN_RECIPIENT })],
    ["recipients", draft({ recipients: FLAGGED })],
    ["protocols", draft({ protocols: FLAGGED })],
    [
      "assetCaps",
      draft({
        assetCaps: [{ assetContractAddress: FLAGGED, maxCapStroops: "100", symbol: "X" }],
      }),
    ],
  ];

  for (const [field, candidate] of cases) {
    const result = screenDraft(candidate);
    assert.equal(result.flagged, true, `${field} must be screened`);
    assert.equal(result.findings[0]!.field, field);
  }
});

test("a flagged protocol line is matched on the address, not on the whole line", () => {
  // `C…:swap,deposit` is the form's per-function syntax. Matching the raw line
  // would miss the address on exactly the entries that carry a function list.
  const result = screenDraft(draft({ protocols: `${FLAGGED}:swap,deposit` }));
  assert.equal(result.flagged, true);
  assert.equal(result.findings[0]!.address, FLAGGED);
});

test("a muxed form of a flagged account is matched, and reported as a different entry", () => {
  // The whole reason matching runs on identity rather than on text: an `M…`
  // string shares no characters with the `G…` it encodes, so a text compare
  // passes it straight through. This is the shape an obfuscated paste takes.
  const underlying = StrKey.decodeEd25519PublicKey(FLAGGED);
  const muxed = StrKey.encodeMed25519PublicKey(
    new Uint8Array([...underlying, ...Uint8Array.from([0, 0, 0, 0, 0, 0, 4, 210])]),
  );
  assert.notEqual(muxed, FLAGGED, "the fixture must actually produce a different string");

  const result = screenDraft(draft({ recipients: muxed }));
  assert.equal(result.flagged, true, "a muxed alias must not be a way past the registry");
  const finding = result.findings[0]!;
  assert.equal(finding.address, FLAGGED, "the finding names the underlying flagged account");
  assert.equal(finding.entered, muxed, "the finding also echoes what was actually typed");
  assert.equal(finding.viaMuxedAlias, true);
});

test("surrounding whitespace and a bare trailing newline do not hide a hit", () => {
  const result = screenDraft(draft({ recipients: `  ${FLAGGED}  \n` }));
  assert.equal(result.flagged, true);
});

test("a clean policy is not flagged, and says how much it screened", () => {
  const result = screenDraft(
    draft({ assets: CLEAN_CONTRACT, recipients: CLEAN_RECIPIENT, protocols: `${CLEAN_CONTRACT}:swap` }),
  );
  assert.equal(result.flagged, false);
  assert.deepEqual(result.findings, []);
  assert.equal(result.checked, 3);
  assert.equal(result.version, REGISTRY_VERSION);
  assert.equal(result.updatedAt, REGISTRY_UPDATED_AT);
});

test("an address that is not on the registry is unknown, not cleared", () => {
  // The distinction the modal has to preserve: a miss means "not known here".
  assert.equal(lookupRegistry(CLEAN_RECIPIENT), null);
  assert.equal(screenDraft(draft({ recipients: CLEAN_RECIPIENT })).flagged, false);
});

test("an unparseable entry is ignored by the check, which is the form validator's job", () => {
  // `buildPolicyConfig` already refuses these. The checker must not crash on the
  // way there, and must not pretend a string it cannot parse is a clean bill.
  const result = screenDraft(draft({ recipients: "not-an-address" }));
  assert.equal(result.flagged, false);
  assert.equal(canonicalIdentity("not-an-address"), null);
  assert.equal(canonicalIdentity(""), null);
});

test("several flagged addresses are all reported, not just the first", () => {
  // Collapsing to one finding would hide the size of the problem from the
  // operator deciding whether to override.
  const second = MALICIOUS_ADDRESS_REGISTRY[1]!.address;
  const result = screenDraft(draft({ recipients: `${FLAGGED}\n${second}` }));
  assert.equal(result.findings.length, 2);
  assert.deepEqual(
    result.findings.map((finding) => finding.address),
    [FLAGGED, second],
  );
});

test("a hit on one list and a miss on another is still a hit", () => {
  const result = screenDraft(draft({ assets: FLAGGED, recipients: CLEAN_RECIPIENT }));
  assert.equal(result.flagged, true);
  assert.equal(result.findings.length, 1);
});

test("candidate extraction covers exactly the boxes the form offers", () => {
  const candidates = draftAddressCandidates(
    draft({
      assets: CLEAN_CONTRACT,
      recipients: `${CLEAN_RECIPIENT}\n${FLAGGED}`,
      protocols: `${CLEAN_CONTRACT}:swap`,
      assetCaps: [{ assetContractAddress: FLAGGED, maxCapStroops: "100", symbol: "X" }],
    }),
  );
  assert.deepEqual(
    candidates.map((candidate) => `${candidate.field}:${candidate.entered}`),
    [
      `assets:${CLEAN_CONTRACT}`,
      `recipients:${CLEAN_RECIPIENT}`,
      `recipients:${FLAGGED}`,
      `protocols:${CLEAN_CONTRACT}`,
      `assetCaps:${FLAGGED}`,
    ],
  );
});

test("an empty override satisfies neither gate", () => {
  assert.equal(overrideSatisfied(CLOSED_OVERRIDE), false);
  assert.equal(overrideSatisfied({ acknowledged: true, phrase: "" }), false);
  assert.equal(overrideSatisfied({ acknowledged: false, phrase: OVERRIDE_PHRASE }), false);
});

test("the override needs both gates, not either one", () => {
  assert.equal(overrideSatisfied({ acknowledged: true, phrase: OVERRIDE_PHRASE }), true);
  assert.equal(overrideSatisfied({ acknowledged: true, phrase: "proceed" }), true);
  assert.equal(overrideSatisfied({ acknowledged: true, phrase: " proceed " }), true);
  // A checkbox alone is the click this modal exists to interrupt.
  assert.equal(overrideSatisfied({ acknowledged: true, phrase: "yes" }), false);
  // A typed phrase alone is not consent either.
  assert.equal(overrideSatisfied({ acknowledged: false, phrase: "PROCEED" }), false);
});

test("the confirmation key tracks the addresses, so editing re-arms the gate", () => {
  const approved = draft({ recipients: FLAGGED });
  const edited = draft({ recipients: `${FLAGGED}\n${CLEAN_RECIPIENT}` });
  const cleared = draft({ recipients: FLAGGED, perTxCap: "2000" });

  assert.equal(screenKey(approved), screenKey(cleared), "a cap edit is not an address edit");
  assert.notEqual(
    screenKey(approved),
    screenKey(edited),
    "appending an address must invalidate an earlier override",
  );
});

test("the screen key treats a muxed alias as the account it encodes", () => {
  // Otherwise the operator could swap a flagged account for its own `M…` form,
  // change nothing that matters, and walk past a confirmation meant for it.
  const underlying = StrKey.decodeEd25519PublicKey(FLAGGED);
  const muxed = StrKey.encodeMed25519PublicKey(
    new Uint8Array([...underlying, ...Uint8Array.from([0, 0, 0, 0, 0, 0, 4, 210])]),
  );
  assert.equal(screenKey(draft({ recipients: FLAGGED })), screenKey(draft({ recipients: muxed })));
});

test("every finding carries the evidence the modal shows the operator", () => {
  const [finding] = screenDraft(draft({ recipients: FLAGGED })).findings;
  assert.ok(finding);
  assert.ok(finding.entry.source.startsWith("https://"));
  assert.ok(finding.entry.reason.length > 0);
  assert.ok(fieldLabel(finding.field).length > 0);
});
