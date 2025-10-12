import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function checkBotMapping() {
  try {
    console.log('🔍 ПРОВЕРКА СООТВЕТСТВИЯ КОДА БОТА И ТАБЛИЦЫ');
    console.log('==============================================');
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    
    // Названия колонок в таблице
    const actualColumns = sheet.headerValues;
    console.log('📋 Колонки в таблице:');
    actualColumns.forEach((col, i) => console.log(`   ${i + 1}. "${col}"`));
    
    // Названия колонок, которые использует бот (из кода)
    const botColumns = [
      'Purchase ID',
      'Payment Intent IDs', 
      'Total Amount',
      'Currency',
      'Status',
      'Created UTC',
      'Created Local (UTC+1)',
      'Customer ID',
      'Email',
      'GEO',
      'UTM Source',
      'UTM Medium',
      'UTM Campaign',
      'UTM Content',
      'UTM Term',
      'Ad Name',
      'Adset Name',
      'Payment Count'
    ];
    
    console.log('\n🤖 Колонки, которые использует бот:');
    botColumns.forEach((col, i) => console.log(`   ${i + 1}. "${col}"`));
    
    // Проверяем соответствие
    console.log('\n✅ ПРОВЕРКА СООТВЕТСТВИЯ:');
    let allMatch = true;
    
    for (const botCol of botColumns) {
      if (actualColumns.includes(botCol)) {
        console.log(`   ✅ "${botCol}" - найдена в таблице`);
      } else {
        console.log(`   ❌ "${botCol}" - НЕ найдена в таблице!`);
        allMatch = false;
      }
    }
    
    // Проверяем лишние колонки в таблице
    console.log('\n🔍 ДОПОЛНИТЕЛЬНЫЕ КОЛОНКИ В ТАБЛИЦЕ:');
    for (const actualCol of actualColumns) {
      if (!botColumns.includes(actualCol)) {
        console.log(`   ⚠️ "${actualCol}" - есть в таблице, но бот не использует`);
      }
    }
    
    if (allMatch) {
      console.log('\n🎉 ВСЕ КОЛОНКИ СООТВЕТСТВУЮТ!');
    } else {
      console.log('\n❌ ЕСТЬ НЕСООТВЕТСТВИЯ!');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkBotMapping();
