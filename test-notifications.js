import fetch from 'node-fetch';

// Переменные окружения
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

async function sendTelegram(text) {
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
    const result = await response.json();
    return response.ok;
  } catch (error) {
    console.error('Telegram error:', error.message);
    return false;
  }
}

async function sendSlack(text) {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: SLACK_CHAT_ID,
        text: text,
        username: 'Stripe Sync Bot',
        icon_emoji: ':money_with_wings:'
      })
    });
    const result = await response.json();
    return result.ok;
  } catch (error) {
    console.error('Slack error:', error.message);
    return false;
  }
}

async function testNotifications() {
  console.log('🧪 ТЕСТИРОВАНИЕ УВЕДОМЛЕНИЙ...');
  
  const testMessage = `🧪 ТЕСТ УВЕДОМЛЕНИЙ
---------------------------
🟢 Order TEST123 был обработан!
---------------------------
💳 card
💰 $9.99 USD
🏷️ Test Product
---------------------------
📧 test@example.com
---------------------------
🌪️ TEST123
📍 US
🧍Male 25
🔗 https://example.com
meta
Facebook_Mobile_Feed
Test Ad
Test Adset
Test Campaign`;

  console.log('📱 Отправка в Telegram...');
  const telegramResult = await sendTelegram(testMessage);
  console.log('Telegram результат:', telegramResult ? '✅ Успешно' : '❌ Ошибка');
  
  console.log('💬 Отправка в Slack...');
  const slackResult = await sendSlack(testMessage);
  console.log('Slack результат:', slackResult ? '✅ Успешно' : '❌ Ошибка');
  
  if (telegramResult && slackResult) {
    console.log('🎉 ВСЕ УВЕДОМЛЕНИЯ РАБОТАЮТ!');
  } else {
    console.log('❌ ЕСТЬ ПРОБЛЕМЫ С УВЕДОМЛЕНИЯМИ');
  }
}

testNotifications();
