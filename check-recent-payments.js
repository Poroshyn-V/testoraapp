import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function checkRecentPayments() {
  try {
    console.log('🔍 ПРОВЕРКА ПОСЛЕДНИХ ПЛАТЕЖЕЙ...');
    
    // Получаем платежи за последние 10 минут
    const tenMinutesAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    
    const payments = await stripe.paymentIntents.list({
      limit: 10,
      created: {
        gte: tenMinutesAgo
      }
    });

    console.log(`📊 Найдено платежей за последние 10 минут: ${payments.data.length}`);

    if (payments.data.length > 0) {
      console.log('\n💳 ПОСЛЕДНИЕ ПЛАТЕЖИ:');
      console.log('================================');
      
      for (const payment of payments.data) {
        const customer = await stripe.customers.retrieve(payment.customer);
        const metadata = customer?.metadata || {};
        
        console.log(`\n💳 Payment: ${payment.id}`);
        console.log(`   Status: ${payment.status}`);
        console.log(`   Amount: $${(payment.amount / 100).toFixed(2)}`);
        console.log(`   Currency: ${payment.currency}`);
        console.log(`   Created: ${new Date(payment.created * 1000).toLocaleString()}`);
        console.log(`   Customer: ${customer?.id || 'N/A'}`);
        console.log(`   Email: ${customer?.email || 'N/A'}`);
        console.log(`   UTM Source: ${metadata.utm_source || 'N/A'}`);
        console.log(`   UTM Medium: ${metadata.utm_medium || 'N/A'}`);
        console.log(`   UTM Campaign: ${metadata.utm_campaign || 'N/A'}`);
        console.log(`   Ad Name: ${metadata.ad_name || 'N/A'}`);
        
        if (payment.status === 'succeeded') {
          console.log('   ✅ УСПЕШНЫЙ ПЛАТЕЖ - должен быть обработан автоматически');
        }
      }
    } else {
      console.log('📭 Новых платежей за последние 10 минут нет');
    }
    
    // Проверяем общее количество платежей
    const allPayments = await stripe.paymentIntents.list({ limit: 5 });
    console.log(`\n📈 Всего платежей в системе: ${allPayments.data.length}`);
    
  } catch (error) {
    console.error('❌ Ошибка при проверке платежей:', error.message);
  }
}

checkRecentPayments();
