import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function checkRecentRecords() {
  try {
    console.log('🔍 ПРОВЕРКА ПОСЛЕДНИХ ЗАПИСЕЙ');
    console.log('==============================');
    
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
    
    console.log(`📊 Всего записей: ${rows.length}`);
    
    // Проверяем последние 20 записей
    const recentRows = rows.slice(-20);
    console.log(`\n🔍 Проверяем последние ${recentRows.length} записей:`);
    
    let emptyFieldsCount = 0;
    const emptyFields = {};
    
    for (let i = 0; i < recentRows.length; i++) {
      const row = recentRows[i];
      const email = row.get('Email');
      const created = row.get('Created UTC');
      
      console.log(`\n📧 ${email} (${created}):`);
      
      // Проверяем ключевые поля
      const keyFields = ['Total Amount', 'Currency', 'Status', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign'];
      
      for (const field of keyFields) {
        const value = row.get(field);
        if (!value || value === '' || value === 'undefined' || value === 'N/A') {
          console.log(`   ❌ ${field}: "${value}"`);
          emptyFieldsCount++;
          if (!emptyFields[field]) emptyFields[field] = 0;
          emptyFields[field]++;
        } else {
          console.log(`   ✅ ${field}: "${value}"`);
        }
      }
    }
    
    console.log('\n📊 СТАТИСТИКА ПУСТЫХ ПОЛЕЙ В ПОСЛЕДНИХ ЗАПИСЯХ:');
    console.log(`Всего пустых полей: ${emptyFieldsCount}`);
    
    if (Object.keys(emptyFields).length > 0) {
      console.log('\nПроблемные поля:');
      Object.entries(emptyFields).forEach(([field, count]) => {
        console.log(`   ${field}: ${count} пустых`);
      });
    } else {
      console.log('✅ Все ключевые поля заполнены!');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkRecentRecords();
