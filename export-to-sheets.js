import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function exportToSheets() {
  try {
    console.log('🔄 Экспорт в Google Sheets...');
    
    // Получаем платежи
    const payments = await stripe.paymentIntents.list({ limit: 10 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    // Подключаемся к Google Sheets
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_DOC_ID);
    
    // Аутентификация
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
    
    await doc.loadInfo();
    console.log(`📄 Таблица: ${doc.title}`);
    
    // Получаем лист
    const sheet = doc.sheetsByIndex[0];
    
    // Очищаем и добавляем заголовки
    await sheet.clear();
    await sheet.addRow([
      'Payment ID', 'Amount', 'Currency', 'Status', 'Created',
      'Customer ID', 'Customer Email', 'UTM Source', 'UTM Medium', 'UTM Campaign'
    ]);
    
    console.log('📝 Заголовки добавлены');
    
    // Добавляем данные
    for (const payment of payments.data) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const metadata = customer?.metadata || {};
      
      await sheet.addRow([
        payment.id,
        `$${(payment.amount / 100).toFixed(2)}`,
        payment.currency.toUpperCase(),
        payment.status,
        new Date(payment.created * 1000).toLocaleString(),
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        metadata.utm_source || 'N/A',
        metadata.utm_medium || 'N/A',
        metadata.utm_campaign || 'N/A'
      ]);
      
      console.log(`✅ Добавлен: ${payment.id}`);
    }
    
    console.log(`🎉 ГОТОВО! ${payments.data.length} платежей в Google Sheets`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

exportToSheets();
