# Pre-Signature Authorization Summary

Before this console asks a wallet to sign, it shows the four facts that the signature actually covers:
the contract **operation**, the **guard** it is called on, the **network**, and the **admin account**
that signs. The block is [`components/AuthorizationSummary.tsx`](../../components/AuthorizationSummary.tsx),
and its values come from [`lib/guard/authorizationSummary.ts`](../../lib/guard/authorizationSummary.ts).

The wallet's own popup is not the place to discover any of this: each provider shows a different amount
of detail, and none of them is something this dashboard controls.

## Where it appears

| Surface | Displayed | Carried into the write |
| ------- | --------- | ---------------------- |
| [Policy install](policy-configurator.md) — the diff dialog | Yes, beneath the diff | The copy the operator saw |
| [Emergency freeze](panic-freeze.md) — the confirm dialog | Yes, above the acknowledgement | The copy the operator saw |
| [Deploy / initialize](deploy-panel.md) | Yes, under the init checklist | The copy the operator saw |
| Policy revoke, unfreeze, the migration wizard, the headless scripts | Not yet on screen | Derived from the transaction the write builds |

Those last paths are not unguarded. `InvokeRequest.authorization` is required, and
[`lib/guard/guardOps.ts`](../../lib/guard/guardOps.ts) fills it by reading the same envelope the write
builds, so a caller that never shows a summary still gets the same check against the same transaction.
Passing an explicit `null` is a statement that there is nothing to confirm, and the write is refused.

The gate covers the admin contract calls, which is what an operator is asked to approve here. Deploying
or uploading wasm goes through the separate `submitOperation` path — operations the source account
authorizes itself, prepared by the RPC rather than assembled from a confirmed summary — so it has no
four-field summary to show and is deliberately outside this check.

## Derived, not recited

The summary is read back out of the built transaction — the operation body, the invoked contract
address, the passphrase the envelope was built for, and the envelope's own source account — by
`contextFromTransaction`. A panel that printed its own props would reassure without constraining, and
would report the account the caller *named* rather than the one the envelope carries. `Address.fromScAddress`
is used for the contract, and an envelope that does not describe exactly one contract call — no
operation, two operations, a non-Soroban operation, a wasm upload rather than a call — yields no summary
at all.

Panels call `previewAuthorizationSummary` from [`lib/guard/submit.ts`](../../lib/guard/submit.ts), which
builds a transaction the same way the write pipeline does and reads it back with the same function, so
the on-screen copy and the copy the pipeline checks are the same reading. Sequence number and arguments
are deliberately not part of the four facts, which is why a preview built without either still matches
the real call.

## Invalidation

Two mechanisms, because "the summary is still true" and "the operator approved this one" are different
claims:

- **The pipeline re-derives.** `checkPresignAuthorization` compares the confirmed context with the one
  read out of the probe transaction before the first simulation. A field that moved (`stale`), a blank
  field or a missing confirmation (`missing`) returns a refusal at stage `discovery` — nothing is
  simulated, nothing is signed, nothing is broadcast, and the message names which of the four facts no
  longer holds.
- **The acknowledgement is bound to the summary.** The freeze dialog stores *which* summary it was
  ticked for (`authorizationId`) rather than a boolean, so a guard switch, a wallet switch or an
  operation change while the dialog is open invalidates the tick and disables the button again. A
  summary this console cannot produce — no connected admin, no guard instance yet — disables the
  confirm action instead of offering a prompt the operator cannot evaluate.

Addresses in the block go through the console's `AddressText`, so the address book and the privacy mask
apply here as they do everywhere else, and the network is shown as a name *and* the passphrase, since
the passphrase is what binds a signature to a network.

## Tests

[`tests/unit/authorizationSummary.test.ts`](../../tests/unit/authorizationSummary.test.ts) asserts the
derivation against encoded transactions, the stale/missing refusal sentences, and — with a signer that
throws the moment it is asked for anything and a server that counts simulations — that a missing or
stale authorization reaches neither the RPC nor the wallet, while a matching one goes through.
See [SPEC.md §5, Write path](../../SPEC.md) for where the check sits in the sequence.
