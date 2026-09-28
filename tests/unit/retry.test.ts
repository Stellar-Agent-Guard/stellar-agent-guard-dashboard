import test from "node:test";
import assert from "node:assert/strict";
import { withBackoff, RetryableError } from "../../lib/guard/retry.ts";

test("withBackoff succeeds on first try", async () => {
  const result = await withBackoff(async () => "ok");
  assert.equal(result, "ok");
});

test("withBackoff retries on RetryableError and succeeds", async () => {
  let calls = 0;
  const result = await withBackoff(
    async () => {
      calls++;
      if (calls < 3) throw new RetryableError("NOT_FOUND");
      return "ok";
    },
    { baseDelayMs: 10, maxRetries: 3 }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withBackoff throws non-retryable immediately", async () => {
  let calls = 0;
  await assert.rejects(
    withBackoff(
      async () => {
        calls++;
        throw new Error("HostError");
      },
      { baseDelayMs: 10, maxRetries: 3 }
    ),
    /HostError/
  );
  assert.equal(calls, 1);
});
