import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function checkCustomerGeo() {
  try {
    console.log('🌍 ПРОВЕРКА ГЕО ДАННЫХ ПОКУПАТЕЛЕЙ...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ limit: 5 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    for (const payment of payments.data) {
      console.log(`\n💳 Платеж: ${payment.id}`);
      
      // Получаем данные клиента
      const customer = await stripe.customers.retrieve(payment.customer);
      console.log(`   Customer ID: ${customer?.id || 'N/A'}`);
      console.log(`   Email: ${customer?.email || 'N/A'}`);
      
      // Проверяем адрес клиента
      if (customer?.address) {
        console.log(`   📍 Адрес:`);
        console.log(`      Страна: ${customer.address.country || 'N/A'}`);
        console.log(`      Город: ${customer.address.city || 'N/A'}`);
        console.log(`      Штат: ${customer.address.state || 'N/A'}`);
        console.log(`      Почтовый индекс: ${customer.address.postal_code || 'N/A'}`);
        console.log(`      Адрес: ${customer.address.line1 || 'N/A'}`);
        console.log(`      Адрес 2: ${customer.address.line2 || 'N/A'}`);
      } else {
        console.log(`   📍 Адрес: НЕ УКАЗАН`);
      }
      
      // Проверяем shipping адрес
      if (payment.shipping?.address) {
        console.log(`   🚚 Shipping адрес:`);
        console.log(`      Страна: ${payment.shipping.address.country || 'N/A'}`);
        console.log(`      Город: ${payment.shipping.address.city || 'N/A'}`);
        console.log(`      Штат: ${payment.shipping.address.state || 'N/A'}`);
        console.log(`      Почтовый индекс: ${payment.shipping.address.postal_code || 'N/A'}`);
        console.log(`      Адрес: ${payment.shipping.address.line1 || 'N/A'}`);
      } else {
        console.log(`   🚚 Shipping адрес: НЕ УКАЗАН`);
      }
      
      // Проверяем billing адрес
      if (payment.charges?.data?.[0]?.billing_details?.address) {
        const billingAddress = payment.charges.data[0].billing_details.address;
        console.log(`   💳 Billing адрес:`);
        console.log(`      Страна: ${billingAddress.country || 'N/A'}`);
        console.log(`      Город: ${billingAddress.city || 'N/A'}`);
        console.log(`      Штат: ${billingAddress.state || 'N/A'}`);
        console.log(`      Почтовый индекс: ${billingAddress.postal_code || 'N/A'}`);
        console.log(`      Адрес: ${billingAddress.line1 || 'N/A'}`);
      } else {
        console.log(`   💳 Billing адрес: НЕ УКАЗАН`);
      }
      
      // Проверяем metadata на предмет ГЕО данных
      const metadata = customer?.metadata || {};
      console.log(`   🏷️ Metadata:`);
      console.log(`      Страна: ${metadata.country || 'N/A'}`);
      console.log(`      Город: ${metadata.city || 'N/A'}`);
      console.log(`      Штат: ${metadata.state || 'N/A'}`);
      console.log(`      IP: ${metadata.ip_address || 'N/A'}`);
      console.log(`      User Agent: ${metadata.user_agent || 'N/A'}`);
      
      // Проверяем все доступные поля customer
      console.log(`   🔍 Все поля customer:`);
      console.log(`      created: ${customer?.created || 'N/A'}`);
      console.log(`      default_source: ${customer?.default_source || 'N/A'}`);
      console.log(`      description: ${customer?.description || 'N/A'}`);
      console.log(`      livemode: ${customer?.livemode || 'N/A'}`);
      console.log(`      name: ${customer?.name || 'N/A'}`);
      console.log(`      phone: ${customer?.phone || 'N/A'}`);
      console.log(`      tax_exempt: ${customer?.tax_exempt || 'N/A'}`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkCustomerGeo();
