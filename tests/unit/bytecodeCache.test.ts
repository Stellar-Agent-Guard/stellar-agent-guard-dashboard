import { BytecodeCache } from '../../lib/cache/bytecodeCache';

describe('BytecodeCache', () => {
  let cache: BytecodeCache;

  beforeEach(() => {
    cache = new BytecodeCache();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('evicts LRU correctly when exceeding 50 entries', () => {
    for (let i = 0; i < 55; i++) {
      cache.set(`key${i}`, new Uint8Array([i]));
    }
    // Max entries is 50, so key0 to key4 should be evicted
    expect(cache.get('key0')).toBeNull();
    expect(cache.get('key4')).toBeNull();
    expect(cache.get('key5')).not.toBeNull();
    expect(cache.get('key54')).not.toBeNull();
  });

  it('expires items correctly after TTL', () => {
    cache.set('expireKey', new Uint8Array([1]));
    expect(cache.get('expireKey')).not.toBeNull();
    
    // Advance time by 2 hours
    jest.advanceTimersByTime(2 * 60 * 60 * 1000);
    
    expect(cache.get('expireKey')).toBeNull();
  });
});
