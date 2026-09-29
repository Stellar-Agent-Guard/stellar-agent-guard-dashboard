import { describe, it } from 'node:test';
import assert from 'node:assert';
import { decodeStorageFootprint } from '../../lib/guard/storage';

describe('storage', () => {
  it('handles uninitialized', () => {
    assert.strictEqual(decodeStorageFootprint('', 'Policy').value, 'Uninitialized');
  });

  it('handles invalid xdr gracefully', () => {
    assert.strictEqual(decodeStorageFootprint('invalid_xdr', 'Window').decoded, false);
  });
});
