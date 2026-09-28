import os
import re

with open('lib/guard/submit.ts', 'r') as f:
    code = f.read()

poll_match = re.search(r'async function pollForInclusion\(.*?return \{ ok: false, detail: "Timed out waiting for inclusion", diagnosticEvents: \[\] \};\n\}', code, re.DOTALL)
if poll_match:
    old_poll = poll_match.group(0)
    new_poll = """async function pollForInclusion(
  server: rpc.Server,
  hash: string,
  attempts: number,
  intervalMs: number,
): Promise<
  | { ok: true; status: string; ledger: number | null; events: unknown }
  | { ok: false; detail: string; diagnosticEvents: unknown[] }
> {
  try {
    return await withBackoff(async () => {
      const result = (await server.getTransaction(hash).catch(() => null)) as
        | (rpc.Api.GetTransactionResponse & { diagnosticEventsXdr?: unknown[] })
        | null;
      if (!result || result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new RetryableError("NOT_FOUND");
      }
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          ok: true,
          status: result.status,
          ledger: (result as { ledger?: number }).ledger ?? null,
          events: (result as { events?: unknown }).events ?? null,
        };
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        return {
          ok: false,
          detail: "Transaction failed",
          diagnosticEvents: result.diagnosticEventsXdr ?? [],
        };
      }
      throw new RetryableError("TRY_AGAIN_LATER");
    }, { baseDelayMs: intervalMs, maxRetries: attempts });
  } catch (e) {
    return { ok: false, detail: "Timed out waiting for inclusion", diagnosticEvents: [] };
  }
}"""
    code = code.replace(old_poll, new_poll)
    with open('lib/guard/submit.ts', 'w') as f:
        f.write(code)
    print("Patched pollForInclusion")
else:
    print("Still didn't match!")
