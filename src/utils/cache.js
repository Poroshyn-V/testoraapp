import { logInfo } from './logging.js';
import { CACHE_CONFIG } from '../config/env.js';

// Cache storage
const sheetsCache = new Map();

// Caching for Google Sheets
export async function getCachedSheetsData(cacheKey, fetchFunction) {
  const now = Date.now();
  const cached = sheetsCache.get(cacheKey);
  
  if (cached && (now - cached.timestamp) < CACHE_CONFIG.SHEETS_TTL) {
    logInfo('Cache hit for Google Sheets', { cacheKey });
    return cached.data;
  }
  
  logInfo('Cache miss for Google Sheets, fetching fresh data', { cacheKey });
  const data = await fetchFunction();
  
  sheetsCache.set(cacheKey, {
    data,
    timestamp: now
  });
  
  return data;
}

// Clear cache
export function clearSheetsCache() {
  sheetsCache.clear();
  logInfo('Google Sheets cache cleared');
}

// Get cache stats
export function getCacheStats() {
  return {
    sheetsCacheSize: sheetsCache.size
  };
}
