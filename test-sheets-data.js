// Test script to check Google Sheets data
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// Use the same environment variables as the main app
const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: process.env.GOOGLE_SERVICE_PRIVATE_KEY,
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function checkSheetData() {
  try {
    console.log('🔍 Checking Google Sheets data...');
    console.log('Email exists:', !!ENV.GOOGLE_SERVICE_EMAIL);
    console.log('Private key exists:', !!ENV.GOOGLE_SERVICE_PRIVATE_KEY);
    console.log('Doc ID exists:', !!ENV.GOOGLE_SHEETS_DOC_ID);
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Missing environment variables');
      return;
    }
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📊 Total rows: ${rows.length}`);
    console.log(`📄 Columns:`, sheet.headerValues);
    
    if (rows.length === 0) {
      console.log('📭 No data in sheet');
      return;
    }
    
    // Check last 5 rows for issues
    console.log('\n📋 Last 5 rows:');
    const lastRows = rows.slice(-5);
    
    for (let i = 0; i < lastRows.length; i++) {
      const row = lastRows[i];
      const rowNum = rows.length - lastRows.length + i + 1;
      console.log(`\nRow ${rowNum}:`);
      console.log(`  Purchase ID: "${row.get('Purchase ID')}"`);
      console.log(`  Email: "${row.get('Email')}"`);
      console.log(`  Total Amount: "${row.get('Total Amount')}"`);
      console.log(`  Payment Count: "${row.get('Payment Count')}"`);
      console.log(`  Payment Intent IDs: "${row.get('Payment Intent IDs')}"`);
      console.log(`  GEO: "${row.get('GEO')}"`);
      console.log(`  Created: "${row.get('Created Local (UTC+1)')}"`);
      
      // Check for issues
      const geo = row.get('GEO') || '';
      const paymentCount = row.get('Payment Count') || '';
      const paymentIds = row.get('Payment Intent IDs') || '';
      
      if (geo.includes('Unknown') || geo === '') {
        console.log(`  ⚠️ GEO issue: "${geo}"`);
      }
      
      if (paymentCount && paymentIds) {
        const expectedCount = paymentIds.split(', ').length;
        const actualCount = parseInt(paymentCount);
        if (expectedCount !== actualCount) {
          console.log(`  ⚠️ Payment count mismatch: Expected ${expectedCount}, Got ${actualCount}`);
        }
      }
    }
    
    // Summary statistics
    let unknownGeoCount = 0;
    let totalAmount = 0;
    let totalPayments = 0;
    
    for (const row of rows) {
      const geo = row.get('GEO') || '';
      const amount = parseFloat(row.get('Total Amount') || '0');
      const count = parseInt(row.get('Payment Count') || '1');
      
      if (geo.includes('Unknown') || geo === '') {
        unknownGeoCount++;
      }
      
      totalAmount += amount;
      totalPayments += count;
    }
    
    console.log('\n📊 Summary:');
    console.log(`  Total rows: ${rows.length}`);
    console.log(`  Unknown GEO: ${unknownGeoCount} (${((unknownGeoCount/rows.length)*100).toFixed(1)}%)`);
    console.log(`  Total amount: $${totalAmount.toFixed(2)}`);
    console.log(`  Total payments: ${totalPayments}`);
    console.log(`  Average per row: $${(totalAmount/rows.length).toFixed(2)}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkSheetData();
