import test from "node:test";
import assert from "node:assert/strict";
import { getCachedHash, setCachedHash, invalidateCachedHash } from "../../lib/guard/bytecodeCache.ts";

test("bytecodeCache works", () => {
  assert.equal(getCachedHash("testnet", "C123"), null);
  setCachedHash("testnet", "C123", "hash1");
  assert.equal(getCachedHash("testnet", "C123"), "hash1");
  invalidateCachedHash("testnet", "C123");
  assert.equal(getCachedHash("testnet", "C123"), null);
});
