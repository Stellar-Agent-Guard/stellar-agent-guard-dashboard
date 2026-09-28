import re

with open('lib/guard/submit.ts', 'r') as f:
    code = f.read()

# Just replace everything from `async function pollForInclusion(` up to the matching `}`
# Since it's at the top level (or inside a file), we can match until `\n}\n`
match = re.search(r'async function pollForInclusion\(.*?return \{ ok: false, detail: `transaction timed out after .*?\};.*?^\}', code, re.DOTALL | re.MULTILINE)

# Alternatively, I can just use a simpler script to find the index
start_idx = code.find('async function pollForInclusion(')
if start_idx != -1:
    end_idx = code.find('}\n\n/**\n * Run a wallet-authorized', start_idx)
    if end_idx != -1:
        end_idx += 1
        old_poll = code[start_idx:end_idx]
        print("Found it!")
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
        const diagnostics = result.diagnosticEventsXdr ?? [];
        return {
          ok: false,
          detail: `transaction ${hash} was included and rejected by the network`,
          diagnosticEvents: diagnostics,
        };
      }
      throw new RetryableError("TRY_AGAIN_LATER");
    }, { baseDelayMs: intervalMs, maxRetries: attempts });
  } catch (e) {
    return { ok: false, detail: `transaction timed out after ${attempts} attempts`, diagnosticEvents: [] };
  }
}"""
        code = code.replace(old_poll, new_poll)
        with open('lib/guard/submit.ts', 'w') as f:
            f.write(code)

