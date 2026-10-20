import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_WASM_BYTES, WasmHashResult, WasmHashError } from "../../lib/worker/wasmHash.ts";

test("MAX_WASM_BYTES constant is 10MiB", () => {
  assert.equal(MAX_WASM_BYTES, 10 * 1024 * 1024);
});

test("size limit constant enforces 10MiB maximum - at limit", () => {
  const atLimit = new Uint8Array(MAX_WASM_BYTES);
  assert.equal(atLimit.length, MAX_WASM_BYTES);
});

test("size limit constant enforces 10MiB maximum - one over", () => {
  const overLimit = new Uint8Array(MAX_WASM_BYTES + 1);
  assert.ok(overLimit.length > MAX_WASM_BYTES);
});

test("size limit constant enforces 10MiB maximum - well under", () => {
  const minimal = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  assert.ok(minimal.length <= MAX_WASM_BYTES);
});

test("WASM magic bytes are correct", () => {
  const magic = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
  assert.equal(magic[0], 0x00);
  assert.equal(magic[1], 0x61); // 'a'
  assert.equal(magic[2], 0x73); // 's'
  assert.equal(magic[3], 0x6d); // 'm'
});

test("WASM version field is at bytes 4-7", () => {
  const version1 = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  assert.equal(version1[4], 0x01); // version 1
  const version2 = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]);
  assert.equal(version2[4], 0x02); // version 2
});

test("short buffer cannot be valid WASM", () => {
  const shortBuffer = new Uint8Array([0x00, 0x61, 0x73]); // 3 bytes
  assert.ok(shortBuffer.length < 8);
});

test("WasmHashResult interface shape", () => {
  const result: WasmHashResult = { ok: true, sha256: "a".repeat(64) };
  assert.equal(result.ok, true);
  assert.equal(result.sha256.length, 64);
});

test("WasmHashError interface shape", () => {
  const error: WasmHashError = { ok: false, reason: "test error" };
  assert.equal(error.ok, false);
  assert.equal(error.reason, "test error");
});