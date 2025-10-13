import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { ENV } from '../config/env.js';
import { logInfo, logError } from '../utils/logging.js';
import { getCachedSheetsData } from '../utils/cache.js';
import { distributedLock } from './distributedLock.js';

// Google Sheets service
class GoogleSheetsService {
  constructor() {
    this.doc = null;
    this.sheet = null;
    this.isInitialized = false;
  }

  // Initialize Google Sheets connection
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      logError('Google Sheets not configured', null, {
        hasEmail: !!ENV.GOOGLE_SERVICE_EMAIL,
        hasKey: !!ENV.GOOGLE_SERVICE_PRIVATE_KEY,
        hasDocId: !!ENV.GOOGLE_SHEETS_DOC_ID
      });
      throw new Error('Google Sheets not configured');
    }

    try {
      const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
      const serviceAccountAuth = new JWT({
        email: ENV.GOOGLE_SERVICE_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
      await this.doc.loadInfo();
      this.sheet = this.doc.sheetsByIndex[0];
      this.isInitialized = true;

      logInfo('Google Sheets initialized successfully', {
        title: this.doc.title,
        sheetCount: this.doc.sheetCount,
        sheetTitle: this.sheet.title
      });
    } catch (error) {
      logError('Failed to initialize Google Sheets', error);
      throw error;
    }
  }

  // Get all rows from the sheet
  async getAllRows() {
    await this.initialize();
    
    return getCachedSheetsData('all-rows', async () => {
      logInfo('Fetching all rows from Google Sheets');
      const rows = await this.sheet.getRows();
      logInfo('Successfully fetched rows from Google Sheets', { count: rows.length });
      return rows;
    });
  }

  // Add a new row to the sheet
  async addRow(rowData) {
    await this.initialize();
    
    try {
      logInfo('Adding new row to Google Sheets', { rowData: Object.keys(rowData) });
      
      // Add delay to avoid API limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newRow = await this.sheet.addRow(rowData);
      
      logInfo('Successfully added row to Google Sheets', { 
        rowNumber: newRow.rowNumber 
      });
      
      return newRow;
    } catch (error) {
      logError('Failed to add row to Google Sheets', error, { rowData });
      throw error;
    }
  }

  // Update an existing row
  async updateRow(row, updateData) {
    try {
      logInfo('Updating row in Google Sheets', { 
        rowNumber: row.rowNumber,
        updateData: Object.keys(updateData)
      });
      
      // Update row data
      Object.entries(updateData).forEach(([key, value]) => {
        row.set(key, value);
      });
      
      await row.save();
      
      logInfo('Successfully updated row in Google Sheets', { 
        rowNumber: row.rowNumber 
      });
      
      return row;
    } catch (error) {
      logError('Failed to update row in Google Sheets', error, { 
        rowNumber: row.rowNumber,
        updateData 
      });
      throw error;
    }
  }

  // Batch update multiple rows efficiently
  async batchUpdate(updates) {
    if (!updates || updates.length === 0) {
      logInfo('No updates to perform');
      return [];
    }

    await this.initialize();
    
    const startTime = Date.now();
    const batchSize = 10; // Process in batches to avoid API limits
    const results = [];
    
    try {
      logInfo('Starting batch update', { 
        totalUpdates: updates.length,
        batchSize: batchSize
      });

      // Process updates in batches
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(updates.length / batchSize);
        
        logInfo(`Processing batch ${batchNumber}/${totalBatches}`, {
          batchSize: batch.length,
          startIndex: i,
          endIndex: i + batch.length - 1
        });

        // Process batch updates
        const batchPromises = batch.map(async ({ row, data }) => {
          try {
            // Update row data
            Object.entries(data).forEach(([key, value]) => {
              row.set(key, value);
            });
            
            await row.save();
            
            return {
              success: true,
              rowNumber: row.rowNumber,
              data: Object.keys(data)
            };
          } catch (error) {
            logError('Failed to update row in batch', error, {
              rowNumber: row.rowNumber,
              data: Object.keys(data)
            });
            
            return {
              success: false,
              rowNumber: row.rowNumber,
              error: error.message,
              data: Object.keys(data)
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Add delay between batches to respect API limits
        if (i + batchSize < updates.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      const duration = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      logInfo('Batch update completed', {
        totalUpdates: updates.length,
        successCount: successCount,
        failureCount: failureCount,
        duration: `${duration}ms`,
        durationSeconds: Math.round(duration / 1000),
        avgTimePerUpdate: Math.round(duration / updates.length)
      });

      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      logError('Batch update failed', error, {
        totalUpdates: updates.length,
        duration: `${duration}ms`
      });
      throw error;
    }
  }

  // Batch add multiple rows efficiently
  async batchAdd(rowsData) {
    if (!rowsData || rowsData.length === 0) {
      logInfo('No rows to add');
      return [];
    }

    await this.initialize();
    
    const startTime = Date.now();
    const batchSize = 10; // Process in batches to avoid API limits
    const results = [];
    
    try {
      logInfo('Starting batch add', { 
        totalRows: rowsData.length,
        batchSize: batchSize
      });

      // Process adds in batches
      for (let i = 0; i < rowsData.length; i += batchSize) {
        const batch = rowsData.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(rowsData.length / batchSize);
        
        logInfo(`Processing add batch ${batchNumber}/${totalBatches}`, {
          batchSize: batch.length,
          startIndex: i,
          endIndex: i + batch.length - 1
        });

        // Process batch adds
        const batchPromises = batch.map(async (rowData) => {
          try {
            // Add delay to avoid API limits
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const newRow = await this.sheet.addRow(rowData);
            
            return {
              success: true,
              rowNumber: newRow.rowNumber,
              data: Object.keys(rowData)
            };
          } catch (error) {
            logError('Failed to add row in batch', error, {
              data: Object.keys(rowData)
            });
            
            return {
              success: false,
              error: error.message,
              data: Object.keys(rowData)
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Add delay between batches to respect API limits
        if (i + batchSize < rowsData.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      const duration = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      logInfo('Batch add completed', {
        totalRows: rowsData.length,
        successCount: successCount,
        failureCount: failureCount,
        duration: `${duration}ms`,
        durationSeconds: Math.round(duration / 1000),
        avgTimePerRow: Math.round(duration / rowsData.length)
      });

      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      logError('Batch add failed', error, {
        totalRows: rowsData.length,
        duration: `${duration}ms`
      });
      throw error;
    }
  }

  // Find rows by criteria
  async findRows(criteria) {
    const rows = await this.getAllRows();
    
    return rows.filter(row => {
      return Object.entries(criteria).every(([key, value]) => {
        const rowValue = row.get(key);
        return rowValue === value;
      });
    });
  }

  // Get sheet statistics
  async getStats() {
    const rows = await this.getAllRows();
    
    return {
      totalRows: rows.length,
      sheetTitle: this.sheet?.title,
      lastUpdated: new Date().toISOString()
    };
  }

  // Check if customer exists
  async customerExists(customerId) {
    const rows = await this.findRows({ 'Customer ID': customerId });
    return rows.length > 0;
  }

  // Get customer by ID
  async getCustomer(customerId) {
    const rows = await this.findRows({ 'Customer ID': customerId });
    return rows.length > 0 ? rows[0] : null;
  }

  // Add row if not exists with distributed lock protection
  async addRowIfNotExists(data, uniqueField = 'Customer ID') {
    const uniqueValue = data[uniqueField];
    const lockKey = `sheet_add_${uniqueField}_${uniqueValue}`;
    let lockId = null;
    
    try {
      // 🔒 Получаем эксклюзивную блокировку
      lockId = await distributedLock.acquire(lockKey);
      
      logInfo(`Checking if row exists (with lock): ${uniqueField}=${uniqueValue}`);
      
      // Проверяем существование внутри блокировки
      const existing = await this.findRows({ [uniqueField]: uniqueValue });
      
      if (existing.length > 0) {
        logInfo(`Row already exists for ${uniqueField}=${uniqueValue}`, {
          rowCount: existing.length,
          rowNumber: existing[0].rowNumber
        });
        
        return {
          success: false,
          exists: true,
          action: 'skipped',
          row: existing[0]
        };
      }
      
      // 🔍 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Проверяем дубликаты по Payment Intent ID
      const paymentIntentIds = data['Payment Intent IDs'];
      if (paymentIntentIds) {
        const paymentIds = paymentIntentIds.split(', ').map(id => id.trim());
        
        for (const paymentId of paymentIds) {
          const existingByPaymentId = await this.findRows({ 'Payment Intent IDs': paymentId });
          if (existingByPaymentId.length > 0) {
            logInfo(`Payment Intent ID ${paymentId} already exists in row ${existingByPaymentId[0].rowNumber}`, {
              paymentId,
              existingRow: existingByPaymentId[0].rowNumber
            });
            
            return {
              success: false,
              exists: true,
              action: 'skipped',
              row: existingByPaymentId[0],
              reason: 'payment_intent_duplicate'
            };
          }
        }
      }
      
      // Добавляем строку (всё ещё держим блокировку)
      logInfo(`Adding new row: ${uniqueField}=${uniqueValue}`);
      const newRow = await this.addRow(data);
      
      // Маленькая задержка для надёжности
      await new Promise(resolve => setTimeout(resolve, 50));
      
      return {
        success: true,
        exists: false,
        action: 'added',
        row: newRow
      };
      
    } catch (error) {
      logError(`Error in addRowIfNotExists for ${uniqueField}=${uniqueValue}`, error);
      throw error;
    } finally {
      // 🔓 ВСЕГДА освобождаем блокировку
      if (lockId) {
        distributedLock.release(lockKey, lockId);
      }
    }
  }
}

// Export singleton instance
export const googleSheets = new GoogleSheetsService();
export default googleSheets;
