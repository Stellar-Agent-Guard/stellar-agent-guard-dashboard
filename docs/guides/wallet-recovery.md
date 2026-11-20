# Wallet Extension Recovery

Wallet extensions update themselves. When that happens while this console is
open, the extension can revoke the page's permission, change the provider it
injects, or lock itself. The console keeps the wallet state it last saw until it
is told otherwise, so treat that state as a hint — never as a fact about the
chain.

The console links to this guidance from every wallet error. It is also rendered
under **Admin wallet → "Your wallet extension was updated, locked or reloaded"**
in the wallet panel.

## Safe reconnect

1. Finish or dismiss the wallet's own update/reload prompt, then unlock it.
2. **Reload this page.** A cached provider object from before the update is the
   usual reason a reconnect appears to do nothing.
3. Choose **Change wallet** (or **Connect admin wallet**) and approve access for
   this site again.
4. If the provider is not listed, confirm the extension is enabled for this
   origin, then pick another provider from the same picker. Choosing a provider
   the probe missed still attempts the connection.
5. **Start a fresh review.** An interrupted review is never resumed: no signed
   envelope is stored, and reconnecting cannot resubmit anything.

The console never asks for a seed phrase or a secret key. If any page does,
close it — recovery here is re-granting access, not re-importing a wallet.

## Verify before signing

A reconnect only proves the provider answers. Verification proves it answers as
the account and network you meant to operate:

- The header shows the account you expect, and the network chip agrees with this
  console's target network.
- A status refresh returns the same guard address. Reads need no permission, so
  they are the cheapest check that the guard you are looking at exists.
- Transaction history, or the chain itself, is the only authority on whether an
  earlier write landed. A reconnect never resubmits anything.

The write path enforces the same rule at every boundary: the live account **and**
the live network are re-read before a signature is requested, and a write that
cannot prove both is refused as a recoverable interruption.

## Wallet state is not chain state

- **Wallet state (local)** — connection, account and network as the extension
  last reported them. May be stale until re-read, and it never overrides a
  chain read.
- **Chain state (authoritative)** — policy, freeze status, rolling window,
  telemetry and transaction outcomes, read from Soroban RPC. Unaffected by an
  extension update; this is what the console reports as fact.

If the two disagree, the chain wins. A stale header is a reason to reconnect, not
a reason to re-send a write.
