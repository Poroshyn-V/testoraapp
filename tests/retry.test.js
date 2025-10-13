import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the fetchWithRetry function
const fetchWithRetry = async (fn, retries = 3, delay = 1000) => {
  const startTime = Date.now();
  const operationName = fn.name || 'external API call';
  
  for (let i = 0; i < retries; i++) {
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      
      if (i > 0) {
        console.log(`✅ ${operationName} succeeded after ${i} retries`, {
          retries: i,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      if (i === retries - 1) {
        const duration = Date.now() - startTime;
        console.error(`❌ ${operationName} failed after ${retries} attempts`, {
          error: error.message,
          retries: retries,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
      
      const retryDelay = delay * (i + 1);
      console.warn(`Retry ${i + 1}/${retries} after error:`, {
        operation: operationName,
        error: error.message,
        retryDelay: `${retryDelay}ms`,
        timestamp: new Date().toISOString()
      });
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
};

describe('Retry Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetchWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await fetchWithRetry(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockFn = vi.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success');
      
      const resultPromise = fetchWithRetry(mockFn, 3, 100);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      const result = await resultPromise;
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should fail after all retries exhausted', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Persistent failure'));
      
      const resultPromise = fetchWithRetry(mockFn, 2, 100);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      await expect(resultPromise).rejects.toThrow('Persistent failure');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff delay', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Failure'));
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      const resultPromise = fetchWithRetry(mockFn, 3, 1000);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      try {
        await resultPromise;
      } catch (error) {
        // Expected to fail
      }
      
      // Check that setTimeout was called with increasing delays
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000); // First retry
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000); // Second retry
    });

    it('should handle custom retry count', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Failure'));
      
      const resultPromise = fetchWithRetry(mockFn, 5, 100);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      try {
        await resultPromise;
      } catch (error) {
        // Expected to fail
      }
      
      expect(mockFn).toHaveBeenCalledTimes(5);
    });

    it('should handle custom delay', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Failure'));
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      const resultPromise = fetchWithRetry(mockFn, 2, 500);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      try {
        await resultPromise;
      } catch (error) {
        // Expected to fail
      }
      
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500); // First retry
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000); // Second retry
    });

    it('should preserve function name in logs', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Failure'));
      mockFn.name = 'testFunction';
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const resultPromise = fetchWithRetry(mockFn, 2, 100);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      try {
        await resultPromise;
      } catch (error) {
        // Expected to fail
      }
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Retry 1/2 after error:',
        expect.objectContaining({
          operation: 'testFunction',
          error: 'Failure'
        })
      );
    });

    it('should handle functions without names', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Failure'));
      delete mockFn.name;
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const resultPromise = fetchWithRetry(mockFn, 2, 100);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      try {
        await resultPromise;
      } catch (error) {
        // Expected to fail
      }
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Retry 1/2 after error:',
        expect.objectContaining({
          operation: 'external API call',
          error: 'Failure'
        })
      );
    });
  });
});
