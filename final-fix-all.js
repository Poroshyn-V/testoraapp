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

async function finalFixAll() {
  try {
    console.log('🚀 ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ ВСЕГО');
    console.log('===============================');
    
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
    
    // Получаем все записи
    let rows = await sheet.getRows();
    console.log(`📊 Найдено ${rows.length} записей`);
    
    // Шаг 1: Очищаем таблицу полностью
    console.log('🗑️ Очищаем таблицу...');
    await sheet.clearRows();
    
    // Шаг 2: Получаем ВСЕ платежи из Stripe
    console.log('📥 Получаем все платежи из Stripe...');
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
    
    // Шаг 3: Фильтруем ТОЛЬКО "Subscription creation" и успешные
    const validPayments = allPayments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      
      // Получаем описание из payment.description
      if (!p.description) return false;
      
      return p.description.toLowerCase().includes('subscription creation');
    });
    
    console.log(`✅ Найдено ${validPayments.length} "Subscription creation" платежей`);
    
    // Шаг 4: Группируем по клиентам (берем только ПЕРВУЮ покупку каждого клиента)
    const customerFirstPurchases = new Map();
    
    for (const payment of validPayments) {
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
    }
    
    console.log(`✅ Найдено ${customerFirstPurchases.size} уникальных клиентов с первыми покупками`);
    
    // Шаг 5: Создаем данные для таблицы
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
    
    // Шаг 6: Сортируем по дате создания (самые новые сверху)
    tableData.sort((a, b) => new Date(b['Created UTC']) - new Date(a['Created UTC']));
    
    console.log(`📝 Подготовлено ${tableData.length} записей для добавления в таблицу`);
    
    // Шаг 7: Добавляем данные в таблицу
    if (tableData.length > 0) {
      console.log('📝 Добавляем данные в таблицу...');
      await sheet.addRows(tableData);
      console.log(`✅ Успешно добавлено ${tableData.length} записей`);
    }
    
    console.log('===============================');
    console.log('🎉 ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО!');
    console.log(`✅ Таблица очищена и заполнена корректными данными`);
    console.log(`📊 Добавлено ${tableData.length} записей первых покупок`);
    console.log(`🚫 Удалены все "Subscription update" записи`);
    console.log(`🔄 Группировка работает корректно (1 клиент = 1 запись)`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

finalFixAll();
