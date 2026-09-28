import { simulateRollingSpend } from '../../lib/guard/policySimulator';
describe('policySimulator', () => {
  it('simulates rolling spend', () => {
    expect(simulateRollingSpend([], 1000).rejected).toBe(false);
  });
});
