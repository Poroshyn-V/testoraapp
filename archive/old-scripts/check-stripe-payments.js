// Проверка покупок в Stripe
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function checkPayments() {
  try {
    console.log('🔍 Проверяю покупки в Stripe...');
    
    // Получаем покупки за последние 7 дней
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    const payments = await stripe.paymentIntents.list({
      limit: 100,
      created: {
        gte: sevenDaysAgo
      }
    });
    
    console.log(`📊 Найдено платежей: ${payments.data.length}`);
    
    // Фильтруем успешные платежи
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded' && p.customer);
    console.log(`✅ Успешных платежей: ${successfulPayments.length}`);
    
    // Показываем последние 5
    console.log('\n📋 Последние 5 покупок:');
    for (let i = 0; i < Math.min(5, successfulPayments.length); i++) {
      const payment = successfulPayments[i];
      const customer = await stripe.customers.retrieve(payment.customer);
      
      console.log(`\n${i + 1}. Покупка:`);
      console.log(`   💰 Сумма: ${(payment.amount / 100).toFixed(2)} ${payment.currency.toUpperCase()}`);
      console.log(`   📧 Email: ${customer.email || 'N/A'}`);
      console.log(`   🆔 Customer ID: ${payment.customer}`);
      console.log(`   📅 Дата: ${new Date(payment.created * 1000).toISOString()}`);
      console.log(`   🆔 Payment ID: ${payment.id}`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkPayments();