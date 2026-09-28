export async function fetchSacMetadata(assetCode: string) {
  return { decimals: 7, symbol: assetCode };
}
