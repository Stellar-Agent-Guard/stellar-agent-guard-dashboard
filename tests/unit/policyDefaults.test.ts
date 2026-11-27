import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_DRAFT,
  POLICY_DEFAULT_NOTES,
  buildPolicyConfig,
  type PolicyDraft,
} from "../../lib/guard/policyForm.ts";

function noteFor(field: keyof PolicyDraft): string {
  const note = POLICY_DEFAULT_NOTES.find((candidate) => candidate.field === field);
  assert.ok(note, `expected a default note for ${field}`);
  return note!.meaning;
}

test("default notes cover every draft field and name a contract source", () => {
  assert.equal(POLICY_DEFAULT_NOTES.length, Object.keys(EMPTY_DRAFT).length);
  for (const note of POLICY_DEFAULT_NOTES) {
    assert.ok(note.meaning.length > 0, `${note.field} has no meaning`);
    assert.ok(note.sourceLabel.length > 0, `${note.field} has no source label`);
    assert.match(note.sourceUrl, /^https:\/\/github\.com\/Stellar-Agent-Guard\//);
  }
});

test("blank caps encode the disabled zero values described by their notes", () => {
  const draft: PolicyDraft = { ...EMPTY_DRAFT, allowAnyRecipient: true, windowSecs: "" };
  const built = buildPolicyConfig(draft);
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.match(noteFor("perTxCap"), /per_tx_cap = 0/);
  assert.match(noteFor("windowCap"), /window_cap = 0/);
  assert.match(noteFor("windowSecs"), /86400/);
  assert.match(noteFor("windowSecs"), /Blank encodes 0/);
  assert.match(noteFor("dmsGraceSecs"), /dms_grace_secs = 0/);
  assert.match(noteFor("activeFrom"), /active_from = 0/);
  assert.match(noteFor("activeUntil"), /active_until = 0/);

  assert.equal(built.config.per_tx_cap, 0n);
  assert.equal(built.config.window_cap, 0n);
  assert.equal(built.config.window_secs, 0n);
  assert.equal(built.config.dms_grace_secs, 0n);
  assert.equal(built.config.active_from, 0n);
  assert.equal(built.config.active_until, 0n);
  assert.equal(EMPTY_DRAFT.windowSecs, "86400");
});

test("empty allowlists encode inert contract lists described by their notes", () => {
  const built = buildPolicyConfig({ ...EMPTY_DRAFT, allowAnyRecipient: true });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.match(noteFor("assets"), /SAC transfers as unknown and blocks them/);
  assert.match(noteFor("recipients"), /allowlist is skipped/);
  assert.match(noteFor("protocols"), /blocks non-asset external calls/);
  assert.deepEqual(built.config.assets, []);
  assert.deepEqual(built.config.recipients, []);
  assert.deepEqual(built.config.protocols, []);
});

test("the per-asset override note matches this build's encoded field set", () => {
  const built = buildPolicyConfig({ ...EMPTY_DRAFT, allowAnyRecipient: true });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.match(noteFor("assetCaps"), /does not encode asset_caps/);
  assert.match(noteFor("assetCaps"), /empty list/);
  assert.equal("asset_caps" in built.config, false);
});

test("toggle notes match the encoded booleans", () => {
  const anyRecipient = buildPolicyConfig({ ...EMPTY_DRAFT, allowAnyRecipient: true });
  assert.equal(anyRecipient.ok, true);
  if (anyRecipient.ok) {
    assert.match(noteFor("allowAnyRecipient"), /allow_any_recipient = true/);
    assert.equal(anyRecipient.config.allow_any_recipient, true);
  }

  const paused = buildPolicyConfig({ ...EMPTY_DRAFT, allowAnyRecipient: true, paused: true });
  assert.equal(paused.ok, true);
  if (paused.ok) {
    assert.match(noteFor("paused"), /paused = true/);
    assert.equal(paused.config.paused, true);
  }
});
