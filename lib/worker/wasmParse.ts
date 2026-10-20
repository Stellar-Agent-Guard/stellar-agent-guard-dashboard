import { MAX_WASM_INPUT_BYTES } from "../guard/wasmLimits.ts";

export const WASM_PARSE_LIMIT_BYTES = MAX_WASM_INPUT_BYTES;

/** Run a small browser worker and deterministically dispose it for every exit. */
export function runWasmWorker<T>(source: string, bytes: Uint8Array, signal?: AbortSignal): Promise<T> {
  if (bytes.byteLength > WASM_PARSE_LIMIT_BYTES) {
    return Promise.reject(new Error(`WASM input exceeds ${WASM_PARSE_LIMIT_BYTES} bytes`));
  }
  if (signal?.aborted) return Promise.reject(new DOMException("Operation cancelled", "AbortError"));
  if (typeof Worker === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.reject(new Error("Web Workers are unavailable in this browser"));
  }
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Operation cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<T>) => {
      cleanup();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "WASM worker failed"));
    };
    const copy = bytes.slice();
    try {
      worker.postMessage(copy.buffer, [copy.buffer]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

const PARSER_SOURCE = `onmessage = ({data}) => {
  const b = new Uint8Array(data);
  const ok = b.length >= 8 && b[0] === 0 && b[1] === 97 && b[2] === 115 && b[3] === 109;
  postMessage({ok, bytes: b.length, reason: ok ? null : "invalid or truncated WASM header"});
};`;

export function parallelWasmParse(bytes: Uint8Array, signal?: AbortSignal) {
  return runWasmWorker<{ ok: boolean; bytes: number; reason: string | null }>(PARSER_SOURCE, bytes, signal);
}
