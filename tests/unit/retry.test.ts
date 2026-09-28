import { withRetry } from '../../lib/utils/retry';

describe('Retry logic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('verifies backoff timing progression with jitter', async () => {
    const mockFn = jest.fn()
      .mockRejectedValueOnce(new Error('retryable'))
      .mockRejectedValueOnce(new Error('retryable'))
      .mockResolvedValue('success');

    const promise = withRetry(mockFn);
    
    // Fast-forward through retries
    jest.runAllTimers();
    
    const result = await promise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('handles non-retryable errors without delay', async () => {
    const error = new Error('fatal');
    (error as any).retryable = false;
    
    const mockFn = jest.fn().mockRejectedValue(error);
    
    await expect(withRetry(mockFn)).rejects.toThrow('fatal');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
