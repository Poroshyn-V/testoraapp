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

async function fastRestore() {
  try {
    console.log('⚡ БЫСТРОЕ ВОССТАНОВЛЕНИЕ');
    console.log('==========================');
    
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
    
    // Очищаем таблицу
    console.log('🗑️ Очищаем таблицу...');
    await sheet.clearRows();
    
    // Получаем ВСЕ платежи из Stripe
    console.log('📥 Получаем ВСЕ платежи из Stripe...');
    const allPayments = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;
      
      const payments = await stripe.paymentIntents.list(params);
      allPayments.push(...payments.data);
      
      hasMore = payments.has_more;
      if (hasMore) startingAfter = payments.data[payments.data.length - 1].id;
      
      console.log(`📥 Загружено ${allPayments.length} платежей...`);
    }
    
    console.log(`✅ Всего загружено ${allPayments.length} платежей из Stripe`);
    
    // Фильтруем ТОЛЬКО "Subscription creation" и успешные
    const validPayments = allPayments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (!p.description) return false;
      return p.description.toLowerCase().includes('subscription creation');
    });
    
    console.log(`✅ Найдено ${validPayments.length} "Subscription creation" платежей`);
    
    // БЫСТРАЯ группировка по клиентам (без дополнительных запросов к Stripe)
    const customerFirstPurchases = new Map();
    
    for (const payment of validPayments) {
      const customerId = payment.customer;
      
      // Если у нас еще нет записи для этого клиента, или эта покупка раньше
      if (!customerFirstPurchases.has(customerId) || 
          payment.created < customerFirstPurchases.get(customerId).created) {
        customerFirstPurchases.set(customerId, payment);
      }
    }
    
    console.log(`✅ Найдено ${customerFirstPurchases.size} уникальных клиентов с первыми покупками`);
    
    // Получаем данные клиентов пакетами
    console.log('👥 Получаем данные клиентов...');
    const customerData = new Map();
    const customerIds = Array.from(customerFirstPurchases.keys());
    
    // Обрабатываем клиентов пакетами по 50
    for (let i = 0; i < customerIds.length; i += 50) {
      const batch = customerIds.slice(i, i + 50);
      
      console.log(`👥 Обрабатываем клиентов ${i + 1}-${Math.min(i + 50, customerIds.length)}...`);
      
      for (const customerId of batch) {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer && !('deleted' in customer && customer.deleted)) {
            customerData.set(customerId, customer);
          }
        } catch (error) {
          console.error(`Ошибка получения клиента ${customerId}:`, error.message);
        }
      }
      
      // Пауза между пакетами
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`✅ Получены данные ${customerData.size} клиентов`);
    
    // Создаем данные для таблицы
    const tableData = [];
    
    for (const [customerId, payment] of customerFirstPurchases) {
      const customer = customerData.get(customerId);
      if (!customer) continue;
      
      // Получаем GEO данные
      const country = customer.metadata?.country || customer.address?.country || 'Unknown';
      const city = customer.metadata?.city || customer.address?.city || 'Unknown';
      
      const purchaseData = {
        'Payment Intent IDs': payment.id,
        'Purchase ID': `purchase_${customerId}_${payment.created}`,
        'Total Amount': (payment.amount / 100).toFixed(2),
        'Currency': payment.currency.toUpperCase(),
        'Status': 'succeeded',
        'Created UTC': new Date(payment.created * 1000).toISOString(),
        'Created Local (UTC+1)': new Date(payment.created * 1000 + 60 * 60 * 1000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ' UTC+1'),
        'Customer ID': customerId,
        'Email': customer.email || 'N/A',
        'GEO': `${country}, ${city}`,
        'UTM Source': customer.metadata?.utm_source || 'N/A',
        'UTM Medium': customer.metadata?.utm_medium || 'N/A',
        'UTM Campaign': customer.metadata?.utm_campaign || 'N/A',
        'UTM Content': customer.metadata?.utm_content || 'N/A',
        'UTM Term': customer.metadata?.utm_term || 'N/A',
        'Ad Name': customer.metadata?.ad_name || 'N/A',
        'Adset Name': customer.metadata?.adset_name || 'N/A',
        'Payment Count': '1'
      };
      
      tableData.push(purchaseData);
    }
    
    // Сортируем по дате создания (самые новые сверху)
    tableData.sort((a, b) => new Date(b['Created UTC']) - new Date(a['Created UTC']));
    
    console.log(`📝 Подготовлено ${tableData.length} записей для добавления в таблицу`);
    
    // Добавляем данные мелкими пакетами
    const batchSize = 50;
    let addedCount = 0;
    
    for (let i = 0; i < tableData.length; i += batchSize) {
      const batch = tableData.slice(i, i + batchSize);
      
      console.log(`📝 Добавляем пакет ${Math.floor(i/batchSize) + 1}/${Math.ceil(tableData.length/batchSize)} (${batch.length} записей)...`);
      
      try {
        await sheet.addRows(batch);
        addedCount += batch.length;
        console.log(`✅ Добавлено ${addedCount}/${tableData.length} записей`);
        
        // Пауза между пакетами
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Ошибка при добавлении пакета:`, error.message);
      }
    }
    
    console.log('==========================');
    console.log('🎉 ВОССТАНОВЛЕНИЕ ЗАВЕРШЕНО!');
    console.log(`✅ Добавлено ${addedCount} записей первых покупок`);
    console.log(`💳 Payment Intent IDs сохранены`);
    console.log(`🌍 GEO данные заполнены`);
    console.log(`🔄 Группировка работает (1 клиент = 1 запись)`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

fastRestore();
