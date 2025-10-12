import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

async function checkSheetsFormat() {
  try {
    console.log('🔍 Проверяю формат purchase_id в Google Sheets...');
    
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
      const purchaseId = row.get('purchase_id');
      const email = row.get('email');
      const amount = row.get('amount');
      console.log(`${i + 1}. purchase_id: "${purchaseId}" | email: "${email}" | amount: "${amount}"`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkSheetsFormat();
