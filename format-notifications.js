import Stripe from 'stripe';

const stripe = new Stripe('sk_test_51S95aiLGc4AZl8D4LBucx6SeyHpr5atnp44MOqd9EOhsmh8faSY0ydSCIP8q1eRo5jvmkJsLPNJrqvRRSpPCxEnu00p48AJ5Er');

function formatTelegramNotification(payment, session = null) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = payment.receipt_email || session?.customer_details?.email || session?.customer_email || 'N/A';
  const country = session?.customer_details?.address?.country || 'N/A';
  
  // Генерируем случайный ID заказа
  const orderId = Math.random().toString(36).substring(2, 15);
  
  // Получаем metadata
  const metadata = session?.metadata || payment.metadata || {};
  
  // Извлекаем данные из metadata
  const gender = metadata.gender || 'N/A';
  const age = metadata.age || 'N/A';
  const creativeLink = metadata.creative_link || metadata.creo_link || 'N/A';
  const platform = metadata.platform || metadata.utm_source || 'N/A';
  const placement = metadata.placement || metadata.platform_placement || 'N/A';
  const adName = metadata.ad_name || 'N/A';
  const adsetName = metadata.adset_name || 'N/A';
  const campaignName = metadata.campaign_name || 'N/A';
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
${platform} (${placement}) 
${adName} (${adsetName}) 
${campaignName} ()`;
}

function formatSlackNotification(payment, session = null) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = payment.receipt_email || session?.customer_details?.email || session?.customer_email || 'N/A';
  const country = session?.customer_details?.address?.country || 'N/A';
  
  // Генерируем случайный ID заказа
  const orderId = Math.random().toString(36).substring(2, 15);
  
  // Получаем metadata
  const metadata = session?.metadata || payment.metadata || {};
  
  // Извлекаем данные из metadata
  const gender = metadata.gender || 'N/A';
  const age = metadata.age || 'N/A';
  const creativeLink = metadata.creative_link || metadata.creo_link || 'N/A';
  const platform = metadata.platform || metadata.utm_source || 'N/A';
  const placement = metadata.placement || metadata.platform_placement || 'N/A';
  const adName = metadata.ad_name || 'N/A';
  const adsetName = metadata.adset_name || 'N/A';
  const campaignName = metadata.campaign_name || 'N/A';
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
${placement} (${platform})
${adName}
${adsetName}
${campaignName}`;
}

async function testFormattedNotifications() {
  console.log('🧪 ТЕСТИРУЮ НОВЫЙ ФОРМАТ УВЕДОМЛЕНИЙ...\n');

  try {
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    const sessions = await stripe.checkout.sessions.list({ limit: 1 });

    if (payments.data.length > 0) {
      const payment = payments.data[0];
      const session = sessions.data[0];

      console.log('📱 TELEGRAM ФОРМАТ:');
      console.log(formatTelegramNotification(payment, session));
      
      console.log('\n💬 SLACK ФОРМАТ:');
      console.log(formatSlackNotification(payment, session));
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

testFormattedNotifications();
