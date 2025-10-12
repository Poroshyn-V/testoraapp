import fetch from 'node-fetch';

async function testTelegram() {
  try {
    console.log('📱 ОТПРАВЛЯЮ ТЕСТОВОЕ СООБЩЕНИЕ В TELEGRAM...');
    
    const botToken = '7547749279:AAF6xqdN9Z3kLIwDEUXGA3rxCbMB8vNrmes';
    const chatId = '-4866273360';
    
    const testMessage = `🧪 **ТЕСТОВОЕ СООБЩЕНИЕ**

✅ **Система работает!**
🚀 **Render Deploy**: https://stripe-ops.onrender.com
💳 **Stripe Webhook**: Настроен
📱 **Telegram**: Работает
💬 **Slack**: Настроен
📊 **Google Sheets**: Готов

**Время**: ${new Date().toLocaleString()}
**Статус**: Все системы работают! 🎉`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: testMessage,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (response.ok) {
      console.log('✅ Тестовое сообщение отправлено в Telegram!');
      console.log('📱 Проверьте группу "Valerii & Testora"');
    } else {
      const error = await response.text();
      console.error('❌ Ошибка отправки:', error);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

testTelegram();

