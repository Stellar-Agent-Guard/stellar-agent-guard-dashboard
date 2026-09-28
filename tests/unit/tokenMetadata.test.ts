import { fetchTokenMetadata } from '../../lib/guard/tokenMetadata';

describe('tokenMetadata', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('caches results for the same contractId', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ result: '7' }),
    } as unknown as Response);
    const res1 = await fetchTokenMetadata('http://rpc', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const res2 = await fetchTokenMetadata('http://rpc', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(res1).toBe(res2);
  });

  it('returns warning for invalid (non-SAC) contract address', async () => {
    const res = await fetchTokenMetadata('http://rpc', 'INVALID_CONTRACT');
    expect(res.warning).toBeDefined();
    expect(res.warning).toContain('does not appear to be a valid SAC address');
  });

  it('returns fallback with warning when RPC call fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
    const res = await fetchTokenMetadata('http://rpc', 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(res.warning).toBeDefined();
    expect(res.warning).toContain('Failed to query token metadata');
  });
});
