import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function checkColumns() {
  try {
    console.log('📋 ПРОВЕРКА КОЛОНОК');
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    
    console.log('📋 Названия колонок:');
    console.log(sheet.headerValues);
    
    const rows = await sheet.getRows();
    if (rows.length > 0) {
      console.log('\n📋 Первая строка (все поля):');
      const firstRow = rows[0];
      for (const header of sheet.headerValues) {
        console.log(`   ${header}: "${firstRow.get(header)}"`);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkColumns();
