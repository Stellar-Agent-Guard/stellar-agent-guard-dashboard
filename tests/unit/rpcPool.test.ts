import { RpcPool } from '../../lib/guard/rpcPool';

describe('RpcPool', () => {
  it('should initialize with primary url', () => {
    const pool = new RpcPool('http://primary', ['http://fallback']);
    expect(pool.currentUrl).toBe('http://primary');
  });

  it('should failover after 3 failures', async () => {
    const pool = new RpcPool('http://primary', ['http://fallback']);
    // mock fetch to always fail
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    
    for (let i = 0; i < 3; i++) {
      try { await pool.fetch('/test'); } catch (e) {}
    }
    
    expect(pool.currentUrl).toBe('http://fallback');
  });
});
