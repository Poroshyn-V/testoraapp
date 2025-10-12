// Script to check current Google Sheets data
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: process.env.GOOGLE_SERVICE_PRIVATE_KEY,
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function checkSheetData() {
  try {
    console.log('🔍 Checking current Google Sheets data...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets not configured');
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
    console.log(`📄 Available columns:`, sheet.headerValues);
    
    // Check last 10 rows
    console.log('\n📋 Last 10 rows:');
    const lastRows = rows.slice(-10);
    
    for (let i = 0; i < lastRows.length; i++) {
      const row = lastRows[i];
      console.log(`\nRow ${rows.length - lastRows.length + i + 1}:`);
      console.log(`  Purchase ID: "${row.get('Purchase ID')}"`);
      console.log(`  Email: "${row.get('Email')}"`);
      console.log(`  Total Amount: "${row.get('Total Amount')}"`);
      console.log(`  Payment Count: "${row.get('Payment Count')}"`);
      console.log(`  Payment Intent IDs: "${row.get('Payment Intent IDs')}"`);
      console.log(`  GEO: "${row.get('GEO')}"`);
      console.log(`  Created Local: "${row.get('Created Local (UTC+1)')}"`);
    }
    
    // Check for issues
    console.log('\n🔍 Checking for issues:');
    
    let unknownGeoCount = 0;
    let incorrectSumsCount = 0;
    let duplicateEmails = new Map();
    
    for (const row of rows) {
      const geo = row.get('GEO') || '';
      const email = row.get('Email') || '';
      const totalAmount = row.get('Total Amount') || '';
      const paymentCount = row.get('Payment Count') || '';
      const paymentIds = row.get('Payment Intent IDs') || '';
      
      // Check GEO issues
      if (geo.includes('Unknown') || geo === '') {
        unknownGeoCount++;
      }
      
      // Check for duplicate emails
      if (email && email !== 'N/A') {
        duplicateEmails.set(email, (duplicateEmails.get(email) || 0) + 1);
      }
      
      // Check for potential sum issues
      if (paymentCount && paymentIds) {
        const expectedPaymentCount = paymentIds.split(', ').length;
        const actualPaymentCount = parseInt(paymentCount);
        if (expectedPaymentCount !== actualPaymentCount) {
          incorrectSumsCount++;
          console.log(`⚠️ Payment count mismatch: ${email} - Expected: ${expectedPaymentCount}, Actual: ${actualPaymentCount}`);
        }
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  Unknown GEO entries: ${unknownGeoCount}`);
    console.log(`  Incorrect payment counts: ${incorrectSumsCount}`);
    
    // Show duplicate emails
    const duplicates = Array.from(duplicateEmails.entries()).filter(([email, count]) => count > 1);
    if (duplicates.length > 0) {
      console.log(`  Duplicate emails: ${duplicates.length}`);
      duplicates.slice(0, 5).forEach(([email, count]) => {
        console.log(`    ${email}: ${count} entries`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking sheet data:', error.message);
  }
}

checkSheetData();
