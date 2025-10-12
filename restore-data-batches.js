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

async function restoreDataBatches() {
  try {
    console.log('🔄 ВОССТАНОВЛЕНИЕ ДАННЫХ МЕЛКИМИ ПАКЕТАМИ');
    console.log('==========================================');
    
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
    
    // Получаем все "Subscription creation" платежи
    console.log('📥 Получаем "Subscription creation" платежи...');
    const allPayments = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;
      
      const payments = await stripe.paymentIntents.list(params);
      
      // Фильтруем только "Subscription creation"
      const validPayments = payments.data.filter(p => {
        if (p.status !== 'succeeded' || !p.customer) return false;
        if (!p.description) return false;
        return p.description.toLowerCase().includes('subscription creation');
      });
      
      allPayments.push(...validPayments);
      
      hasMore = payments.has_more;
      if (hasMore) startingAfter = payments.data[payments.data.length - 1].id;
      
      console.log(`📥 Загружено ${allPayments.length} "Subscription creation" платежей...`);
      
      // Пауза между запросами
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ Всего найдено ${allPayments.length} "Subscription creation" платежей`);
    
    // Группируем по клиентам (берем только ПЕРВУЮ покупку каждого клиента)
    console.log('🔄 Группируем по клиентам...');
    const customerFirstPurchases = new Map();
    
    for (const payment of allPayments) {
      try {
        const customer = await stripe.customers.retrieve(payment.customer);
        if (customer && 'deleted' in customer && customer.deleted) continue;
        
        const customerId = customer?.id;
        const customerEmail = customer?.email;
        
        if (!customerId || !customerEmail) continue;
        
        // Если у нас еще нет записи для этого клиента, или эта покупка раньше
        if (!customerFirstPurchases.has(customerId) || 
            payment.created < customerFirstPurchases.get(customerId).created) {
          customerFirstPurchases.set(customerId, {
            payment,
            customer,
            email: customerEmail
          });
        }
        
      } catch (error) {
        console.error(`Ошибка получения клиента ${payment.customer}:`, error.message);
      }
      
      // Пауза между запросами
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`✅ Найдено ${customerFirstPurchases.size} уникальных клиентов с первыми покупками`);
    
    // Создаем данные для таблицы
    const tableData = [];
    
    for (const [customerId, data] of customerFirstPurchases) {
      const { payment, customer, email } = data;
      
      // Получаем метаданные клиента
      const country = customer.metadata?.country || 'N/A';
      const city = customer.metadata?.city || 'N/A';
      const utmSource = customer.metadata?.utm_source || 'N/A';
      const utmCampaign = customer.metadata?.utm_campaign || 'N/A';
      const utmMedium = customer.metadata?.utm_medium || 'N/A';
      const utmContent = customer.metadata?.utm_content || 'N/A';
      const utmTerm = customer.metadata?.utm_term || 'N/A';
      
      const purchaseData = {
        'Purchase ID': `purchase_${customerId}_${payment.created}`,
        'Payment Intent ID': payment.id,
        'Customer ID': customerId,
        'Email': email,
        'Total Amount': (payment.amount / 100).toFixed(2),
        'Currency': payment.currency.toUpperCase(),
        'Status': 'succeeded',
        'Created UTC': new Date(payment.created * 1000).toISOString(),
        'Created Local (UTC+1)': new Date(payment.created * 1000 + 60 * 60 * 1000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ' UTC+1'),
        'GEO': `${country}, ${city}`,
        'Country': country,
        'City': city,
        'Description': payment.description || 'Subscription creation',
        'UTM Source': utmSource,
        'UTM Campaign': utmCampaign,
        'UTM Medium': utmMedium,
        'UTM Content': utmContent,
        'UTM Term': utmTerm
      };
      
      tableData.push(purchaseData);
    }
    
    // Сортируем по дате создания (самые новые сверху)
    tableData.sort((a, b) => new Date(b['Created UTC']) - new Date(a['Created UTC']));
    
    console.log(`📝 Подготовлено ${tableData.length} записей для добавления в таблицу`);
    
    // Добавляем данные мелкими пакетами
    const batchSize = 50; // Добавляем по 50 записей за раз
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
        // Продолжаем с следующим пакетом
      }
    }
    
    console.log('==========================================');
    console.log('🎉 ВОССТАНОВЛЕНИЕ ДАННЫХ ЗАВЕРШЕНО!');
    console.log(`✅ Добавлено ${addedCount} записей первых покупок`);
    console.log(`🚫 Только "Subscription creation" платежи`);
    console.log(`🔄 Группировка работает корректно (1 клиент = 1 запись)`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

restoreDataBatches();
