import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PurchaseCache } from '../src/services/purchaseCache.js';

// Mock the dependencies
vi.mock('../src/services/googleSheets.js', () => ({
  googleSheets: {
    getAllRows: vi.fn()
  }
}));

vi.mock('../src/utils/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('PurchaseCache', () => {
  let purchaseCache;
  let mockGoogleSheets;

  beforeEach(() => {
    purchaseCache = new PurchaseCache();
    mockGoogleSheets = await import('../src/services/googleSheets.js');
  });

  describe('constructor', () => {
    it('should initialize empty sets', () => {
      expect(purchaseCache.existingPurchases.size).toBe(0);
      expect(purchaseCache.processedPurchaseIds.size).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true for existing purchase ID', () => {
      purchaseCache.add('purchase_123');
      expect(purchaseCache.has('purchase_123')).toBe(true);
    });

    it('should return false for non-existing purchase ID', () => {
      expect(purchaseCache.has('purchase_456')).toBe(false);
    });
  });

  describe('add', () => {
    it('should add purchase ID to cache', () => {
      purchaseCache.add('purchase_123');
      expect(purchaseCache.existingPurchases.has('purchase_123')).toBe(true);
    });

    it('should not add duplicate purchase IDs', () => {
      purchaseCache.add('purchase_123');
      purchaseCache.add('purchase_123');
      expect(purchaseCache.existingPurchases.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all cached data', () => {
      purchaseCache.add('purchase_123');
      purchaseCache.markAsProcessed('purchase_456');
      
      purchaseCache.clear();
      
      expect(purchaseCache.existingPurchases.size).toBe(0);
      expect(purchaseCache.processedPurchaseIds.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return correct size', () => {
      expect(purchaseCache.size()).toBe(0);
      
      purchaseCache.add('purchase_123');
      purchaseCache.add('purchase_456');
      
      expect(purchaseCache.size()).toBe(2);
    });
  });

  describe('getSample', () => {
    it('should return sample of cached purchases', () => {
      purchaseCache.add('purchase_123');
      purchaseCache.add('purchase_456');
      purchaseCache.add('purchase_789');
      
      const sample = purchaseCache.getSample(2);
      expect(sample).toHaveLength(2);
      expect(sample).toContain('purchase_123');
      expect(sample).toContain('purchase_456');
    });

    it('should return all items if limit is greater than size', () => {
      purchaseCache.add('purchase_123');
      
      const sample = purchaseCache.getSample(5);
      expect(sample).toHaveLength(1);
      expect(sample).toContain('purchase_123');
    });
  });

  describe('wasProcessed', () => {
    it('should return true for processed purchase', () => {
      purchaseCache.markAsProcessed('purchase_123');
      expect(purchaseCache.wasProcessed('purchase_123')).toBe(true);
    });

    it('should return false for non-processed purchase', () => {
      expect(purchaseCache.wasProcessed('purchase_123')).toBe(false);
    });
  });

  describe('markAsProcessed', () => {
    it('should mark purchase as processed', () => {
      purchaseCache.markAsProcessed('purchase_123');
      expect(purchaseCache.processedPurchaseIds.has('purchase_123')).toBe(true);
    });
  });

  describe('clearProcessed', () => {
    it('should clear processed purchases', () => {
      purchaseCache.markAsProcessed('purchase_123');
      purchaseCache.markAsProcessed('purchase_456');
      
      purchaseCache.clearProcessed();
      
      expect(purchaseCache.processedPurchaseIds.size).toBe(0);
    });
  });

  describe('reload', () => {
    it('should reload purchases from Google Sheets', async () => {
      const mockRows = [
        { get: vi.fn().mockReturnValue('purchase_123') },
        { get: vi.fn().mockReturnValue('purchase_456') },
        { get: vi.fn().mockReturnValue('') }, // Empty purchase ID
        { get: vi.fn().mockReturnValue('purchase_789') }
      ];

      mockGoogleSheets.googleSheets.getAllRows.mockResolvedValue(mockRows);

      const result = await purchaseCache.reload();

      expect(result).toBe(3); // 3 valid purchase IDs
      expect(purchaseCache.size()).toBe(3);
      expect(purchaseCache.has('purchase_123')).toBe(true);
      expect(purchaseCache.has('purchase_456')).toBe(true);
      expect(purchaseCache.has('purchase_789')).toBe(true);
    });

    it('should handle empty rows', async () => {
      mockGoogleSheets.googleSheets.getAllRows.mockResolvedValue([]);

      const result = await purchaseCache.reload();

      expect(result).toBe(0);
      expect(purchaseCache.size()).toBe(0);
    });

    it('should handle Google Sheets errors', async () => {
      mockGoogleSheets.googleSheets.getAllRows.mockRejectedValue(new Error('API Error'));

      await expect(purchaseCache.reload()).rejects.toThrow('API Error');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      purchaseCache.add('purchase_123');
      purchaseCache.add('purchase_456');
      purchaseCache.markAsProcessed('purchase_789');

      const stats = purchaseCache.getStats();

      expect(stats).toEqual({
        existingPurchases: 2,
        processedPurchases: 1,
        sample: ['purchase_123', 'purchase_456']
      });
    });
  });
});
