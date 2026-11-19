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
