"use client";

import { AddressText } from "./bits.tsx";
import { NETWORK } from "../lib/guard/network.ts";
import { networkDisplayName } from "../lib/guard/networkSwitch.ts";
import {
  AUTHORIZATION_FIELDS,
  type AuthorizationContext,
  authorizationFieldLabel,
} from "../lib/guard/authorizationSummary.ts";

/**
 * The four facts a wallet signature covers, printed before the prompt.
 *
 * This is the surface issue #343 asks for: an operator who is about to be asked
 * to sign a policy, a freeze, or an initialization should be able to see which
 * function, which guard, which network and which account the signature will
 * authorize, in the console's own words, rather than discovering any of it inside
 * the wallet's popup — which shows a different amount of detail per provider and
 * is not something this dashboard controls.
 *
 * It renders what it is handed and nothing else. The values come from
 * `previewAuthorizationSummary`, i.e. from reading the encoded transaction back,
 * so this block cannot flatter the write it introduces: if the console is about to
 * build a different transaction than the one it described, the pipeline notices
 * and refuses before the popup, which is the half of the guarantee a component
 * cannot provide for itself.
 */
export function AuthorizationSummaryBlock({
  authorization,
  purpose,
}: {
  authorization: AuthorizationContext | null;
  /** Where this summary came from, in the operator's terms — e.g. `the freeze you are confirming`. */
  purpose?: string;
}) {
  return (
    <div className="auth-summary" data-testid="authorization-summary">
      <p className="tiny muted" style={{ marginBottom: 6 }}>
        What your wallet is being asked to authorize
        {purpose ? ` for ${purpose}` : ""} — check these four before you sign.
      </p>
      {authorization === null ? (
        <p className="notice warn" data-testid="authorization-summary-missing" role="alert">
          There is nothing to show: this console cannot name the operation, the guard, the network
          and the admin account that would sign, so it will not ask your wallet to sign. Connect the
          admin wallet and point the console at a guard instance, then confirm the summary it
          displays.
        </p>
      ) : (
        <dl
          className="auth-summary-fields"
          style={{ display: "grid", gap: 4, margin: 0, fontSize: "0.85rem" }}
        >
          {AUTHORIZATION_FIELDS.map((row) => (
            <div
              key={row.field}
              className="row"
              data-testid={`authorization-${row.field}`}
              style={{ gap: 8, alignItems: "baseline" }}
            >
              <dt className="tiny muted" style={{ minWidth: 168 }}>
                {authorizationFieldLabel(row.field)}
              </dt>
              <dd className="mono" style={{ margin: 0, overflowWrap: "anywhere" }}>
                <AuthorizationValue field={row.field} value={authorization[row.field]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * One field, in the form an operator reads it.
 *
 * The two addresses go through `AddressText`, so an address book nickname and the
 * privacy mask apply here exactly as they do everywhere else in the console — a
 * pre-signature summary that ignored the mask would be the one place an operator
 * on a shared screen could not use this panel. The function name is printed with
 * its parentheses because that is how the contract's own errors name it, and the
 * network is given both as a name and as the passphrase, since the passphrase is
 * the thing that actually binds the signature to a network.
 */
function AuthorizationValue({
  field,
  value,
}: {
  field: keyof AuthorizationContext;
  value: string;
}) {
  if (field === "operation") return <code>{value}()</code>;
  if (field === "networkPassphrase") {
    return (
      <>
        {networkDisplayName({
          passphrase: value,
          name: value === NETWORK.passphrase ? NETWORK.name : null,
        })}{" "}
        <span className="tiny muted">({value})</span>
      </>
    );
  }
  return <AddressText address={value} />;
}
