import { runWasmWorker } from "./wasmParse.ts";

const HASH_SOURCE = `onmessage = async ({data}) => {
  try {
    const digest = await crypto.subtle.digest("SHA-256", data);
    postMessage([...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join(""));
  } catch (error) { throw error; }
};`;

/** Compute a SHA-256 hash off the UI thread; worker cleanup is guaranteed. */
export function computeWasmHash(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  return runWasmWorker<string>(HASH_SOURCE, bytes, signal);
}
