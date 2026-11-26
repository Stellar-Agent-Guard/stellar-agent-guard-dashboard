/**
 * The authorization a write is about to ask for, read back out of the transaction.
 *
 * A wallet prompt is the last thing standing between this console and an
 * irreversible write, and an operator can only approve what they can see — so the
 * console states, in its own words and before the prompt, which account signs,
 * which guard it calls, which function, and on which network (issue #343). That
 * statement is part of the write rather than caption text: the pipeline re-derives
 * the same four facts from the transaction it is actually about to simulate and
 * refuses, with no prompt raised, when they disagree or when one was never filled
 * in.
 *
 * Why *derived* rather than assembled from the caller's own fields is the whole
 * design. A panel that printed the guard address straight out of its props would
 * keep printing the old one the moment the operator switched instances, and the
 * signature would still cover the new one. Deriving from the encoded transaction
 * and comparing at the last moment before signing makes the displayed summary and
 * the signed envelope two readings of a single object, which is the only way
 * "the summary is stale" becomes a refusal instead of a lie.
 *
 * The network is the one field a transaction does not carry: a passphrase never
 * appears in the envelope, it only decides what a signature means. It is therefore
 * taken from the passphrase the envelope was built for — the same value the wallet
 * check in `components/GuardProvider.tsx` compares the connected wallet against.
 */

import { Address, type Transaction, xdr } from "@stellar/stellar-sdk";

/**
 * What the operator is being asked to authorize, in the four facts that identify
 * it. Every field is a plain string so the summary can be compared, printed and
 * pinned in a test without a parser.
 */
export interface AuthorizationContext {
  /** The contract function the operation calls, e.g. `set_policy`. */
  operation: string;
  /** The contract the operation calls — the guard instance, for every write this console offers. */
  guard: string;
  /** The network the envelope was built for, verbatim. */
  networkPassphrase: string;
  /** The account that must sign: the transaction's own source, which is the connected admin. */
  admin: string;
}

export type AuthorizationField = keyof AuthorizationContext;

/**
 * The four facts in the order an operator reads them, with the label the panel
 * prints. One list, so a rendered row, a missing field and a refusal sentence can
 * never disagree about what the summary is made of.
 */
export const AUTHORIZATION_FIELDS: readonly { field: AuthorizationField; label: string }[] = [
  { field: "operation", label: "Operation" },
  { field: "guard", label: "Guard contract" },
  { field: "networkPassphrase", label: "Network" },
  { field: "admin", label: "Admin account that signs" },
];

/** One row of the summary as the panel shows it. */
export interface AuthorizationLine {
  field: AuthorizationField;
  label: string;
  value: string;
}

/**
 * The summary a panel renders and the operator acknowledges.
 *
 * `id` is what the acknowledgement is tied to: a panel that stores "the operator
 * acknowledged `<id>`" disables the sign button again by itself when any field
 * moves, because a different context is a different id. That is how staleness is
 * invalidated in the UI without an effect watching for it.
 */
export interface AuthorizationSummary {
  context: AuthorizationContext;
  id: string;
  lines: readonly AuthorizationLine[];
}

/**
 * A stable, readable identity for one authorization context.
 *
 * Deliberately not a digest: `sha256Hex` in this project is async Web Crypto, and
 * a pre-signature gate whose id has to be awaited is a gate that can be skipped
 * while the promise is in flight. The full field values are joined in a fixed
 * order, so two contexts match if and only if all four facts do.
 */
export function authorizationId(context: AuthorizationContext): string {
  return [
    "authorization",
    context.operation,
    context.guard,
    context.networkPassphrase,
    context.admin,
  ].join("|");
}

/** The fields of a context that carry no value, in display order. */
export function missingAuthorizationFields(
  context: AuthorizationContext | null | undefined,
): AuthorizationField[] {
  if (!context) return AUTHORIZATION_FIELDS.map((row) => row.field);
  return AUTHORIZATION_FIELDS.filter((row) => context[row.field].trim() === "").map(
    (row) => row.field,
  );
}

/** The label a refusal uses for one field. */
export function authorizationFieldLabel(field: AuthorizationField): string {
  const row = AUTHORIZATION_FIELDS.find((candidate) => candidate.field === field);
  return row ? row.label : field;
}

/**
 * The summary for a context the caller has already settled on.
 *
 * The lines are built here rather than in the panel so a panel cannot print three
 * of the four facts and call that a summary.
 */
export function summarizeAuthorizationContext(context: AuthorizationContext): AuthorizationSummary {
  return {
    context,
    id: authorizationId(context),
    lines: AUTHORIZATION_FIELDS.map((row) => ({
      field: row.field,
      label: row.label,
      value: context[row.field],
    })),
  };
}

/**
 * An address short enough to quote in a sentence, long enough to recognise.
 *
 * A refusal names what changed; pasting two full 56-character addresses into one
 * line buries the difference. The summary itself still prints the whole address —
 * this is only for prose.
 */
export function abbreviateAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
}

/**
 * Read the authorization back out of a built transaction.
 *
 * The envelope is re-decoded rather than taken from the caller's arguments
 * because that is the only copy that says what will actually be signed: the
 * contract address and function name come from the encoded operation, and the
 * admin comes from the encoded source account. A transaction that is not exactly
 * one contract call has no such summary — an upload or a create-contract has no
 * function to name, and a multi-operation envelope would need a summary per
 * operation, which this console does not build. `null` is therefore a real
 * answer, and the pipeline treats it as a refusal rather than an empty display.
 *
 * The shape checks below mirror `decodeInvocation` in the test RPC server, which
 * is the proof that they are the shape this SDK version emits.
 */
export function contextFromTransaction(
  transaction: Transaction,
  passphrase: string,
): AuthorizationContext | null {
  if (transaction.operations.length !== 1) return null;
  const envelope = xdr.TransactionEnvelope.fromXDR(transaction.toXDR(), "base64");
  if (envelope.type !== "envelopeTypeTx") return null;
  const body = envelope.v1.tx.operations[0]?.body;
  if (!body || body.type !== "invokeHostFunction") return null;
  const hostFunction = body.invokeHostFunctionOp.hostFunction;
  if (hostFunction.type !== "hostFunctionTypeInvokeContract") return null;
  const call = hostFunction.invokeContract;
  return {
    operation: String(call.functionName),
    guard: Address.fromScAddress(call.contractAddress).toString(),
    networkPassphrase: passphrase,
    admin: String(transaction.source),
  };
}

/** The fields whose value the operator confirmed differs from the transaction's. */
export function changedAuthorizationFields(
  confirmed: AuthorizationContext,
  derived: AuthorizationContext,
): AuthorizationField[] {
  return AUTHORIZATION_FIELDS.filter(
    (row) => confirmed[row.field].trim() !== derived[row.field].trim(),
  ).map((row) => row.field);
}

/**
 * The check, and the sentence that goes with its failure.
 *
 * `missing` and `stale` are separate reasons because the operator's next step is
 * different: one means nothing was shown to confirm, the other means what was
 * shown is no longer true. Both come back before a prompt, and both say plainly
 * that nothing was simulated, signed or broadcast — the same discipline as every
 * other refusal on this path.
 */
export type AuthorizationCheck =
  | { ok: true; summary: AuthorizationSummary }
  | {
      ok: false;
      reason: "missing" | "stale";
      detail: string;
      missing: readonly AuthorizationField[];
      changed: readonly AuthorizationField[];
    };

/** How the pipeline describes one field that moved, in the words it refuses with. */
function describeFieldChange(
  field: AuthorizationField,
  confirmed: AuthorizationContext,
  derived: AuthorizationContext,
): string {
  const label = authorizationFieldLabel(field);
  const was = confirmed[field].trim();
  const now = derived[field].trim();
  // Addresses are quoted short; a function name or a passphrase is quoted whole,
  // because those are what the operator is actually comparing.
  const value = (raw: string): string =>
    field === "guard" || field === "admin" ? abbreviateAddress(raw) : raw;
  return `${label}: confirmed "${value(was)}", the transaction says "${value(now)}"`;
}

/**
 * The refusal for a write whose authorization was never established.
 *
 * "Connect the admin account" is in the sentence because that is the common case:
 * the admin field is empty when no wallet is connected, and the operator needs
 * the next step, not just the denial.
 */
function refusedMissing(missing: readonly AuthorizationField[]): AuthorizationCheck {
  const labels = missing.map((field) => authorizationFieldLabel(field).toLowerCase());
  return {
    ok: false,
    reason: "missing",
    detail:
      `the authorization was never confirmed for this write (${labels.join(", ")} ` +
      `${missing.length === 1 ? "is" : "are"} not filled in), so no signature was requested. ` +
      "Connect the admin account that holds this guard, review the summary the panel shows, and " +
      "confirm it. Nothing was simulated, signed or broadcast.",
    missing,
    changed: [],
  };
}

/**
 * Compare what the operator confirmed against what the transaction will do.
 *
 * `derived` is always the transaction's own answer and wins every disagreement:
 * the summary handed back on success is built from it, never from the confirmed
 * copy. A confirmed context with an empty field is `missing` rather than `stale`
 * even when the derived value is also empty — an unfilled admin address means no
 * wallet is connected, and "connect the account first" is the instruction.
 */
export function checkPresignAuthorization(params: {
  derived: AuthorizationContext | null;
  confirmed: AuthorizationContext | null | undefined;
}): AuthorizationCheck {
  const { derived, confirmed } = params;

  if (derived === null) {
    return {
      ok: false,
      reason: "missing",
      detail:
        "this console could not read a single contract call out of the transaction it was about " +
        "to simulate, so it will not ask your wallet to sign it — a write you cannot describe is " +
        "a write you cannot approve. Nothing was simulated, signed or broadcast.",
      missing: missingAuthorizationFields(null),
      changed: [],
    };
  }

  // A caller that presents no context at all and one whose fields are still blank
  // are the same failure to the operator: nothing was shown to confirm.
  if (confirmed === null || confirmed === undefined) {
    return refusedMissing(missingAuthorizationFields(null));
  }
  const blank = missingAuthorizationFields(confirmed);
  if (blank.length > 0) return refusedMissing(blank);

  const changed = changedAuthorizationFields(confirmed, derived);
  if (changed.length > 0) {
    return {
      ok: false,
      reason: "stale",
      detail:
        `the confirmed authorization no longer matches the transaction about to be signed ` +
        `(${changed.map((field) => describeFieldChange(field, confirmed, derived)).join("; ")}), ` +
        "so no signature was requested. Nothing was simulated, signed or broadcast. Review the " +
        "summary again and confirm the current one.",
      missing: [],
      changed,
    };
  }

  return { ok: true, summary: summarizeAuthorizationContext(derived) };
}
