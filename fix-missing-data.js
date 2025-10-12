import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

// Load environment variables
config();

// Environment variables
const ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function fixMissingData() {
  try {
    console.log('🔧 ИСПРАВЛЕНИЕ НЕДОСТАЮЩИХ ДАННЫХ');
    console.log('==================================');
    
    // Initialize Stripe
    const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
    
    // Initialize Google Sheets
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    console.log(`✅ Google Sheets подключен: ${doc.title}`);
    
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    console.log(`📋 Всего записей в таблице: ${rows.length}`);
    
    // Ищем записи с пустыми Amount или GEO
    const recordsToFix = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const amount = row.get('Amount') || '';
      const geo = row.get('GEO') || '';
      const paymentIds = row.get('Payment Intent IDs') || '';
      
      if ((!amount || amount.trim() === '') || (!geo || geo.trim() === '')) {
        recordsToFix.push({
          rowIndex: i,
          row: row,
          paymentIds: paymentIds,
          currentAmount: amount,
          currentGeo: geo
        });
        console.log(`❌ Найдена запись с недостающими данными: строка ${i + 1}, Payment IDs: ${paymentIds}`);
      }
    }
    
    console.log(`\n📋 Найдено записей для исправления: ${recordsToFix.length}`);
    
    if (recordsToFix.length === 0) {
      console.log('✅ Все записи имеют полные данные!');
      return;
    }
    
    // Исправляем каждую запись
    let fixedCount = 0;
    
    for (const record of recordsToFix) {
      try {
        const paymentIds = record.paymentIds.split(', ').filter(id => id.trim());
        
        if (paymentIds.length === 0) {
          console.log(`⏭️ Пропускаю строку ${record.rowIndex + 1} - нет Payment IDs`);
          continue;
        }
        
        // Получаем данные из Stripe по первому Payment ID
        const paymentId = paymentIds[0];
        const payment = await stripe.paymentIntents.retrieve(paymentId);
        
        if (!payment || payment.status !== 'succeeded') {
          console.log(`⏭️ Пропускаю строку ${record.rowIndex + 1} - платеж не найден или не успешен`);
          continue;
        }
        
        // Получаем данные клиента
        let customer = null;
        if (payment.customer) {
          try {
            customer = await stripe.customers.retrieve(payment.customer);
            if (customer && 'deleted' in customer && customer.deleted) {
              customer = null;
            }
          } catch (err) {
            console.error(`Error retrieving customer ${payment.customer}:`, err);
          }
        }
        
        const m = { ...payment.metadata, ...(customer?.metadata || {}) };
        
        // Формируем правильные данные
        const amount = `$${(payment.amount / 100).toFixed(2)} USD`;
        const country = m.country || '';
        const city = m.city || '';
        const geo = country && city ? `${country}, ${city}` : (m.geo || '');
        
        // Обновляем запись
        const updates = {};
        if (!record.currentAmount || record.currentAmount.trim() === '') {
          updates['Amount'] = amount;
        }
        if (!record.currentGeo || record.currentGeo.trim() === '') {
          updates['GEO'] = geo;
          updates['Country'] = country;
          updates['City'] = city;
        }
        
        if (Object.keys(updates).length > 0) {
          for (const [key, value] of Object.entries(updates)) {
            record.row.set(key, value);
          }
          await record.row.save();
          
          fixedCount++;
          console.log(`✅ Исправлена строка ${record.rowIndex + 1}: ${Object.keys(updates).join(', ')}`);
        }
        
      } catch (error) {
        console.error(`❌ Ошибка исправления строки ${record.rowIndex + 1}:`, error.message);
      }
    }
    
    console.log(`\n🎉 ИСПРАВЛЕНИЕ ЗАВЕРШЕНО!`);
    console.log(`✅ Исправлено записей: ${fixedCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка исправления данных:', error.message);
  }
}

console.log('🚀 Запуск исправления недостающих данных...');
fixMissingData();
