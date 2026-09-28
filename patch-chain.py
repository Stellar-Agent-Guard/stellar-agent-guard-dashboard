with open('lib/guard/chain.ts', 'r') as f:
    code = f.read()

import_line = 'import { getCachedHash, setCachedHash } from "./bytecodeCache.ts";\n'
if import_line not in code:
    code = import_line + code

old = """export async function verifyWasmIdentity(
  server: rpc.Server,
  contractId: string,
): Promise<WasmIdentity> {
  const instance = (await server.getContractInstance(contractId)) as unknown as {
    executable?: { wasmHash?: unknown };
  };
  const reportedWasmHash = hashToHex(instance.executable?.wasmHash);
  const wasm = await server.getContractWasmByContractId(contractId);
  const bytes = toBytes(wasm);
  const fetchedSha256 = await sha256Hex(bytes);
  return {
    reportedWasmHash,
    fetchedSha256,
    bytes: bytes.length,
    match: reportedWasmHash === fetchedSha256,
  };
}"""

new = """export async function verifyWasmIdentity(
  server: rpc.Server,
  contractId: string,
): Promise<WasmIdentity> {
  const instance = (await server.getContractInstance(contractId)) as unknown as {
    executable?: { wasmHash?: unknown };
  };
  const reportedWasmHash = hashToHex(instance.executable?.wasmHash);
  
  const networkKey = (server as any).serverURL?.includes('testnet') ? 'testnet' : 'public';
  
  let fetchedSha256 = getCachedHash(networkKey, contractId);
  let length = 0;
  if (!fetchedSha256) {
    const wasm = await server.getContractWasmByContractId(contractId);
    const bytes = toBytes(wasm);
    fetchedSha256 = await sha256Hex(bytes);
    length = bytes.length;
    setCachedHash(networkKey, contractId, fetchedSha256);
  }
  
  return {
    reportedWasmHash,
    fetchedSha256,
    bytes: length,
    match: reportedWasmHash === fetchedSha256,
  };
}"""

code = code.replace(old, new)

with open('lib/guard/chain.ts', 'w') as f:
    f.write(code)
