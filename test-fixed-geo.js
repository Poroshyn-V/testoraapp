import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function testFixedGeo() {
  try {
    console.log('🧪 ТЕСТИРОВАНИЕ ИСПРАВЛЕННОГО ГЕО...');
    
    // Получаем последний платеж
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    
    if (payments.data.length === 0) {
      console.log('❌ Нет платежей для тестирования');
      return;
    }
    
    const payment = payments.data[0];
    const customer = await stripe.customers.retrieve(payment.customer);
    const metadata = customer?.metadata || {};
    
    console.log(`💳 Платеж: ${payment.id}`);
    console.log(`📧 Email: ${customer?.email || 'N/A'}`);
    console.log(`🌍 Geo Country: ${metadata.geo_country || 'НЕТ'}`);
    console.log(`🏙️ Geo City: ${metadata.geo_city || 'НЕТ'}`);
    console.log(`🌐 IP Address: ${metadata.ip_address || 'НЕТ'}`);
    
    // Тестируем новую логику ГЕО
    let geo = 'N/A';
    
    if (metadata.geo_country && metadata.geo_city) {
      geo = `${metadata.geo_country}, ${metadata.geo_city}`;
      console.log(`✅ ГЕО из metadata: ${geo}`);
    } else if (metadata.geo_country) {
      geo = metadata.geo_country;
      console.log(`✅ ГЕО страна из metadata: ${geo}`);
    } else {
      const ipAddress = metadata.ip_address || 'N/A';
      if (ipAddress !== 'N/A' && !ipAddress.includes(':')) {
        geo = `IPv4: ${ipAddress}`;
        console.log(`✅ IPv4 адрес: ${geo}`);
      } else if (ipAddress.includes(':')) {
        geo = 'IPv6';
        console.log(`✅ IPv6 адрес: ${geo}`);
      }
    }
    
    console.log(`\n🎯 ИТОГОВЫЙ ГЕО: ${geo}`);
    
    // Тестируем форматирование уведомлений
    const country = customer?.address?.country || metadata.geo_country || 'US';
    console.log(`📍 Country для уведомлений: ${country}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

testFixedGeo();
