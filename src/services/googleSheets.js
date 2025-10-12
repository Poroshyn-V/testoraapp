import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { ENV } from '../config/env.js';
import { logInfo, logError } from '../utils/logging.js';
import { getCachedSheetsData } from '../utils/cache.js';

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
}

// Export singleton instance
export const googleSheets = new GoogleSheetsService();
export default googleSheets;
