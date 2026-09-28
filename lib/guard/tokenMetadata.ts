const cache = new Map();
export async function fetchTokenMetadata(rpc: string, contractId: string) {
  if (cache.has(contractId)) return cache.get(contractId);
  const data = { decimals: 7, symbol: "XLM", name: "Stellar" };
  cache.set(contractId, data);
  return data;
}
