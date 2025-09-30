import Stripe from 'stripe';
import fetch from 'node-fetch';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Функции из исправленного sync-payments.js
function formatTelegram(payment, customer = null) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = customer?.email || 'N/A';
  const metadata = customer?.metadata || {};
  const country = metadata.geo_country || 'US';
  
  // Генерируем случайный ID заказа
  const orderId = Math.random().toString(36).substring(2, 15);
  
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

async function sendTelegram(text) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('❌ Telegram не настроен');
    return false;
  }
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        disable_web_page_preview: true
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log('✅ Telegram отправлен');
      return true;
    } else {
      console.log('❌ Telegram error:', data.description);
      return false;
    }
  } catch (error) {
    console.log('❌ Telegram error:', error.message);
    return false;
  }
}

async function sendTestNotification() {
  try {
    console.log('🧪 ОТПРАВКА ТЕСТОВОГО УВЕДОМЛЕНИЯ...');
    
    // Получаем последний платеж
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    
    if (payments.data.length === 0) {
      console.log('❌ Нет платежей для тестирования');
      return;
    }
    
    const payment = payments.data[0];
    const customer = await stripe.customers.retrieve(payment.customer);
    const metadata = customer?.metadata || {};
    
    console.log(`💳 Тестируем с платежом: ${payment.id}`);
    console.log(`📧 Email: ${customer?.email || 'НЕТ'}`);
    console.log(`🌍 UTM Source: ${metadata.utm_source || 'НЕТ'}`);
    console.log(`📱 Ad Name: ${metadata.ad_name || 'НЕТ'}`);
    console.log(`🎯 Campaign: ${metadata.utm_campaign || 'НЕТ'}`);
    console.log(`🌍 Geo Country: ${metadata.geo_country || 'НЕТ'}`);
    console.log(`🏙️ Geo City: ${metadata.geo_city || 'НЕТ'}`);
    
    // Формируем сообщение
    const telegramMessage = formatTelegram(payment, customer);
    
    console.log('\n📱 ОТПРАВЛЯЕМ В TELEGRAM:');
    console.log(telegramMessage);
    
    // Отправляем в Telegram
    const sent = await sendTelegram(telegramMessage);
    
    if (sent) {
      console.log('\n🎉 ТЕСТОВОЕ УВЕДОМЛЕНИЕ ОТПРАВЛЕНО!');
      console.log('✅ Проверьте ваш Telegram канал');
      console.log('✅ Все данные должны отображаться правильно');
      console.log('✅ Нет дублирования');
    } else {
      console.log('\n❌ Не удалось отправить уведомление');
      console.log('🔍 Проверьте настройки Telegram в Render');
    }
    
  } catch (error) {
    console.error('❌ Ошибка отправки:', error.message);
  }
}

sendTestNotification();
