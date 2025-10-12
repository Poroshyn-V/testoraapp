import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function fillCorrect() {
  try {
    console.log('✏️ ЗАПОЛНЕНИЕ ПРАВИЛЬНЫХ ПОЛЕЙ');
    
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
    
    // Данные для заполнения (используем правильные названия колонок)
    const dataToFill = {
      'silentrocktree@gmail.com': {
        'Total Amount': '9.99',
        'GEO': 'US, Salem'
      },
      'emond68@gmail.com': {
        'Total Amount': '9.99',
        'GEO': 'US, Burbank'
      }
    };
    
    for (const [email, data] of Object.entries(dataToFill)) {
      const row = rows.find(r => r.get('Email') === email);
      if (!row) {
        console.log(`❌ Не найдена запись для: ${email}`);
        continue;
      }
      
      console.log(`\n✏️ Заполняю: ${email}`);
      
      for (const [field, value] of Object.entries(data)) {
        row.set(field, value);
        console.log(`   ${field}: ${value}`);
      }
      
      await row.save();
      console.log(`✅ Сохранено: ${email}`);
    }
    
    console.log('\n🎉 ГОТОВО!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

fillCorrect();
