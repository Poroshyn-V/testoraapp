import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

async function debugDuplicates() {
  console.log('🔍 ОТЛАДКА ДУБЛИКАТОВ - ПРОВЕРЯЕМ ДАННЫЕ');
  console.log('==========================================');

  try {
    // 1. ПРОВЕРЯЕМ GOOGLE SHEETS
    console.log('\n📋 1. ПРОВЕРЯЕМ GOOGLE SHEETS...');
    
    // Форматируем приватный ключ
    let privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY;
    if (privateKey && !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
      }
    }
    
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
    
    await doc.loadInfo();
    console.log(`✅ Google Sheets подключен: ${doc.title}`);
    
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    console.log(`✅ Заголовки загружены: ${sheet.headerValues.length} колонок`);
    
    const rows = await sheet.getRows();
    console.log(`📊 Всего строк в Google Sheets: ${rows.length}`);
    
    if (rows.length > 0) {
      console.log('\n📋 ПЕРВЫЕ 3 СТРОКИ ИЗ GOOGLE SHEETS:');
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        const row = rows[i];
        console.log(`Строка ${i + 1}:`);
        console.log(`  - customer_id: "${row.get('customer_id') || 'N/A'}"`);
        console.log(`  - created_at: "${row.get('created_at') || 'N/A'}"`);
        console.log(`  - email: "${row.get('email') || 'N/A'}"`);
        console.log(`  - purchase_id: "${row.get('purchase_id') || 'N/A'}"`);
        console.log('');
      }
      
      // Собираем существующие покупки
      const existingPurchases = new Set();
      for (const row of rows) {
        const customerId = row.get('customer_id') || '';
        const date = row.get('created_at') || '';
        const dateOnly = date.split('T')[0]; // YYYY-MM-DD
        if (customerId && dateOnly) {
          const key = `${customerId}_${dateOnly}`;
          existingPurchases.add(key);
        }
      }
      console.log(`📋 Найдено существующих покупок: ${existingPurchases.size}`);
      console.log('📋 Первые 5 ключей:', Array.from(existingPurchases).slice(0, 5));
    } else {
      console.log('⚠️ Google Sheets пустой!');
    }

    // 2. ПРОВЕРЯЕМ STRIPE
    console.log('\n💳 2. ПРОВЕРЯЕМ STRIPE...');
    
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const payments = await stripe.paymentIntents.list({
      created: { gte: sevenDaysAgo },
      limit: 10
    });
    
    console.log(`✅ Найдено платежей в Stripe: ${payments.data.length}`);
    
    if (payments.data.length > 0) {
      console.log('\n💳 ПЕРВЫЕ 3 ПЛАТЕЖА ИЗ STRIPE:');
      for (let i = 0; i < Math.min(3, payments.data.length); i++) {
        const payment = payments.data[i];
        const customer = payment.customer ? await stripe.customers.retrieve(payment.customer) : null;
        const date = new Date(payment.created * 1000).toISOString().split('T')[0];
        const customerId = customer?.id || 'unknown';
        const key = `${customerId}_${date}`;
        
        console.log(`Платеж ${i + 1}:`);
        console.log(`  - customer_id: "${customerId}"`);
        console.log(`  - created: "${date}"`);
        console.log(`  - email: "${customer?.email || 'N/A'}"`);
        console.log(`  - key: "${key}"`);
        console.log(`  - exists in Google Sheets: ${existingPurchases.has(key)}`);
        console.log('');
      }
    }

    // 3. СРАВНЕНИЕ
    console.log('\n🔄 3. СРАВНЕНИЕ ДАННЫХ...');
    
    if (rows.length === 0) {
      console.log('❌ Google Sheets пустой - все покупки будут добавлены как новые');
    } else {
      console.log('✅ Google Sheets содержит данные - проверка дубликатов должна работать');
    }

  } catch (error) {
    console.error('❌ ОШИБКА:', error.message);
    console.error('Детали:', error);
  }
}

debugDuplicates();
