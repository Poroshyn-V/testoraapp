import { logInfo } from './logging.js';
import { CACHE_CONFIG } from '../config/env.js';

// Cache storage
const sheetsCache = new Map();
const stripeCache = new Map();

// LRU Cache implementation for better memory management
class LRUCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  clear() {
    this.cache.clear();
  }
  
  get size() {
    return this.cache.size;
  }
}

// Use LRU cache for better memory management
const lruSheetsCache = new LRUCache(500);
const lruStripeCache = new LRUCache(1000);

// Caching for Google Sheets
export async function getCachedSheetsData(cacheKey, fetchFunction) {
  const now = Date.now();
  const cached = lruSheetsCache.get(cacheKey);
  
  if (cached && (now - cached.timestamp) < CACHE_CONFIG.SHEETS_TTL) {
    logInfo('Cache hit for Google Sheets', { cacheKey });
    return cached.data;
  }
  
  logInfo('Cache miss for Google Sheets, fetching fresh data', { cacheKey });
  const data = await fetchFunction();
  
  lruSheetsCache.set(cacheKey, {
    data,
    timestamp: now
  });
  
  return data;
}

// Caching for Stripe API responses
export async function getCachedStripeData(cacheKey, fetchFunction, ttl = 60000) {
  const now = Date.now();
  const cached = lruStripeCache.get(cacheKey);
  
  if (cached && (now - cached.timestamp) < ttl) {
    logInfo('Cache hit for Stripe API', { cacheKey });
    return cached.data;
  }
  
  logInfo('Cache miss for Stripe API, fetching fresh data', { cacheKey });
  const data = await fetchFunction();
  
  lruStripeCache.set(cacheKey, {
    data,
    timestamp: now
  });
  
  return data;
}

// Clear cache
export function clearSheetsCache() {
  lruSheetsCache.clear();
  logInfo('Google Sheets cache cleared');
}

export function clearStripeCache() {
  lruStripeCache.clear();
  logInfo('Stripe cache cleared');
}

export function clearAllCaches() {
  lruSheetsCache.clear();
  lruStripeCache.clear();
  logInfo('All caches cleared');
}

// Get cache stats
export function getCacheStats() {
  return {
    sheetsCacheSize: lruSheetsCache.size,
    stripeCacheSize: lruStripeCache.size,
    sheetsCacheMaxSize: lruSheetsCache.maxSize,
    stripeCacheMaxSize: lruStripeCache.maxSize
  };
}
