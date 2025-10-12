import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function checkAllColumns() {
  try {
    console.log('📋 ПРОВЕРКА ВСЕХ КОЛОНОК И СТРУКТУРЫ');
    console.log('=====================================');
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    
    console.log('📋 Все колонки в таблице:');
    sheet.headerValues.forEach((header, index) => {
      console.log(`   ${index + 1}. "${header}"`);
    });
    
    console.log(`\n📊 Всего записей: ${rows.length}`);
    
    // Проверяем несколько записей на пустые поля
    console.log('\n🔍 ПРОВЕРКА ПУСТЫХ ПОЛЕЙ:');
    let emptyFieldsCount = 0;
    const emptyFields = {};
    
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      const email = row.get('Email');
      
      console.log(`\n📧 ${email}:`);
      
      for (const header of sheet.headerValues) {
        const value = row.get(header);
        if (!value || value === '' || value === 'undefined') {
          console.log(`   ❌ ${header}: "${value}"`);
          emptyFieldsCount++;
          if (!emptyFields[header]) emptyFields[header] = 0;
          emptyFields[header]++;
        } else {
          console.log(`   ✅ ${header}: "${value}"`);
        }
      }
    }
    
    console.log('\n📊 СТАТИСТИКА ПУСТЫХ ПОЛЕЙ:');
    console.log(`Всего пустых полей в первых 10 записях: ${emptyFieldsCount}`);
    
    Object.entries(emptyFields).forEach(([field, count]) => {
      console.log(`   ${field}: ${count} пустых`);
    });
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkAllColumns();
