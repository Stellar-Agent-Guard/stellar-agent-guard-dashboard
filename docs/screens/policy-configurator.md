# Policy Configurator (`/configure`)

Interactive no-code form for configuring smart account guardrails:

- **Policy Presets**: One-click archetypes (Strict Micro-Agent, Standard DeFi Bot, High-Throughput Arbitrage), each badged Conservative, Balanced or Permissive. Selecting one asks to confirm before replacing the current draft; placeholder addresses must be replaced before installing.
- **Per-Transaction Spend Cap**: Limits maximum tokens moved in a single call.
- **Rolling Window Cap & Duration**: Enforces spending limits over a rolling time window (seconds).
- **Asset Allowlists**: Enforces accepted SAC tokens.
- **Recipient Allowlists**: Default-deny recipient address list.
- **Protocol & Function Allowlists**: Configures approved contract IDs and method names for arbitrary Soroban calls.
- **Active Execution Windows**: Restricts execution to specific ledger timestamp intervals.
- **Pause Switch**: Global pause switch for routine maintenance.
- **Dead-Man Grace Window**: Configures maximum allowable inactivity period in seconds.
- **Network Context & RPC Configuration**: Shows active network and sanitized RPC hostname with credential redaction. Features role separation between read-only RPC reads and wallet write destinations, an operator-controlled read-only endpoint probe, and explicit confirmation before write network changes.
- **Change Review**: Before the wallet is prompted, a diff modal lists every field that actually changes —
  fields identical to the installed policy are not shown, and an entirely identical policy says so instead
  of rendering an empty table. Each row states its status in words (`added`, `removed`, `changed`) as well
  as by a `+` / `−` / `~` marker and a coloured edge, so the meaning survives a screen reader, a
  monochrome display and `prefers-contrast: more`. A one-line summary counts the changes first. Those
  markers are painted from the shared `--ok` / `--danger` / `--warn` / `--muted` tokens in
  [`app/globals.css`](../../app/globals.css) rather than a local palette; `npm test` measures each of them
  against the modal surface and fails below the WCAG 2.1 AA floor of 4.5:1. Warnings (a lower window cap,
  a shortened dead-man grace) reuse the same notice tier as the default-deny banner.
- **Pre-Signature Authorization Summary**: The review dialog pairs the diff with the operation, guard
  address, network and admin account the signature will cover, derived from the transaction about to be
  simulated ([authorization-summary.md](authorization-summary.md)). An install with no summary to show
  is never offered as a signing prompt.
- **Side-by-Side Policy Profile Comparison**: Inspect and compare two policy profiles side-by-side without applying either and without RPC writes:
  - **Profile Parity**: Select and compare between presets (e.g., Strict Micro-Agent vs Standard DeFi Bot), the current editor draft, or the live installed on-chain policy.
  - **Field Differences**: Highlights changed, added, removed, and unchanged fields with visual markers and status badges, with an optional filter to show differences only.
  - **Network Mismatch Detection**: Automatically detects when comparing profiles configured for different networks (e.g. Testnet vs Mainnet) and displays a prominent warning to prevent cross-network contract address contamination.
  - **Strictly Non-Custodial & Read-Only**: Performs zero state mutations, zero transaction signing, and zero RPC calls.
- **Read-Only Printable Review**: A dedicated inspection view accessible via "Review & Print" allowing auditors and team members to review a proposed policy draft prior to signing:
  - **Draft Stamp**: Prominently watermarked and badged as `DRAFT - NOT SUBMITTED` to distinguish proposed configurations from active on-chain policies.
  - **Context & Validation**: Explicitly renders target network, guard contract address, and real-time pre-flight validation status (including failing rules).
  - **Non-Custodial & Privacy**: Completely read-only with all interactive inputs and buttons omitted; wallet addresses, signer keys, and session data are omitted.
  - **Print & PDF Export**: Formatted with print media queries (`@media print`) for clean paper printing and compliance archiving.

## Reviewing changes before signing

Installing a policy opens the **Policy changes** review before the wallet is
prompted. It lists only the fields that change, each with its installed value
(**Before (installed)**) and the draft value (**After (this draft)**), plus any
warnings such as a lowered cap. **Confirm and sign** prompts the wallet;
**Cancel**, <kbd>Escape</kbd>, or a click outside the dialog closes it without
signing, and focus returns to the control that opened the review.

On screens narrower than 720px the side-by-side table linearizes: each changed
field becomes one card read top to bottom as _Field_ → _Before (installed)_ →
_After (this draft)_, with those labels printed in front of every value, and
the Confirm and Cancel buttons stack full-width below the cards in the same
order as on desktop. Nothing is visually reordered, so reading order,
screen-reader order and keyboard order match the wide layout. See the
[keyboard & screen-reader guide](../guides/keyboard-and-screen-reader.md#dialogs)
for the shared dialog keys.
