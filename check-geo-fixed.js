import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function checkGeoFixed() {
  try {
    console.log('🔍 ПРОВЕРКА ИСПРАВЛЕННЫХ GEO ДАННЫХ');
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
    
    console.log(`📊 Всего записей: ${rows.length}`);
    
    let unknownCount = 0;
    let fixedCount = 0;
    let sampleFixed = [];
    let sampleUnknown = [];
    
    for (const row of rows) {
      const geo = row.get('GEO');
      const email = row.get('Email');
      
      if (geo === 'Unknown, Unknown') {
        unknownCount++;
        if (sampleUnknown.length < 5) {
          sampleUnknown.push({ email, geo });
        }
      } else {
        fixedCount++;
        if (sampleFixed.length < 10) {
          sampleFixed.push({ email, geo });
        }
      }
    }
    
    console.log('=====================================');
    console.log(`✅ Исправлено GEO: ${fixedCount}`);
    console.log(`❌ Осталось Unknown: ${unknownCount}`);
    console.log(`📈 Процент исправления: ${((fixedCount / rows.length) * 100).toFixed(1)}%`);
    
    console.log('\n🌍 ПРИМЕРЫ ИСПРАВЛЕННЫХ GEO:');
    sampleFixed.forEach((item, i) => {
      console.log(`${i + 1}. ${item.email} → ${item.geo}`);
    });
    
    if (sampleUnknown.length > 0) {
      console.log('\n❓ ПРИМЕРЫ НЕИСПРАВЛЕННЫХ:');
      sampleUnknown.forEach((item, i) => {
        console.log(`${i + 1}. ${item.email} → ${item.geo}`);
      });
    }
    
    console.log('\n=====================================');
    console.log('🎉 ПРОВЕРКА ЗАВЕРШЕНА!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkGeoFixed();
