import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function fixFirstPurchaseData() {
  try {
    console.log('🔧 ИСПРАВЛЕНИЕ ДАННЫХ ПЕРВОЙ ПОКУПКИ');
    console.log('=====================================');
    
    const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
    
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
    
    let fixedCount = 0;
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const email = row.get('Email');
      const paymentIds = row.get('Payment Intent IDs') || '';
      
      if (!paymentIds) continue;
      
      console.log(`\n🔍 Проверяю: ${email}`);
      
      try {
        // Получаем все платежи для этого клиента
        const paymentIdList = paymentIds.split(', ').filter(id => id.trim());
        const payments = [];
        
        for (const paymentId of paymentIdList) {
          const payment = await stripe.paymentIntents.retrieve(paymentId);
          if (payment && payment.status === 'succeeded') {
            payments.push(payment);
          }
        }
        
        if (payments.length === 0) continue;
        
        // Сортируем по дате создания (самый старый = первая покупка)
        payments.sort((a, b) => a.created - b.created);
        
        // Находим первую покупку (Subscription creation)
        let firstPurchase = null;
        for (const payment of payments) {
          if (payment.description && payment.description.toLowerCase().includes('subscription creation')) {
            firstPurchase = payment;
            break;
          }
        }
        
        // Если не нашли Subscription creation, берем самый первый платеж
        if (!firstPurchase) {
          firstPurchase = payments[0];
        }
        
        console.log(`   Первая покупка: ${firstPurchase.id} - $${(firstPurchase.amount / 100).toFixed(2)} - ${firstPurchase.description}`);
        
        // Проверяем, нужно ли исправлять
        const currentAmount = row.get('Total Amount');
        const currentCreatedUtc = row.get('Created UTC');
        const currentCreatedLocal = row.get('Created Local (UTC+1)');
        
        const correctAmount = (firstPurchase.amount / 100).toFixed(2);
        const correctCreatedUtc = new Date(firstPurchase.created * 1000).toISOString();
        const correctCreatedLocal = new Date(firstPurchase.created * 1000 + 60 * 60 * 1000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ' UTC+1');
        
        let needsUpdate = false;
        
        if (currentAmount !== correctAmount) {
          console.log(`   ❌ Amount: ${currentAmount} → ${correctAmount}`);
          needsUpdate = true;
        }
        
        if (currentCreatedUtc !== correctCreatedUtc) {
          console.log(`   ❌ Created UTC: ${currentCreatedUtc} → ${correctCreatedUtc}`);
          needsUpdate = true;
        }
        
        if (currentCreatedLocal !== correctCreatedLocal) {
          console.log(`   ❌ Created Local: ${currentCreatedLocal} → ${correctCreatedLocal}`);
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          row.set('Total Amount', correctAmount);
          row.set('Created UTC', correctCreatedUtc);
          row.set('Created Local (UTC+1)', correctCreatedLocal);
          
          await row.save();
          fixedCount++;
          console.log(`   ✅ Исправлено: ${email}`);
        } else {
          console.log(`   ✅ Уже правильно: ${email}`);
        }
        
        // Пауза для избежания лимитов API
        if (i % 10 === 0 && i > 0) {
          console.log(`⏳ Пауза 2 секунды...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`   ❌ Ошибка для ${email}:`, error.message);
      }
    }
    
    console.log(`\n🎉 ИСПРАВЛЕНИЕ ЗАВЕРШЕНО!`);
    console.log(`✅ Исправлено записей: ${fixedCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

fixFirstPurchaseData();
