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
  // For Google Sheets operations, increase retries for quota errors
  // This will be handled dynamically based on error type
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
      
      // Check for quota/rate limit errors (429)
      const statusCode = error.response?.status || error.status || error.code;
      const isQuotaError = statusCode === 429 || 
                          errorMessage.includes('429') || 
                          errorMessage.includes('Quota exceeded') ||
                          errorMessage.includes('rateLimitExceeded');
      
      // For timeout errors, use longer delays
      const isTimeoutError = error.code === 'ETIMEDOUT' || 
                             errorMessage?.includes('ETIMEDOUT') ||
                             errorReason?.includes('ETIMEDOUT');
      
      // For quota errors, use much longer delays (Google recommends exponential backoff with longer base)
      // For timeout errors, use medium delays
      // For other errors, use standard delays
      let baseDelay;
      if (isQuotaError) {
        baseDelay = 30000; // 30 seconds for quota errors (Google API rate limit)
      } else if (isTimeoutError) {
        baseDelay = 2000; // 2 seconds for timeouts
      } else {
        baseDelay = delay; // Standard delay
      }
      
      const retryDelay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      
      logger.warn(`Attempt ${attempt} failed, retrying in ${retryDelay}ms`, {
        error: error.message,
        errorCode: error.code,
        statusCode,
        errorReason: error.reason,
        attempt,
        maxRetries,
        isQuotaError,
        isTimeoutError,
        retryDelay: `${retryDelay}ms (${Math.round(retryDelay / 1000)}s)`
      });
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  throw lastError;
}
