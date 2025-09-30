import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function checkRecentPaymentsDebug() {
  try {
    console.log('🔍 ПРОВЕРКА ПОСЛЕДНИХ ПЛАТЕЖЕЙ И МЕТАДАННЫХ...');
    
    // Получаем платежи за последние 24 часа
    const twentyFourHoursAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    
    const payments = await stripe.paymentIntents.list({
      limit: 10,
      created: {
        gte: twentyFourHoursAgo
      }
    });

    console.log(`📊 Найдено платежей за последние 24 часа: ${payments.data.length}`);

    if (payments.data.length > 0) {
      console.log('\n💳 ПОСЛЕДНИЕ ПЛАТЕЖИ:');
      console.log('================================');
      
      for (const payment of payments.data) {
        console.log(`\n💳 Payment: ${payment.id}`);
        console.log(`   Status: ${payment.status}`);
        console.log(`   Amount: $${(payment.amount / 100).toFixed(2)}`);
        console.log(`   Created: ${new Date(payment.created * 1000).toLocaleString()}`);
        
        // Проверяем metadata платежа
        console.log(`   Payment Metadata:`, payment.metadata);
        
        // Получаем данные клиента
        const customer = await stripe.customers.retrieve(payment.customer);
        console.log(`   Customer ID: ${customer?.id || 'N/A'}`);
        console.log(`   Customer Email: ${customer?.email || 'N/A'}`);
        console.log(`   Customer Name: ${customer?.name || 'N/A'}`);
        
        // Проверяем metadata клиента
        const customerMetadata = customer?.metadata || {};
        console.log(`   Customer Metadata:`, customerMetadata);
        
        // Проверяем конкретные UTM поля
        console.log(`   UTM Source: ${customerMetadata.utm_source || 'НЕТ'}`);
        console.log(`   UTM Medium: ${customerMetadata.utm_medium || 'НЕТ'}`);
        console.log(`   UTM Campaign: ${customerMetadata.utm_campaign || 'НЕТ'}`);
        console.log(`   Ad Name: ${customerMetadata.ad_name || 'НЕТ'}`);
        console.log(`   Adset Name: ${customerMetadata.adset_name || 'НЕТ'}`);
        console.log(`   Campaign Name: ${customerMetadata.campaign_name || 'НЕТ'}`);
        console.log(`   Product Tag: ${customerMetadata.product_tag || 'НЕТ'}`);
        console.log(`   Gender: ${customerMetadata.gender || 'НЕТ'}`);
        console.log(`   Age: ${customerMetadata.age || 'НЕТ'}`);
        console.log(`   Creative Link: ${customerMetadata.creative_link || 'НЕТ'}`);
        console.log(`   IP Address: ${customerMetadata.ip_address || 'НЕТ'}`);
        console.log(`   User Agent: ${customerMetadata.user_agent || 'НЕТ'}`);
        
        if (payment.status === 'succeeded') {
          console.log('   ✅ УСПЕШНЫЙ ПЛАТЕЖ - должен быть обработан автоматически');
        }
      }
    } else {
      console.log('📭 Новых платежей за последние 24 часа нет');
      
      // Проверяем последние 5 платежей вообще
      console.log('\n🔍 ПРОВЕРЯЕМ ПОСЛЕДНИЕ 5 ПЛАТЕЖЕЙ:');
      const allPayments = await stripe.paymentIntents.list({ limit: 5 });
      
      for (const payment of allPayments.data) {
        const customer = await stripe.customers.retrieve(payment.customer);
        const metadata = customer?.metadata || {};
        
        console.log(`\n💳 ${payment.id} - ${new Date(payment.created * 1000).toLocaleString()}`);
        console.log(`   UTM Source: ${metadata.utm_source || 'НЕТ'}`);
        console.log(`   UTM Medium: ${metadata.utm_medium || 'НЕТ'}`);
        console.log(`   UTM Campaign: ${metadata.utm_campaign || 'НЕТ'}`);
        console.log(`   Ad Name: ${metadata.ad_name || 'НЕТ'}`);
        console.log(`   Product Tag: ${metadata.product_tag || 'НЕТ'}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка при проверке платежей:', error.message);
  }
}

checkRecentPaymentsDebug();
