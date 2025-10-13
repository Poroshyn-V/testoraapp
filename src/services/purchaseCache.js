import { googleSheets } from './googleSheets.js';
import { logger } from '../utils/logging.js';

/**
 * Purchase Cache Service
 * Manages in-memory cache of existing purchases to prevent duplicates
 */
class PurchaseCache {
  constructor() {
    this.existingPurchases = new Set();
    this.processedPurchaseIds = new Set();
  }

  /**
   * Check if purchase ID exists in cache
   */
  has(purchaseId) {
    return this.existingPurchases.has(purchaseId);
  }

  /**
   * Add purchase ID to cache
   */
  add(purchaseId) {
    this.existingPurchases.add(purchaseId);
  }

  /**
   * Clear all cached purchases
   */
  clear() {
    this.existingPurchases.clear();
    this.processedPurchaseIds.clear();
  }

  /**
   * Get cache size
   */
  size() {
    return this.existingPurchases.size;
  }

  /**
   * Get sample of cached purchases (for debugging)
   */
  getSample(limit = 5) {
    return Array.from(this.existingPurchases).slice(0, limit);
  }

  /**
   * Check if purchase was already processed in current session
   */
  wasProcessed(purchaseId) {
    return this.processedPurchaseIds.has(purchaseId);
  }

  /**
   * Mark purchase as processed
   */
  markAsProcessed(purchaseId) {
    this.processedPurchaseIds.add(purchaseId);
  }

  /**
   * Clear processed purchases (for new session)
   */
  clearProcessed() {
    this.processedPurchaseIds.clear();
  }

  /**
   * Reload cache from Google Sheets
   */
  async reload() {
    try {
      logger.info('🔄 Reloading purchase cache from Google Sheets...');
      
      const rows = await googleSheets.getAllRows();
      logger.info(`📋 Found ${rows.length} rows in Google Sheets`);
      
      this.clear();
      
      for (const row of rows) {
        const purchaseId = row.get('Purchase ID') || row.get('purchase_id') || '';
        if (purchaseId) {
          this.existingPurchases.add(purchaseId);
        } else {
          logger.warn('⚠️ Empty Purchase ID in row:', { rowData: row._rawData });
        }
      }
      
      logger.info(`✅ Loaded ${this.existingPurchases.size} existing purchases into cache`);
      logger.info('📝 Sample purchases:', { sample: this.getSample() });
      
      return this.existingPurchases.size;
    } catch (error) {
      logger.error('❌ Error reloading purchase cache:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      existingPurchases: this.existingPurchases.size,
      processedPurchases: this.processedPurchaseIds.size,
      sample: this.getSample()
    };
  }
}

// Export singleton instance
export const purchaseCache = new PurchaseCache();
