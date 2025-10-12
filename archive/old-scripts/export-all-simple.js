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

async function exportAllSimple() {
  try {
    console.log('🚀 ПРОСТАЯ ВЫГРУЗКА ВСЕХ ПОКУПОК');
    console.log('==================================');
    
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
    
    // Фильтруем только успешные платежи
    const validPayments = allPayments.filter(p => {
      return p.status === 'succeeded' && p.customer;
    });
    
    console.log(`✅ Найдено ${validPayments.length} успешных платежей`);
    
    // Находим первую покупку каждого клиента
    const customerFirstPurchase = new Map();
    
    for (const payment of validPayments) {
      const customerId = payment.customer;
      
      if (!customerFirstPurchase.has(customerId) || 
          payment.created < customerFirstPurchase.get(customerId).created) {
        customerFirstPurchase.set(customerId, payment);
      }
    }
    
    console.log(`✅ Найдено ${customerFirstPurchase.size} уникальных клиентов`);
    
    // Получаем данные клиентов
    console.log('👥 Получаем данные клиентов...');
    const customerData = new Map();
    const customerIds = Array.from(customerFirstPurchase.keys());
    
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
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`✅ Получены данные ${customerData.size} клиентов`);
    
    // Создаем данные для таблицы
    const tableData = [];
    
    for (const [customerId, firstPayment] of customerFirstPurchase) {
      const customer = customerData.get(customerId);
      if (!customer) continue;
      
      // Получаем GEO данные
      const country = customer.metadata?.country || customer.address?.country || 'Unknown';
      const city = customer.metadata?.city || customer.address?.city || 'Unknown';
      
      const purchaseData = {
        'Payment Intent IDs': firstPayment.id,
        'Purchase ID': `purchase_${customerId}_${firstPayment.created}`,
        'Total Amount': (firstPayment.amount / 100).toFixed(2),
        'Currency': firstPayment.currency.toUpperCase(),
        'Status': 'succeeded',
        'Created UTC': new Date(firstPayment.created * 1000).toISOString(),
        'Created Local (UTC+1)': new Date(firstPayment.created * 1000 + 60 * 60 * 1000)
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
    
    // Сортируем по дате первой покупки (самые новые сверху)
    tableData.sort((a, b) => new Date(b['Created UTC']) - new Date(a['Created UTC']));
    
    console.log(`📝 Подготовлено ${tableData.length} записей для добавления в таблицу`);
    
    // Добавляем данные
    if (tableData.length > 0) {
      console.log('📝 Добавляем данные в таблицу...');
      await sheet.addRows(tableData);
      console.log(`✅ Успешно добавлено ${tableData.length} записей`);
    }
    
    console.log('==================================');
    console.log('🎉 ВЫГРУЗКА ЗАВЕРШЕНА!');
    console.log(`✅ Добавлено ${tableData.length} записей`);
    console.log(`📅 Все даты - это даты ПЕРВЫХ покупок`);
    console.log(`💳 Payment Intent IDs сохранены`);
    console.log(`🌍 GEO данные заполнены`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

exportAllSimple();
