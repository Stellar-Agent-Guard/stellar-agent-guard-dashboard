import { decodeStorageFootprint } from '../../lib/guard/storage';
describe('storage', () => {
  it('decodes xdr', () => {
    expect(decodeStorageFootprint('xdr').decoded).toBe(true);
  });
});
