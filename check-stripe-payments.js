// Скрипт для проверки покупок в Stripe
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function checkStripePayments() {
  try {
    console.log('🔍 ПРОВЕРЯЮ ПОКУПКИ В STRIPE...');
    console.log('');

    // Получаем платежи за последние 7 дней
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    console.log(`📅 Поиск платежей с: ${new Date(sevenDaysAgo * 1000).toISOString()}`);
    console.log('');

    const payments = await stripe.paymentIntents.list({
      limit: 100,
      created: {
        gte: sevenDaysAgo
      }
    });

    console.log(`📊 Всего платежей за 7 дней: ${payments.data.length}`);
    console.log('');

    // Фильтруем успешные платежи
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded' && p.customer);
    console.log(`✅ Успешных платежей: ${successfulPayments.length}`);
    console.log('');

    if (successfulPayments.length > 0) {
      console.log('📋 ДЕТАЛИ УСПЕШНЫХ ПЛАТЕЖЕЙ:');
      console.log('');

      for (const payment of successfulPayments) {
        const customer = await stripe.customers.retrieve(payment.customer);
        const amount = (payment.amount / 100).toFixed(2);
        const currency = payment.currency.toUpperCase();
        const date = new Date(payment.created * 1000).toISOString();
        
        console.log(`💳 ${payment.id}`);
        console.log(`   💰 ${amount} ${currency}`);
        console.log(`   📧 ${customer?.email || 'N/A'}`);
        console.log(`   📅 ${date}`);
        console.log(`   🏷️ ${payment.metadata?.product_tag || 'N/A'}`);
        console.log(`   🌍 ${payment.metadata?.geo_country || 'N/A'}`);
        console.log('');
      }
    }

    // Группируем по клиентам и датам
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const customerId = customer?.id || 'unknown_customer';
      const purchaseDate = new Date(payment.created * 1000);
      const dateKey = `${customerId}_${purchaseDate.toISOString().split('T')[0]}`;

      if (!groupedPurchases.has(dateKey)) {
        groupedPurchases.set(dateKey, {
          customer,
          payments: [],
          totalAmount: 0,
          firstPayment: payment
        });
      }

      const group = groupedPurchases.get(dateKey);
      group.payments.push(payment);
      group.totalAmount += payment.amount;
    }

    console.log(`📊 СГРУППИРОВАННЫХ ПОКУПОК: ${groupedPurchases.size}`);
    console.log('');

    for (const [dateKey, group] of groupedPurchases.entries()) {
      const customer = group.customer;
      const totalAmount = (group.totalAmount / 100).toFixed(2);
      const currency = group.firstPayment.currency.toUpperCase();
      const date = dateKey.split('_')[1];
      
      console.log(`🛒 ${dateKey}`);
      console.log(`   👤 ${customer?.email || 'N/A'}`);
      console.log(`   💰 ${totalAmount} ${currency} (${group.payments.length} платежей)`);
      console.log(`   📅 ${date}`);
      console.log('');
    }

    console.log('✅ ПРОВЕРКА ЗАВЕРШЕНА!');

  } catch (error) {
    console.error('❌ Ошибка при проверке Stripe:', error.message);
  }
}

checkStripePayments();
