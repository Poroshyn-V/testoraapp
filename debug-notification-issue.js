import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function debugNotificationIssue() {
  try {
    console.log('🔍 ДЕБАГ ПРОБЛЕМЫ С УВЕДОМЛЕНИЯМИ...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ limit: 5 });
    
    for (const payment of payments.data) {
      console.log(`\n💳 Платеж: ${payment.id}`);
      console.log(`   Status: ${payment.status}`);
      console.log(`   Amount: $${(payment.amount / 100).toFixed(2)}`);
      console.log(`   Customer ID: ${payment.customer || 'НЕТ'}`);
      
      if (payment.customer) {
        try {
          const customer = await stripe.customers.retrieve(payment.customer);
          console.log(`   Customer Email: ${customer?.email || 'НЕТ'}`);
          console.log(`   Customer Name: ${customer?.name || 'НЕТ'}`);
          console.log(`   Customer Metadata Keys:`, Object.keys(customer?.metadata || {}));
          
          // Проверяем конкретные поля
          const metadata = customer?.metadata || {};
          console.log(`   UTM Source: "${metadata.utm_source || 'НЕТ'}"`);
          console.log(`   UTM Medium: "${metadata.utm_medium || 'НЕТ'}"`);
          console.log(`   UTM Campaign: "${metadata.utm_campaign || 'НЕТ'}"`);
          console.log(`   Ad Name: "${metadata.ad_name || 'НЕТ'}"`);
          console.log(`   Geo Country: "${metadata.geo_country || 'НЕТ'}"`);
          
        } catch (error) {
          console.log(`   ❌ Ошибка получения клиента: ${error.message}`);
        }
      } else {
        console.log(`   ❌ НЕТ CUSTOMER ID`);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

debugNotificationIssue();
