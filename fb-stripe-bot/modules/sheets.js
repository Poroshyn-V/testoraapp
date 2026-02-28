// Google Sheets Module
import { google } from 'googleapis';

export class Sheets {
  constructor() {
    this.sheetId = process.env.SHEET_ID;
    this.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
    this.sheets = null;
  }

  async initialize() {
    console.log('🔧 Initializing Google Sheets...');
    
    if (!this.sheetId || !this.credentials.project_id) {
      throw new Error('Google Sheets credentials not configured');
    }

    try {
      const auth = new google.auth.GoogleAuth({
        credentials: this.credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      console.log('✅ Google Sheets initialized');
    } catch (error) {
      console.error('Error initializing Google Sheets:', error);
      throw error;
    }
  }

  // Get sheet data with headers as object keys
  async getSheetData(range = 'A:Z') {
    try {
      const res = await this.sheets.spreadsheets.values.get({ 
        spreadsheetId: this.sheetId, 
        range 
      });
      
      const [header, ...rows] = res.data.values || [];
      if (!header) return [];
      
      return rows.map(row => 
        Object.fromEntries(header.map((h, i) => [h, row[i] || '']))
      );
    } catch (error) {
      console.error('Error reading from sheets:', error);
      throw error;
    }
  }

  // Write data to sheet
  async writeToSheet(range, values) {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values }
      });
      
      console.log(`✅ Data written to sheet range: ${range}`);
    } catch (error) {
      console.error('Error writing to sheets:', error);
      throw error;
    }
  }

  async getData(range = 'A:Z') {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: range
      });

      return response.data.values || [];
    } catch (error) {
      console.error('Error reading from sheets:', error);
      throw error;
    }
  }

  async appendData(values, range = 'A:Z') {
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetId,
        range: range,
        valueInputOption: 'RAW',
        resource: {
          values: values
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error writing to sheets:', error);
      throw error;
    }
  }

  async updateData(values, range) {
    try {
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: range,
        valueInputOption: 'RAW',
        resource: {
          values: values
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error updating sheets:', error);
      throw error;
    }
  }
}
