import Stripe from 'stripe';
import fetch from 'node-fetch';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Полная диагностика системы
async function completeSystemTest() {
  try {
    console.log('🔍 ПОЛНАЯ ДИАГНОСТИКА СИСТЕМЫ...');
    
    // 1. Проверяем Stripe подключение
    console.log('\n1️⃣ ПРОВЕРКА STRIPE:');
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    if (payments.data.length === 0) {
      console.log('❌ Нет платежей в Stripe');
      return;
    }
    
    const payment = payments.data[0];
    console.log(`✅ Stripe подключен, последний платеж: ${payment.id}`);
    
    // 2. Проверяем данные клиента
    console.log('\n2️⃣ ПРОВЕРКА ДАННЫХ КЛИЕНТА:');
    const customer = await stripe.customers.retrieve(payment.customer);
    const metadata = customer?.metadata || {};
    
    console.log(`📧 Email: ${customer?.email || 'НЕТ'}`);
    console.log(`🌍 UTM Source: ${metadata.utm_source || 'НЕТ'}`);
    console.log(`📱 Ad Name: ${metadata.ad_name || 'НЕТ'}`);
    console.log(`🎯 Campaign: ${metadata.utm_campaign || 'НЕТ'}`);
    console.log(`🌍 Geo Country: ${metadata.geo_country || 'НЕТ'}`);
    console.log(`🏙️ Geo City: ${metadata.geo_city || 'НЕТ'}`);
    console.log(`🌐 IP: ${metadata.ip_address || 'НЕТ'}`);
    
    // 3. Тестируем ГЕО логику
    console.log('\n3️⃣ ТЕСТИРОВАНИЕ ГЕО:');
    let geo = 'N/A';
    
    if (metadata.geo_country && metadata.geo_city) {
      geo = `${metadata.geo_country}, ${metadata.geo_city}`;
      console.log(`✅ ГЕО из metadata: ${geo}`);
    } else if (metadata.geo_country) {
      geo = metadata.geo_country;
      console.log(`✅ ГЕО страна: ${geo}`);
    } else {
      const ipAddress = metadata.ip_address;
      if (ipAddress && !ipAddress.includes(':')) {
        try {
          const geoResponse = await fetch(`https://ipinfo.io/${ipAddress}/json`);
          const geoData = await geoResponse.json();
          geo = `${geoData.country}, ${geoData.city}`;
          console.log(`✅ ГЕО по IP: ${geo}`);
        } catch (error) {
          console.log(`❌ Ошибка ГЕО по IP: ${error.message}`);
        }
      } else {
        console.log(`⚠️ IP не подходит: ${ipAddress}`);
      }
    }
    
    // 4. Тестируем форматирование уведомлений
    console.log('\n4️⃣ ТЕСТИРОВАНИЕ УВЕДОМЛЕНИЙ:');
    
    const amount = payment.amount / 100;
    const currency = payment.currency.toUpperCase();
    const email = customer?.email || 'N/A';
    const country = metadata.geo_country || 'US';
    const orderId = Math.random().toString(36).substring(2, 15);
    
    const telegramMessage = `🟢 Order ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ N/A
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId.substring(0, 6)}
📍 ${country}
🧍N/A N/A
🔗 N/A
${metadata.utm_source || 'N/A'}
${metadata.utm_medium || 'N/A'}
${metadata.ad_name || 'N/A'}
${metadata.adset_name || 'N/A'}
${metadata.utm_campaign || 'N/A'}`;
    
    console.log('📱 TELEGRAM СООБЩЕНИЕ:');
    console.log(telegramMessage);
    
    // 5. Тестируем Google Sheets данные
    console.log('\n5️⃣ ТЕСТИРОВАНИЕ GOOGLE SHEETS:');
    const sheetsData = [
      payment.id,
      `$${amount}`,
      currency,
      payment.status,
      new Date(payment.created * 1000).toLocaleString(),
      customer?.id || 'N/A',
      email,
      geo,
      metadata.utm_source || 'N/A',
      metadata.utm_medium || 'N/A',
      metadata.utm_campaign || 'N/A',
      metadata.utm_content || 'N/A',
      metadata.utm_term || 'N/A',
      metadata.ad_name || 'N/A',
      metadata.adset_name || 'N/A'
    ];
    
    console.log('📊 GOOGLE SHEETS ДАННЫЕ:');
    console.log(sheetsData);
    
    console.log('\n🎯 ДИАГНОСТИКА ЗАВЕРШЕНА!');
    
  } catch (error) {
    console.error('❌ Ошибка диагностики:', error.message);
  }
}

completeSystemTest();
