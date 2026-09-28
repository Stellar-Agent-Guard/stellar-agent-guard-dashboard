export interface CacheEntry {
  hash: string;
  expiresAt: number;
}

const STORAGE_KEY = 'stellar_bytecode_hash_cache';
const MAX_ENTRIES = 50;
const TTL_MS = 60 * 60 * 1000;

const memoryStore: Record<string, CacheEntry> = {};

function getStore(): Record<string, CacheEntry> {
  if (typeof sessionStorage === 'undefined') return memoryStore;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setStore(store: Record<string, CacheEntry>) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

export function getCachedHash(networkPassphrase: string, contractId: string): string | null {
  const store = getStore();
  const key = `${networkPassphrase}:${contractId}`;
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete store[key];
    setStore(store);
    return null;
  }
  
  delete store[key];
  store[key] = entry;
  setStore(store);
  
  return entry.hash;
}

export function setCachedHash(networkPassphrase: string, contractId: string, hash: string): void {
  const store = getStore();
  const key = `${networkPassphrase}:${contractId}`;
  
  const keys = Object.keys(store);
  if (keys.length >= MAX_ENTRIES && !store[key]) {
    delete store[keys[0] as string];
  }
  
  if (store[key]) {
    delete store[key];
  }
  
  store[key] = {
    hash,
    expiresAt: Date.now() + TTL_MS
  };
  
  setStore(store);
}

export function invalidateCachedHash(networkPassphrase: string, contractId: string): void {
  const store = getStore();
  const key = `${networkPassphrase}:${contractId}`;
  if (store[key]) {
    delete store[key];
    setStore(store);
  }
}
