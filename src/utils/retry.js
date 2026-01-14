// Retry logic for external APIs
import { logger } from './logging.js';

// Check if error is a retryable network error
function isRetryableError(error) {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  const errorCode = error.code || '';
  const errorReason = error.reason || '';
  
  // Network timeout errors
  if (errorCode === 'ETIMEDOUT' || errorCode === 'ECONNRESET' || errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED') {
    return true;
  }
  
  // Connection timeout in error message
  if (errorMessage.includes('ETIMEDOUT') || 
      errorMessage.includes('timeout') || 
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ENOTFOUND')) {
    return true;
  }
  
  // OAuth2 connection errors
  if (errorReason && (
      errorReason.includes('ETIMEDOUT') ||
      errorReason.includes('timeout') ||
      errorReason.includes('connect')
  )) {
    return true;
  }
  
  // Google API quota/rate limit errors (retryable)
  if (errorMessage.includes('429') || 
      errorMessage.includes('Quota exceeded') ||
      errorMessage.includes('rateLimitExceeded')) {
    return true;
  }
  
  // Token expiration errors (retryable - token will be refreshed)
  const statusCode = error.response?.status || error.status || error.code;
  if (statusCode === 401 || 
      errorMessage.includes('401') || 
      errorMessage.includes('Unauthorized') ||
      errorMessage.includes('invalid_grant') ||
      errorMessage.includes('invalid_token') ||
      errorMessage.includes('Invalid Credentials') ||
      errorMessage.includes('Request had invalid authentication credentials')) {
    return true;
  }
  
  return false;
}

export async function fetchWithRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = isRetryableError(error);
      
      if (attempt === maxRetries || !isRetryable) {
        logger.error(`Failed after ${attempt} attempt(s)`, {
          error: error.message,
          errorCode: error.code,
          errorReason: error.reason,
          attempts: attempt,
          maxRetries,
          isRetryable,
          stack: error.stack
        });
        throw error;
      }
      
      // For timeout errors, use longer delays
      const isTimeoutError = error.code === 'ETIMEDOUT' || 
                             error.message?.includes('ETIMEDOUT') ||
                             error.reason?.includes('ETIMEDOUT');
      const baseDelay = isTimeoutError ? 2000 : delay; // 2 seconds for timeouts
      const retryDelay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      
      logger.warn(`Attempt ${attempt} failed, retrying in ${retryDelay}ms`, {
        error: error.message,
        errorCode: error.code,
        errorReason: error.reason,
        attempt,
        maxRetries,
        isTimeoutError,
        retryDelay
      });
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  throw lastError;
}
