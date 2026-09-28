import { fetchTokenMetadata } from '../../lib/guard/tokenMetadata';
describe('tokenMetadata', () => {
  it('caches results', async () => {
    const res1 = await fetchTokenMetadata('rpc', 'A');
    const res2 = await fetchTokenMetadata('rpc', 'A');
    expect(res1).toBe(res2);
  });
  it('handles invalid addresses', async () => {
    const res = await fetchTokenMetadata('rpc', 'INVALID');
    expect(res.name).toBe('Stellar');
  });
});
