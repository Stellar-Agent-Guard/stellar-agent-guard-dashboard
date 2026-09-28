export function parseAddressList(csv: string) {
  const lines = csv.split('\n');
  const valid = [];
  const duplicates = new Set();
  for (const line of lines) {
    const addr = line.trim();
    if (!addr) continue;
    if (addr.startsWith('G') && addr.length === 56) {
      if (!duplicates.has(addr)) {
        duplicates.add(addr);
        valid.push(addr);
      }
    }
  }
  return valid;
}
export function exportRFC4180(addresses: string[]) {
  return addresses.map(a => `"${a}"`).join('\r\n');
}
