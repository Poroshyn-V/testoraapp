import Stripe from 'stripe';
import fetch from 'node-fetch';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function exportToGoogleSheets() {
  try {
    console.log('🔄 Экспорт в Google Sheets...');
    
    // Получаем платежи
    const payments = await stripe.paymentIntents.list({ limit: 5 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    // Создаем простой CSV
    let csv = 'Payment ID,Amount,Currency,Status,Created,Customer ID,Customer Email,UTM Source,UTM Medium,UTM Campaign\n';
    
    for (const payment of payments.data) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const metadata = customer?.metadata || {};
      
      csv += [
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
      ].join(',') + '\n';
    }
    
    console.log('📝 CSV данные:');
    console.log(csv);
    
    console.log(`🎉 ГОТОВО! ${payments.data.length} платежей подготовлено`);
    console.log(`📊 Скопируйте данные выше и вставьте в Google Sheets`);
    console.log(`🔗 https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_DOC_ID}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

exportToGoogleSheets();
