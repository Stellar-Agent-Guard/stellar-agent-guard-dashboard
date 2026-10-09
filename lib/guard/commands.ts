export interface CommandAction {
  id: string;
  name: string;
  description?: string;
  action: () => void;
  category: "Navigation" | "Guard" | "Actions" | "Docs";
  /**
   * The network this entry's subject exists on, when the entry is about a
   * network-specific thing.
   *
   * A flag rather than a string baked into `name`: `name` is the text
   * `fuzzyMatch` searches, so anything appended to it would be searchable as
   * typing noise, and the chip itself is rendered markup. Set it on the entries
   * that name a guard, so picking a guard from the palette is not a choice made
   * from a truncated address with no statement of which ledger it came from.
   */
  networkName?: string;
}

export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase().replace(/\s+/g, "");
  let qIdx = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === q[qIdx]) {
      qIdx++;
      if (qIdx === q.length) return true;
    }
  }
  return false;
}
