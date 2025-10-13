import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoogleSheetsService } from '../src/services/googleSheets.js';

// Mock the dependencies
vi.mock('../src/config/env.js', () => ({
  ENV: {
    GOOGLE_SERVICE_EMAIL: 'test@example.com',
    GOOGLE_SERVICE_PRIVATE_KEY: 'mock_private_key',
    GOOGLE_SHEETS_DOC_ID: 'mock_sheet_id'
  }
}));

vi.mock('../src/utils/logging.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn()
}));

vi.mock('../src/utils/cache.js', () => ({
  getCachedSheetsData: vi.fn((key, fn) => fn())
}));

describe('Batch Operations', () => {
  let googleSheets;
  let mockSheet;
  let mockDoc;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock Google Spreadsheet
    mockSheet = {
      addRow: vi.fn(),
      getRows: vi.fn(),
      title: 'Test Sheet'
    };
    
    mockDoc = {
      loadInfo: vi.fn(),
      title: 'Test Document',
      sheetCount: 1,
      sheetsByIndex: [mockSheet]
    };
    
    // Mock GoogleSpreadsheet constructor
    vi.doMock('google-spreadsheet', () => ({
      GoogleSpreadsheet: vi.fn().mockImplementation(() => mockDoc)
    }));
    
    // Mock JWT
    vi.doMock('google-auth-library', () => ({
      JWT: vi.fn().mockImplementation(() => ({}))
    }));
    
    googleSheets = new GoogleSheetsService();
  });

  describe('batchUpdate', () => {
    it('should update multiple rows efficiently', async () => {
      const mockRows = [
        { 
          rowNumber: 1, 
          set: vi.fn(), 
          save: vi.fn().mockResolvedValue() 
        },
        { 
          rowNumber: 2, 
          set: vi.fn(), 
          save: vi.fn().mockResolvedValue() 
        }
      ];

      const updates = [
        { 
          row: mockRows[0], 
          data: { 'Ad Name': 'Test Ad 1', 'Amount': '9.99' } 
        },
        { 
          row: mockRows[1], 
          data: { 'Ad Name': 'Test Ad 2', 'Amount': '19.99' } 
        }
      ];

      const results = await googleSheets.batchUpdate(updates);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockRows[0].set).toHaveBeenCalledWith('Ad Name', 'Test Ad 1');
      expect(mockRows[0].set).toHaveBeenCalledWith('Amount', '9.99');
      expect(mockRows[1].set).toHaveBeenCalledWith('Ad Name', 'Test Ad 2');
      expect(mockRows[1].set).toHaveBeenCalledWith('Amount', '19.99');
    });

    it('should handle empty updates array', async () => {
      const results = await googleSheets.batchUpdate([]);
      expect(results).toEqual([]);
    });

    it('should handle batch update failures gracefully', async () => {
      const mockRow = { 
        rowNumber: 1, 
        set: vi.fn(), 
        save: vi.fn().mockRejectedValue(new Error('Save failed')) 
      };

      const updates = [
        { 
          row: mockRow, 
          data: { 'Ad Name': 'Test Ad' } 
        }
      ];

      const results = await googleSheets.batchUpdate(updates);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Save failed');
    });

    it('should process updates in batches of 10', async () => {
      const mockRows = Array.from({ length: 25 }, (_, i) => ({
        rowNumber: i + 1,
        set: vi.fn(),
        save: vi.fn().mockResolvedValue()
      }));

      const updates = mockRows.map((row, i) => ({
        row,
        data: { 'Ad Name': `Test Ad ${i + 1}` }
      }));

      const results = await googleSheets.batchUpdate(updates);

      expect(results).toHaveLength(25);
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe('batchAdd', () => {
    it('should add multiple rows efficiently', async () => {
      const mockNewRows = [
        { rowNumber: 1 },
        { rowNumber: 2 }
      ];

      mockSheet.addRow
        .mockResolvedValueOnce(mockNewRows[0])
        .mockResolvedValueOnce(mockNewRows[1]);

      const rowsData = [
        { 'Ad Name': 'Test Ad 1', 'Amount': '9.99' },
        { 'Ad Name': 'Test Ad 2', 'Amount': '19.99' }
      ];

      const results = await googleSheets.batchAdd(rowsData);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[0].rowNumber).toBe(1);
      expect(results[1].rowNumber).toBe(2);
      expect(mockSheet.addRow).toHaveBeenCalledTimes(2);
    });

    it('should handle empty rows data', async () => {
      const results = await googleSheets.batchAdd([]);
      expect(results).toEqual([]);
    });

    it('should handle batch add failures gracefully', async () => {
      mockSheet.addRow.mockRejectedValue(new Error('Add failed'));

      const rowsData = [
        { 'Ad Name': 'Test Ad' }
      ];

      const results = await googleSheets.batchAdd(rowsData);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Add failed');
    });

    it('should process adds in batches of 10', async () => {
      const mockNewRows = Array.from({ length: 15 }, (_, i) => ({
        rowNumber: i + 1
      }));

      mockSheet.addRow.mockImplementation((data) => 
        Promise.resolve(mockNewRows[data['Ad Name'].split(' ')[2] - 1])
      );

      const rowsData = Array.from({ length: 15 }, (_, i) => ({
        'Ad Name': `Test Ad ${i + 1}`
      }));

      const results = await googleSheets.batchAdd(rowsData);

      expect(results).toHaveLength(15);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockSheet.addRow).toHaveBeenCalledTimes(15);
    });
  });

  describe('Performance', () => {
    it('should be faster than individual operations', async () => {
      const mockRows = Array.from({ length: 10 }, (_, i) => ({
        rowNumber: i + 1,
        set: vi.fn(),
        save: vi.fn().mockResolvedValue()
      }));

      const updates = mockRows.map((row, i) => ({
        row,
        data: { 'Ad Name': `Test Ad ${i + 1}` }
      }));

      const startTime = Date.now();
      const results = await googleSheets.batchUpdate(updates);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(1000); // Should complete quickly
    });

    it('should respect API rate limits with delays', async () => {
      const mockRows = Array.from({ length: 15 }, (_, i) => ({
        rowNumber: i + 1,
        set: vi.fn(),
        save: vi.fn().mockResolvedValue()
      }));

      const updates = mockRows.map((row, i) => ({
        row,
        data: { 'Ad Name': `Test Ad ${i + 1}` }
      }));

      // Mock setTimeout to track delays
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      await googleSheets.batchUpdate(updates);

      // Should have delays between batches (every 10 items)
      expect(setTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should continue processing even if some updates fail', async () => {
      const mockRows = [
        { 
          rowNumber: 1, 
          set: vi.fn(), 
          save: vi.fn().mockResolvedValue() 
        },
        { 
          rowNumber: 2, 
          set: vi.fn(), 
          save: vi.fn().mockRejectedValue(new Error('Save failed')) 
        },
        { 
          rowNumber: 3, 
          set: vi.fn(), 
          save: vi.fn().mockResolvedValue() 
        }
      ];

      const updates = mockRows.map((row, i) => ({
        row,
        data: { 'Ad Name': `Test Ad ${i + 1}` }
      }));

      const results = await googleSheets.batchUpdate(updates);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it('should provide detailed error information', async () => {
      const mockRow = { 
        rowNumber: 1, 
        set: vi.fn(), 
        save: vi.fn().mockRejectedValue(new Error('Network timeout')) 
      };

      const updates = [
        { 
          row: mockRow, 
          data: { 'Ad Name': 'Test Ad' } 
        }
      ];

      const results = await googleSheets.batchUpdate(updates);

      expect(results[0]).toEqual({
        success: false,
        rowNumber: 1,
        error: 'Network timeout',
        data: ['Ad Name']
      });
    });
  });
});
