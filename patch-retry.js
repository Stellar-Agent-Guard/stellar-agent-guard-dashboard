const fs = require('fs');
let code = fs.readFileSync('lib/guard/submit.ts', 'utf8');

// Add import
code = 'import { withBackoff, RetryableError } from "./retry.ts";\n' + code;

// Wrap simulation
code = code.replace(
  'const enforced = await server.simulateTransaction(enforcing);',
  `const enforced = await withBackoff(
    async () => {
      const sim = await server.simulateTransaction(enforcing);
      if (sim.status === "ERROR" || (sim as any).error) {
        const errStr = typeof (sim as any).error === "string" ? (sim as any).error : JSON.stringify((sim as any).error);
        if (errStr && (errStr.includes("TRY_AGAIN_LATER") || errStr.includes("TIMEOUT"))) {
          throw new RetryableError(errStr);
        }
      }
      return sim;
    },
    { baseDelayMs: 500, maxRetries: 3 }
  );`
);

// Update pollForInclusion
const pollOld = `async function pollForInclusion(
  server: rpc.Server,
  hash: string,
  attempts: number,
  intervalMs: number,
): Promise<
  | { ok: true; status: string; ledger: number | null; events: unknown }
  | { ok: false; detail: string; diagnosticEvents: unknown[] }
> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const result = (await server.getTransaction(hash).catch(() => null)) as
      | (rpc.Api.GetTransactionResponse & { diagnosticEventsXdr?: unknown[] })
      | null;
    if (!result) continue;
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
  }
  return { ok: false, detail: "Timed out waiting for inclusion", diagnosticEvents: [] };
}`;

const pollNew = `async function pollForInclusion(
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
}`;

code = code.replace(pollOld, pollNew);
fs.writeFileSync('lib/guard/submit.ts', code);
