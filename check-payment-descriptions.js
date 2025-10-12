import Stripe from 'stripe';
import { config } from 'dotenv';

config();

const ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY
};

async function checkPaymentDescriptions() {
  try {
    console.log('🔍 ПРОВЕРКА ОПИСАНИЙ ПЛАТЕЖЕЙ');
    console.log('==============================');
    
    const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
    
    // Получаем последние 50 платежей
    const payments = await stripe.paymentIntents.list({ limit: 50 });
    
    console.log(`📊 Проверяем ${payments.data.length} последних платежей:`);
    console.log('');
    
    let subscriptionCreationCount = 0;
    let subscriptionUpdateCount = 0;
    let otherCount = 0;
    
    for (const payment of payments.data) {
      if (payment.status !== 'succeeded' || !payment.customer) continue;
      
      const charge = payment.charges?.data?.[0];
      const description = charge?.description || 'No description';
      
      console.log(`💳 ${payment.id}: ${description}`);
      
      if (description.toLowerCase().includes('subscription creation')) {
        subscriptionCreationCount++;
      } else if (description.toLowerCase().includes('subscription update')) {
        subscriptionUpdateCount++;
      } else {
        otherCount++;
      }
    }
    
    console.log('');
    console.log('📈 СТАТИСТИКА:');
    console.log(`✅ Subscription creation: ${subscriptionCreationCount}`);
    console.log(`🔄 Subscription update: ${subscriptionUpdateCount}`);
    console.log(`❓ Другие: ${otherCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkPaymentDescriptions();
