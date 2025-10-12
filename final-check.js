import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function finalCheck() {
  try {
    console.log('✅ ФИНАЛЬНАЯ ПРОВЕРКА');
    
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
    
    const targetEmails = ['silentrocktree@gmail.com', 'emond68@gmail.com'];
    
    for (const email of targetEmails) {
      const row = rows.find(r => r.get('Email') === email);
      if (!row) {
        console.log(`❌ Не найдена запись для: ${email}`);
        continue;
      }
      
      console.log(`\n📧 ${email}:`);
      console.log(`   Total Amount: "${row.get('Total Amount')}"`);
      console.log(`   Status: "${row.get('Status')}"`);
      console.log(`   GEO: "${row.get('GEO')}"`);
      console.log(`   Currency: "${row.get('Currency')}"`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

finalCheck();
