export interface CommandAction {
  id: string;
  name: string;
  description?: string;
  action: () => void;
  category: "Navigation" | "Guard" | "Actions" | "Docs";
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
