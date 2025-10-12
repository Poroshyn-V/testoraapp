import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function checkStripe() {
  try {
    console.log('🔍 ПРОВЕРЯЮ STRIPE...');
    
    // Получаем последние платежи за 7 дней
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    console.log(`📅 Поиск платежей с: ${new Date(sevenDaysAgo * 1000).toISOString()}`);
    
    const payments = await stripe.paymentIntents.list({
      limit: 10,
      created: {
        gte: sevenDaysAgo
      }
    });
    
    console.log(`✅ Найдено ${payments.data.length} платежей за последние 7 дней`);
    
    if (payments.data.length > 0) {
      console.log('📄 Первые 3 платежа:');
      for (let i = 0; i < Math.min(3, payments.data.length); i++) {
        const payment = payments.data[i];
        const customer = payment.customer ? await stripe.customers.retrieve(payment.customer) : null;
        const date = new Date(payment.created * 1000);
        const dateKey = `${payment.customer}_${date.toISOString().split('T')[0]}`;
        const purchaseId = `purchase_${payment.customer}_${date.toISOString().split('T')[0]}`;
        
        console.log(`Payment ${i + 1}:`);
        console.log(`  ID: ${payment.id}`);
        console.log(`  Customer: ${payment.customer}`);
        console.log(`  Amount: ${(payment.amount / 100).toFixed(2)} ${payment.currency}`);
        console.log(`  Date: ${date.toISOString()}`);
        console.log(`  Date Key: ${dateKey}`);
        console.log(`  Purchase ID: ${purchaseId}`);
        console.log(`  Email: ${customer?.email || 'N/A'}`);
        console.log('---');
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkStripe();
