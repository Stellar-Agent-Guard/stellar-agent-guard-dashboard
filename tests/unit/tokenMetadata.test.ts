import { fetchTokenMetadata } from '../../lib/guard/tokenMetadata';
describe('tokenMetadata', () => {
  it('caches results', async () => {
    const res1 = await fetchTokenMetadata('rpc', 'A');
    const res2 = await fetchTokenMetadata('rpc', 'A');
    expect(res1).toBe(res2);
  });
});
