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

async function finalCleanup() {
  try {
    console.log('🧹 ФИНАЛЬНАЯ ОЧИСТКА ТАБЛИЦЫ');
    console.log('============================');
    
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
    
    // 1. Удаляем записи с "Subscription update"
    console.log('\n🗑️ Удаляем записи с "Subscription update"...');
    const rowsToDelete = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const description = row.get('Description') || '';
      
      if (description.toLowerCase().includes('subscription update')) {
        rowsToDelete.push({
          rowIndex: i,
          row: row,
          email: row.get('Email') || '',
          description: description
        });
        console.log(`❌ Найдена запись "Subscription update": ${row.get('Email')} - ${description}`);
      }
    }
    
    console.log(`\n📋 Найдено записей "Subscription update" для удаления: ${rowsToDelete.length}`);
    
    // Удаляем записи с "Subscription update" (с конца, чтобы индексы не сбились)
    let deletedCount = 0;
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      try {
        const record = rowsToDelete[i];
        await record.row.delete();
        deletedCount++;
        console.log(`✅ Удалена запись "Subscription update": ${record.email}`);
      } catch (error) {
        console.error(`❌ Ошибка удаления записи:`, error.message);
      }
    }
    
    console.log(`✅ Удалено записей "Subscription update": ${deletedCount}`);
    
    // 2. Исправляем оставшиеся записи с пустыми полями
    console.log('\n🔧 Исправляем оставшиеся записи с пустыми полями...');
    
    // Перезагружаем строки после удаления
    const updatedRows = await sheet.getRows();
    console.log(`📋 Записей после удаления: ${updatedRows.length}`);
    
    const recordsToFix = [];
    
    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      const amount = row.get('Amount') || '';
      const geo = row.get('GEO') || '';
      const status = row.get('Status') || '';
      const paymentIds = row.get('Payment Intent IDs') || '';
      const email = row.get('Email') || '';
      
      if ((!amount || amount.trim() === '') || (!geo || geo.trim() === '') || (!status || status.trim() === '')) {
        recordsToFix.push({
          rowIndex: i,
          row: row,
          paymentIds: paymentIds,
          email: email,
          currentAmount: amount,
          currentGeo: geo,
          currentStatus: status
        });
        console.log(`❌ Найдена запись с недостающими данными: ${email} - Payment IDs: ${paymentIds}`);
      }
    }
    
    console.log(`\n📋 Найдено записей для исправления: ${recordsToFix.length}`);
    
    // Исправляем каждую запись
    let fixedCount = 0;
    
    for (let i = 0; i < recordsToFix.length; i++) {
      const record = recordsToFix[i];
      
      try {
        // Добавляем задержку каждые 5 записей
        if (i > 0 && i % 5 === 0) {
          console.log(`⏳ Пауза 3 секунды для избежания лимитов API...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        const paymentIds = record.paymentIds.split(', ').filter(id => id.trim());
        
        if (paymentIds.length === 0) {
          console.log(`⏭️ Пропускаю запись ${record.email} - нет Payment IDs`);
          continue;
        }
        
        // Получаем данные из Stripe по первому Payment ID
        const paymentId = paymentIds[0];
        const payment = await stripe.paymentIntents.retrieve(paymentId);
        
        if (!payment || payment.status !== 'succeeded') {
          console.log(`⏭️ Пропускаю запись ${record.email} - платеж не найден или не успешен`);
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
        const status = payment.status;
        
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
        if (!record.currentStatus || record.currentStatus.trim() === '') {
          updates['Status'] = status;
        }
        
        if (Object.keys(updates).length > 0) {
          for (const [key, value] of Object.entries(updates)) {
            record.row.set(key, value);
          }
          await record.row.save();
          
          fixedCount++;
          console.log(`✅ Исправлена запись ${record.email}: ${Object.keys(updates).join(', ')}`);
        }
        
      } catch (error) {
        if (error.message.includes('Quota exceeded')) {
          console.log(`⏳ Лимит API превышен, ждем 10 секунд...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          i--; // Повторяем эту запись
        } else {
          console.error(`❌ Ошибка исправления записи ${record.email}:`, error.message);
        }
      }
    }
    
    console.log(`\n🎉 ФИНАЛЬНАЯ ОЧИСТКА ЗАВЕРШЕНА!`);
    console.log(`✅ Удалено записей "Subscription update": ${deletedCount}`);
    console.log(`✅ Исправлено записей с недостающими данными: ${fixedCount}`);
    console.log(`📊 Итого записей в таблице: ${updatedRows.length - deletedCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка финальной очистки:', error.message);
  }
}

console.log('🚀 Запуск финальной очистки таблицы...');
finalCleanup();
