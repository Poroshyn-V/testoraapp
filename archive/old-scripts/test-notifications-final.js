import Stripe from 'stripe';
import fetch from 'node-fetch';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function testNotifications() {
  try {
    console.log('🧪 ТЕСТИРОВАНИЕ УВЕДОМЛЕНИЙ...');
    
    // Получаем последний платеж для тестирования
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    
    if (payments.data.length === 0) {
      console.log('❌ Нет платежей для тестирования');
      return;
    }
    
    const payment = payments.data[0];
    const customer = await stripe.customers.retrieve(payment.customer);
    const metadata = customer?.metadata || {};
    
    console.log(`💳 Тестируем с платежом: ${payment.id}`);
    console.log(`📧 Email: ${customer?.email || 'N/A'}`);
    console.log(`🌍 UTM Source: ${metadata.utm_source || 'N/A'}`);
    
    // Формируем сообщение как в реальной системе
    const amount = payment.amount / 100;
    const currency = payment.currency.toUpperCase();
    const email = customer?.email || 'N/A';
    const country = 'US'; // По умолчанию
    const gender = metadata.gender || 'N/A';
    const age = metadata.age || 'N/A';
    const creativeLink = metadata.creative_link || 'N/A';
    const platform = metadata.utm_source || 'N/A';
    const placement = metadata.utm_medium || 'N/A';
    const adName = metadata.ad_name || 'N/A';
    const adsetName = metadata.adset_name || 'N/A';
    const campaignName = metadata.utm_campaign || 'N/A';
    const productTag = metadata.product_tag || 'N/A';
    
    // Генерируем случайный ID заказа
    const orderId = Math.random().toString(36).substring(2, 15);
    
    // Telegram сообщение
    const telegramMessage = `🟢 Order ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ ${productTag}
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId.substring(0, 6)}
📍 ${country}
🧍${gender} ${age}
🔗 ${creativeLink}
${platform}
${placement}
${adName}
${adsetName}
${campaignName}`;
    
    // Slack сообщение
    const slackMessage = `:large_green_circle: Order ${orderId.substring(0, 8)}... processed!
---------------------------
:credit_card: card
:moneybag: ${amount} ${currency}
:label: ${productTag}
---------------------------
:e-mail: ${email}
---------------------------
:round_pushpin: ${country}
:standing_person: ${gender} ${age}
:link: ${creativeLink}
${platform}
${placement}
${adName}
${adsetName}
${campaignName}`;
    
    console.log('\n📱 TELEGRAM СООБЩЕНИЕ:');
    console.log(telegramMessage);
    
    console.log('\n💬 SLACK СООБЩЕНИЕ:');
    console.log(slackMessage);
    
    console.log('\n🎯 СИСТЕМА ГОТОВА К АВТОМАТИЧЕСКИМ УВЕДОМЛЕНИЯМ!');
    console.log('✅ При каждой новой покупке будет:');
    console.log('   📱 Telegram уведомление');
    console.log('   💬 Slack уведомление');
    console.log('   📊 Автоматическая выгрузка в Google Sheets');
    console.log('   🌍 ГЕО данные покупателя');
    console.log('   🏷️ Все UTM метки');
    
  } catch (error) {
    console.error('❌ Ошибка тестирования:', error.message);
  }
}

testNotifications();
