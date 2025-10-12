import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function debugUtmIssue() {
  try {
    console.log('🔍 ДЕБАГ UTM МЕТОК...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ limit: 3 });
    
    for (const payment of payments.data) {
      console.log(`\n💳 Платеж: ${payment.id}`);
      console.log(`   Status: ${payment.status}`);
      console.log(`   Customer: ${payment.customer}`);
      
      if (payment.customer) {
        const customer = await stripe.customers.retrieve(payment.customer);
        console.log(`   Customer Email: ${customer?.email || 'N/A'}`);
        console.log(`   Customer Metadata:`, customer?.metadata || {});
        
        // Проверяем конкретные UTM поля
        const metadata = customer?.metadata || {};
        console.log(`   UTM Source: "${metadata.utm_source || 'НЕТ'}"`);
        console.log(`   UTM Medium: "${metadata.utm_medium || 'НЕТ'}"`);
        console.log(`   UTM Campaign: "${metadata.utm_campaign || 'НЕТ'}"`);
        console.log(`   Ad Name: "${metadata.ad_name || 'НЕТ'}"`);
        console.log(`   Adset Name: "${metadata.adset_name || 'НЕТ'}"`);
        console.log(`   Campaign Name: "${metadata.campaign_name || 'НЕТ'}"`);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

debugUtmIssue();
