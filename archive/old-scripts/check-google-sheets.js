import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

async function checkGoogleSheets() {
  try {
    console.log('🔍 ПРОВЕРЯЮ GOOGLE SHEETS...');
    
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_EMAIL,
      key: process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📋 Всего строк в Google Sheets: ${rows.length}`);
    console.log('📄 Первые 5 строк:');
    
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const row = rows[i];
      console.log(`Row ${i + 1}:`);
      console.log(`  Purchase ID: "${row.get('purchase_id')}"`);
      console.log(`  Customer ID: "${row.get('customer_id')}"`);
      console.log(`  Email: "${row.get('email')}"`);
      console.log(`  Date: "${row.get('created_at')}"`);
      console.log(`  Amount: "${row.get('amount')}"`);
      console.log('---');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkGoogleSheets();
