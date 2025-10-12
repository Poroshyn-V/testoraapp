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

async function fixAllData() {
  try {
    console.log('🔧 ИСПРАВЛЕНИЕ ВСЕХ ДАННЫХ');
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
    
    // 1. Удаляем дубликаты по Payment Intent IDs
    console.log('\n🔍 Поиск дубликатов по Payment Intent IDs...');
    const paymentIdMap = new Map();
    const duplicatesToDelete = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const paymentIds = row.get('Payment Intent IDs') || '';
      const email = row.get('Email') || '';
      
      if (paymentIds) {
        const paymentIdList = paymentIds.split(', ').filter(id => id.trim());
        
        for (const paymentId of paymentIdList) {
          if (paymentIdMap.has(paymentId)) {
            duplicatesToDelete.push({
              rowIndex: i,
              paymentId: paymentId,
              email: email
            });
            console.log(`❌ Дубликат найден: ${paymentId} (строка ${i + 1})`);
          } else {
            paymentIdMap.set(paymentId, i);
          }
        }
      }
    }
    
    console.log(`\n📋 Найдено дубликатов для удаления: ${duplicatesToDelete.length}`);
    
    if (duplicatesToDelete.length > 0) {
      const sortedDuplicates = duplicatesToDelete.sort((a, b) => b.rowIndex - a.rowIndex);
      
      console.log('🗑️ УДАЛЯЮ ДУБЛИКАТЫ...');
      
      let deletedCount = 0;
      for (const dup of sortedDuplicates) {
        try {
          console.log(`🗑️ Удаляю строку ${dup.rowIndex + 1} (${dup.paymentId})...`);
          const rowToDelete = rows[dup.rowIndex];
          if (rowToDelete) {
            await rowToDelete.delete();
            deletedCount++;
            console.log(`✅ Строка ${dup.rowIndex + 1} удалена`);
          }
        } catch (error) {
          console.error(`❌ Ошибка удаления строки ${dup.rowIndex + 1}:`, error.message);
        }
      }
      
      console.log(`\n🎉 УДАЛЕНИЕ ЗАВЕРШЕНО!`);
      console.log(`✅ Удалено дубликатов: ${deletedCount}`);
    } else {
      console.log('✅ Дубликатов не найдено!');
    }
    
    // 2. Получаем свежие данные из Stripe
    console.log('\n📊 Получаю свежие данные из Stripe...');
    const payments = await stripe.paymentIntents.list({
      limit: 1000
    });
    
    // Фильтруем ТОЛЬКО первые покупки (Subscription creation)
    const firstPurchases = payments.data.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      
      // Включаем ТОЛЬКО "Subscription creation" - первые покупки
      if (p.description && p.description.toLowerCase().includes('subscription creation')) {
        console.log(`✅ Первая покупка: ${p.id} - $${(p.amount / 100).toFixed(2)}`);
        return true;
      }
      
      return false;
    });
    
    console.log(`📊 Найдено ${firstPurchases.length} первых покупок (Subscription creation)`);
    
    // 3. Проверяем, какие покупки уже есть в таблице
    console.log('\n🔍 Проверяю существующие записи...');
    const existingPaymentIds = new Set();
    const existingEmails = new Set();
    const existingPurchaseIds = new Set();
    
    // Перезагружаем данные после удаления дубликатов
    const updatedRows = await sheet.getRows();
    
    for (const row of updatedRows) {
      const paymentIds = row.get('Payment Intent IDs') || '';
      const email = row.get('Email') || '';
      const purchaseId = row.get('Purchase ID') || '';
      
      if (paymentIds) {
        const paymentIdList = paymentIds.split(', ').filter(id => id.trim());
        paymentIdList.forEach(id => existingPaymentIds.add(id));
      }
      
      if (email) existingEmails.add(email.toLowerCase());
      if (purchaseId) existingPurchaseIds.add(purchaseId);
    }
    
    console.log(`📊 Существующих Payment IDs: ${existingPaymentIds.size}`);
    console.log(`📊 Существующих emails: ${existingEmails.size}`);
    console.log(`📊 Существующих Purchase IDs: ${existingPurchaseIds.size}`);
    
    // 4. Добавляем недостающие покупки
    console.log('\n➕ Добавляю недостающие покупки...');
    let addedCount = 0;
    
    for (const payment of firstPurchases) {
      if (payment.customer) {
        let customer = null;
        try {
          customer = await stripe.customers.retrieve(payment.customer);
          if (customer && 'deleted' in customer && customer.deleted) {
            console.log(`⏭️ Skipping deleted customer: ${payment.customer}`);
            continue;
          }
        } catch (err) {
          console.error(`Error retrieving customer ${payment.customer}:`, err);
        }

        const customerId = customer?.id || 'unknown_customer';
        const email = customer?.email || '';
        const purchaseId = `purchase_${customerId}_${payment.created}`;
        
        // Проверяем, есть ли уже эта покупка
        if (existingPaymentIds.has(payment.id) || 
            (email && existingEmails.has(email.toLowerCase())) ||
            existingPurchaseIds.has(purchaseId)) {
          console.log(`⏭️ Покупка уже существует: ${payment.id}`);
          continue;
        }
        
        // Добавляем новую покупку
        try {
          const m = { ...payment.metadata, ...(customer?.metadata || {}) };
          
          // Формируем GEO данные правильно
          const country = m.country || '';
          const city = m.city || '';
          const geo = country && city ? `${country}, ${city}` : (m.geo || '');
          
          const purchaseData = {
            'Purchase ID': purchaseId,
            'Customer ID': customerId,
            'Email': email,
            'Amount': `$${(payment.amount / 100).toFixed(2)} USD`,
            'Payment Intent IDs': payment.id,
            'Created UTC': new Date(payment.created * 1000).toISOString(),
            'Created Local (UTC+1)': new Date((payment.created * 1000) + (60 * 60 * 1000)).toISOString() + ' UTC+1',
            'Country': country,
            'City': city,
            'GEO': geo,
            'UTM Source': m.utm_source || '',
            'UTM Medium': m.utm_medium || '',
            'UTM Campaign': m.utm_campaign || '',
            'UTM Term': m.utm_term || '',
            'UTM Content': m.utm_content || '',
            'Ad Name': m.ad_name || '',
            'Adset Name': m.adset_name || '',
            'Campaign Name': m.campaign_name || ''
          };
          
          await sheet.addRow(purchaseData);
          addedCount++;
          console.log(`✅ Добавлена покупка: ${payment.id} - ${email}`);
          
        } catch (error) {
          console.error(`❌ Ошибка добавления покупки ${payment.id}:`, error.message);
        }
      }
    }
    
    console.log(`\n🎉 ИСПРАВЛЕНИЕ ЗАВЕРШЕНО!`);
    console.log(`✅ Удалено дубликатов: ${duplicatesToDelete.length}`);
    console.log(`✅ Добавлено новых покупок: ${addedCount}`);
    console.log(`📊 Итого записей в таблице: ${updatedRows.length + addedCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка исправления данных:', error.message);
  }
}

console.log('🚀 Запуск исправления всех данных...');
fixAllData();
