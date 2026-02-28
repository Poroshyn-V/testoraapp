import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function exportData() {
  try {
    console.log('🔄 Экспорт данных...');
    
    // Получаем платежи
    const payments = await stripe.paymentIntents.list({ limit: 10 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    console.log('\n📋 ДАННЫЕ ДЛЯ GOOGLE SHEETS:');
    console.log('================================');
    
    // Заголовки
    console.log('Payment ID,Amount,Currency,Status,Created,Customer ID,Customer Email,UTM Source,UTM Medium,UTM Campaign');
    
    // Данные
    for (const payment of payments.data) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const metadata = customer?.metadata || {};
      
      const row = [
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
      ].join(',');
      
      console.log(row);
    }
    
    console.log('\n🎉 ДАННЫЕ ГОТОВЫ!');
    console.log('📊 Скопируйте данные выше и вставьте в Google Sheets');
    console.log('🔗 https://docs.google.com/spreadsheets/d/146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

exportData();
