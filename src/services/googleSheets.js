import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { ENV } from '../config/env.js';
import { logInfo, logError, logWarn } from '../utils/logging.js';
import { getCachedSheetsData } from '../utils/cache.js';
import { distributedLock } from './distributedLock.js';
import { fetchWithRetry } from '../utils/retry.js';

// Google Sheets service
class GoogleSheetsService {
  constructor() {
    this.doc = null;
    this.sheet = null;
    this.isInitialized = false;
    this.serviceAccountAuth = null;
  }

  // Reset initialization to force token refresh
  resetInitialization() {
    logInfo('Resetting Google Sheets initialization to force token refresh');
    this.isInitialized = false;
    this.doc = null;
    this.sheet = null;
    this.serviceAccountAuth = null;
  }

  // Check if error is related to expired/invalid token
  isTokenError(error) {
    if (!error) return false;
    
    const errorMessage = error.message || '';
    const statusCode = error.response?.status || error.status || error.code;
    
    // 401 Unauthorized - token expired or invalid
    if (statusCode === 401 || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      return true;
    }
    
    // Token expiration errors
    if (errorMessage.includes('token') && (
        errorMessage.includes('expired') ||
        errorMessage.includes('invalid') ||
        errorMessage.includes('Invalid Credentials')
    )) {
      return true;
    }
    
    // Google API authentication errors
    if (errorMessage.includes('invalid_grant') || 
        errorMessage.includes('invalid_token') ||
        errorMessage.includes('Request had invalid authentication credentials')) {
      return true;
    }
    
    return false;
  }

  // Initialize Google Sheets connection
  async initialize(forceRefresh = false) {
    if (this.isInitialized && !forceRefresh) {
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
      
      // Create new JWT auth instance (this will generate a fresh token)
      this.serviceAccountAuth = new JWT({
        email: ENV.GOOGLE_SERVICE_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, this.serviceAccountAuth);
      
      // Use retry logic for initialization to handle connection timeouts
      await fetchWithRetry(
        async () => {
          await this.doc.loadInfo();
          this.sheet = this.doc.sheetsByIndex[0];
          this.isInitialized = true;
        },
        5, // maxRetries
        2000 // initial delay for timeout errors
      );

      logInfo('Google Sheets initialized successfully', {
        title: this.doc.title,
        sheetCount: this.doc.sheetCount,
        sheetTitle: this.sheet.title,
        forceRefresh
      });
    } catch (error) {
      // If it's a token error, reset and try once more
      if (this.isTokenError(error) && !forceRefresh) {
        logWarn('Token error detected, resetting and retrying initialization', {
          error: error.message,
          errorCode: error.code,
          statusCode: error.response?.status || error.status
        });
        this.resetInitialization();
        return this.initialize(true); // Force refresh
      }
      
      logError('Failed to initialize Google Sheets after retries', error, {
        errorCode: error.code,
        errorReason: error.reason,
        statusCode: error.response?.status || error.status,
        isTokenError: this.isTokenError(error)
      });
      throw error;
    }
  }

  // Get sheet by name (creates if doesn't exist)
  async getSheetByName(sheetName) {
    await this.initialize();
    
    let targetSheet = this.doc.sheetsByTitle[sheetName];
    if (!targetSheet) {
      logInfo(`Creating new sheet: ${sheetName}`);
      targetSheet = await this.doc.addSheet({ title: sheetName });
      logInfo(`Sheet "${sheetName}" created successfully`);
    }
    
    return targetSheet;
  }

  // Get all rows from the sheet with token error handling
  async getAllRows() {
    await this.initialize();
    
    // ✅ КРИТИЧЕСКИ ВАЖНО: Используем уникальный ключ кэша для каждого листа
    const cacheKey = `all-rows-${this.sheet?.title || 'default'}`;
    return getCachedSheetsData(cacheKey, async () => {
      logInfo('Fetching all rows from Google Sheets', { sheetTitle: this.sheet?.title });
      try {
        const rows = await this.sheet.getRows();
        logInfo('Successfully fetched rows from Google Sheets', { count: rows.length, sheetTitle: this.sheet?.title });
        return rows;
      } catch (error) {
        // If token error, reset and retry once
        if (this.isTokenError(error)) {
          logWarn('Token error in getRows, resetting and retrying', {
            error: error.message,
            sheetTitle: this.sheet?.title
          });
          this.resetInitialization();
          await this.initialize(true);
          const rows = await this.sheet.getRows();
          logInfo('Successfully fetched rows after token refresh', { count: rows.length, sheetTitle: this.sheet?.title });
          return rows;
        }
        throw error;
      }
    });
  }

  // Add a new row to the sheet with token error handling
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
      // If token error, reset and retry once
      if (this.isTokenError(error)) {
        logWarn('Token error in addRow, resetting and retrying', {
          error: error.message
        });
        this.resetInitialization();
        await this.initialize(true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        const newRow = await this.sheet.addRow(rowData);
        logInfo('Successfully added row after token refresh', { 
          rowNumber: newRow.rowNumber 
        });
        return newRow;
      }
      logError('Failed to add row to Google Sheets', error, { rowData });
      throw error;
    }
  }

  // Update an existing row with token error handling
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
      // If token error, reset and retry once (need to reload row)
      if (this.isTokenError(error)) {
        logWarn('Token error in updateRow, resetting and retrying', {
          error: error.message,
          rowNumber: row.rowNumber
        });
        this.resetInitialization();
        await this.initialize(true);
        // Reload the row after reinitialization
        const rows = await this.sheet.getRows();
        const rowToUpdate = rows.find(r => r.rowNumber === row.rowNumber);
        if (!rowToUpdate) {
          throw new Error(`Row ${row.rowNumber} not found after token refresh`);
        }
        Object.entries(updateData).forEach(([key, value]) => {
          rowToUpdate.set(key, value);
        });
        await rowToUpdate.save();
        logInfo('Successfully updated row after token refresh', { 
          rowNumber: rowToUpdate.rowNumber 
        });
        return rowToUpdate;
      }
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
      
      // ✅ КРИТИЧЕСКИ ВАЖНО: Используем правильный лист для поиска
      // Проверяем существование внутри блокировки, используя текущий this.sheet
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

  // Delete a row by row number
  async deleteRow(rowNumber) {
    try {
      await this.initialize();
      
      logInfo('Deleting row from Google Sheets', { rowNumber });
      
      // Get the row by row number
      const rows = await this.sheet.getRows();
      const rowToDelete = rows.find(row => row.rowNumber === rowNumber);
      
      if (!rowToDelete) {
        throw new Error(`Row ${rowNumber} not found`);
      }
      
      // Delete the row
      await rowToDelete.delete();
      
      logInfo('Successfully deleted row from Google Sheets', { rowNumber });
      
      return true;
    } catch (error) {
      logError('Failed to delete row from Google Sheets', error, { rowNumber });
      throw error;
    }
  }
}

// Export singleton instance
export const googleSheets = new GoogleSheetsService();
export default googleSheets;
