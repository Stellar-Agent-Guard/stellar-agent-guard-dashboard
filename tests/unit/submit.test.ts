import { createTransactionEnvelope, detectExpiration } from '../../lib/guard/submit';
describe('submit', () => {
  it('sets TimeBounds correctly', () => {
    const { minTime, maxTime } = createTransactionEnvelope(1000);
    expect(minTime).toBe(940);
    expect(maxTime).toBe(1300);
  });
  it('detects expiration', () => {
    expect(detectExpiration(1300, 1300)).toBe(true);
  });
});
