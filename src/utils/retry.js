// Retry logic for external APIs
import { logger } from './logging.js';

export async function fetchWithRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        logger.error(`Failed after ${maxRetries} attempts`, {
          error: error.message,
          attempts: maxRetries
        });
        throw error;
      }
      
      logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: error.message,
        attempt,
        maxRetries
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  
  throw lastError;
}
