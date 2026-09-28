import { calculateFeeHeadroom } from '../../lib/guard/feeEstimator';
describe('feeEstimator', () => {
  it('pads cpu and fee without overflow', () => {
    const res = calculateFeeHeadroom(1000, 1000n);
    expect(res.cpu).toBe(1150);
    expect(res.fee).toBe(1200n);
  });
});
