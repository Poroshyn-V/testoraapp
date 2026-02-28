import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function testSlack() {
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  
  console.log('🔍 Проверяем Slack...');
  console.log('SLACK_WEBHOOK_URL:', SLACK_WEBHOOK_URL ? 'Настроен' : 'НЕ НАСТРОЕН');
  
  if (!SLACK_WEBHOOK_URL) {
    console.log('❌ Slack webhook URL не настроен в переменных окружения');
    return;
  }
  
  try {
    const testMessage = `🧪 Тест Slack уведомления
---------------------------
💳 Тестовый платеж
💰 100.00 USD
🏷️ Test Product
---------------------------
📧 test@example.com
---------------------------
🌪️ TEST123
📍 US
🧍 Male 25
🔗 https://example.com
Google
Facebook
Test Ad
Test Adset
Test Campaign`;

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: testMessage })
    });
    
    if (response.ok) {
      console.log('✅ Slack тест успешен!');
    } else {
      console.log('❌ Slack error:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error) {
    console.log('❌ Slack error:', error.message);
  }
}

testSlack();
