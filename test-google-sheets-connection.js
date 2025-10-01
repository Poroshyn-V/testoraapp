import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

async function testGoogleSheets() {
  try {
    console.log('🔍 Проверяем подключение к Google Sheets...\n');
    
    if (!process.env.GOOGLE_SHEETS_DOC_ID) {
      console.error('❌ GOOGLE_SHEETS_DOC_ID не задан!');
      return;
    }
    
    if (!process.env.GOOGLE_SERVICE_EMAIL) {
      console.error('❌ GOOGLE_SERVICE_EMAIL не задан!');
      return;
    }
    
    if (!process.env.GOOGLE_SERVICE_PRIVATE_KEY) {
      console.error('❌ GOOGLE_SERVICE_PRIVATE_KEY не задан!');
      return;
    }
    
    console.log('✅ Переменные окружения найдены');
    console.log(`📋 Doc ID: ${process.env.GOOGLE_SHEETS_DOC_ID}`);
    console.log(`📧 Service Email: ${process.env.GOOGLE_SERVICE_EMAIL}`);
    console.log('');
    
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_EMAIL,
      key: process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    
    console.log('🔄 Загружаем информацию о таблице...');
    await doc.loadInfo();
    
    console.log(`✅ Таблица: ${doc.title}`);
    console.log(`📊 Листов: ${doc.sheetCount}`);
    console.log('');
    
    // Ищем лист payments
    let sheet = doc.sheetsByTitle['payments'];
    if (!sheet) {
      console.log('⚠️  Лист "payments" не найден. Доступные листы:');
      doc.sheetsByIndex.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.title}`);
      });
    } else {
      console.log('✅ Лист "payments" найден');
      await sheet.loadHeaderRow();
      console.log(`📋 Заголовки: ${sheet.headerValues.join(', ')}`);
      
      const rows = await sheet.getRows();
      console.log(`📊 Всего строк: ${rows.length}`);
      
      if (rows.length > 0) {
        console.log('');
        console.log('🔍 Последние 3 записи:');
        rows.slice(-3).forEach((row, i) => {
          console.log(`  ${rows.length - 2 + i}. ${row.get('session_id')} - ${row.get('email')}`);
        });
      }
    }
    
    console.log('');
    console.log('✅ Подключение к Google Sheets работает!');
    
  } catch (error) {
    console.error('❌ ОШИБКА:', error.message);
    console.error('');
    console.error('Детали:', error);
  }
}

testGoogleSheets();
