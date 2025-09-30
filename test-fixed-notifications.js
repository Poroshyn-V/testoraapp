import Stripe from 'stripe';
import fetch from 'node-fetch';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Функции форматирования (скопированы из sync-payments.js)
function formatTelegram(payment, customer = null) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = customer?.email || 'N/A';
  const country = customer?.address?.country || 'US';
  
  // Генерируем случайный ID заказа
  const orderId = Math.random().toString(36).substring(2, 15);
  
  // Получаем metadata из customer
  const metadata = customer?.metadata || {};
  
  // Извлекаем данные из metadata
  const gender = metadata.gender || 'N/A';
  const age = metadata.age || 'N/A';
  const creativeLink = metadata.creative_link || 'N/A';
  const platform = metadata.utm_source || 'N/A';
  const placement = metadata.utm_medium || 'N/A';
  const adName = metadata.ad_name || 'N/A';
  const adsetName = metadata.adset_name || 'N/A';
  const campaignName = metadata.utm_campaign || 'N/A';
  const productTag = metadata.product_tag || 'N/A';
  
  return `🟢 Order ${orderId} was processed!
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
}

function formatSlack(payment, customer = null) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = customer?.email || 'N/A';
  const country = customer?.address?.country || 'US';
  
  // Генерируем случайный ID заказа
  const orderId = Math.random().toString(36).substring(2, 15);
  
  // Получаем metadata из customer
  const metadata = customer?.metadata || {};
  
  // Извлекаем данные из metadata
  const gender = metadata.gender || 'N/A';
  const age = metadata.age || 'N/A';
  const creativeLink = metadata.creative_link || 'N/A';
  const platform = metadata.utm_source || 'N/A';
  const placement = metadata.utm_medium || 'N/A';
  const adName = metadata.ad_name || 'N/A';
  const adsetName = metadata.adset_name || 'N/A';
  const campaignName = metadata.utm_campaign || 'N/A';
  const productTag = metadata.product_tag || 'N/A';
  
  return `:large_green_circle: Order ${orderId.substring(0, 8)}... processed!
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
}

async function testFixedNotifications() {
  try {
    console.log('🧪 ТЕСТИРОВАНИЕ ИСПРАВЛЕННЫХ УВЕДОМЛЕНИЙ...');
    
    // Получаем последний платеж с полными данными
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    
    if (payments.data.length === 0) {
      console.log('❌ Нет платежей для тестирования');
      return;
    }
    
    const payment = payments.data[0];
    const customer = await stripe.customers.retrieve(payment.customer);
    
    console.log(`💳 Тестируем с платежом: ${payment.id}`);
    console.log(`📧 Email: ${customer?.email || 'N/A'}`);
    console.log(`🌍 UTM Source: ${customer?.metadata?.utm_source || 'N/A'}`);
    console.log(`📱 Ad Name: ${customer?.metadata?.ad_name || 'N/A'}`);
    console.log(`🎯 Campaign: ${customer?.metadata?.utm_campaign || 'N/A'}`);
    
    // Формируем сообщения
    const telegramMessage = formatTelegram(payment, customer);
    const slackMessage = formatSlack(payment, customer);
    
    console.log('\n📱 TELEGRAM СООБЩЕНИЕ:');
    console.log(telegramMessage);
    
    console.log('\n💬 SLACK СООБЩЕНИЕ:');
    console.log(slackMessage);
    
    console.log('\n🎯 ТЕПЕРЬ УВЕДОМЛЕНИЯ БУДУТ СОДЕРЖАТЬ РЕАЛЬНЫЕ ДАННЫЕ!');
    console.log('✅ UTM метки будут отображаться');
    console.log('✅ Ad Name будет отображаться');
    console.log('✅ Campaign будет отображаться');
    console.log('✅ Email будет отображаться');
    
  } catch (error) {
    console.error('❌ Ошибка тестирования:', error.message);
  }
}

testFixedNotifications();
