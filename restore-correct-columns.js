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

async function restoreCorrectColumns() {
  try {
    console.log('🔄 ВОССТАНОВЛЕНИЕ С ПРАВИЛЬНЫМИ СТОЛБЦАМИ');
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
    
    // Получаем последние 100 "Subscription creation" платежей для начала
    console.log('📥 Получаем последние "Subscription creation" платежи...');
    const payments = await stripe.paymentIntents.list({ 
      limit: 100 
    });
    
    // Фильтруем только "Subscription creation"
    const validPayments = payments.data.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (!p.description) return false;
      return p.description.toLowerCase().includes('subscription creation');
    });
    
    console.log(`✅ Найдено ${validPayments.length} "Subscription creation" платежей`);
    
    // Группируем по клиентам (берем только ПЕРВУЮ покупку каждого клиента)
    console.log('🔄 Группируем по клиентам...');
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
      
      // Пауза между запросами
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`✅ Найдено ${customerFirstPurchases.size} уникальных клиентов с первыми покупками`);
    
    // Создаем данные для таблицы с ПРАВИЛЬНЫМИ названиями столбцов
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
      const adName = customer.metadata?.ad_name || 'N/A';
      const adsetName = customer.metadata?.adset_name || 'N/A';
      
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
        'Email': email,
        'GEO': `${country}, ${city}`,
        'UTM Source': utmSource,
        'UTM Medium': utmMedium,
        'UTM Campaign': utmCampaign,
        'UTM Content': utmContent,
        'UTM Term': utmTerm,
        'Ad Name': adName,
        'Adset Name': adsetName,
        'Payment Count': '1'
      };
      
      tableData.push(purchaseData);
    }
    
    // Сортируем по дате создания (самые новые сверху)
    tableData.sort((a, b) => new Date(b['Created UTC']) - new Date(a['Created UTC']));
    
    console.log(`📝 Подготовлено ${tableData.length} записей для добавления в таблицу`);
    
    // Добавляем данные
    if (tableData.length > 0) {
      console.log('📝 Добавляем данные в таблицу...');
      await sheet.addRows(tableData);
      console.log(`✅ Успешно добавлено ${tableData.length} записей`);
    }
    
    console.log('==========================================');
    console.log('🎉 ВОССТАНОВЛЕНИЕ ЗАВЕРШЕНО!');
    console.log(`✅ Добавлено ${tableData.length} записей первых покупок`);
    console.log(`🚫 Только "Subscription creation" платежи`);
    console.log(`🔄 Группировка работает корректно (1 клиент = 1 запись)`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

restoreCorrectColumns();
