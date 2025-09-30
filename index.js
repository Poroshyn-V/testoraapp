import express from 'express';
import Stripe from 'stripe';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Test page
app.get('/test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Test API</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .button { background: #007bff; color: white; padding: 15px 30px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; width: 100%; margin: 20px 0; }
            .button:hover { background: #0056b3; }
            .result { margin-top: 20px; padding: 15px; border-radius: 5px; white-space: pre-wrap; }
            .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        </style>
    </head>
    <body>
        <h1>🚀 Test API - Send Last Payment</h1>
        <p>Нажмите кнопку ниже, чтобы отправить последнюю покупку в Telegram и Slack:</p>
        
        <button id="sendButton" class="button" onclick="sendLastPayment()">
            📱 Отправить последнюю покупку
        </button>
        
        <div id="result"></div>

        <script>
            async function sendLastPayment() {
                const button = document.getElementById('sendButton');
                const result = document.getElementById('result');
                
                button.disabled = true;
                button.textContent = '⏳ Отправляем...';
                result.innerHTML = '';
                
                try {
                    const response = await fetch('/api/send-last-payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        result.className = 'result success';
                        result.innerHTML = \`✅ УСПЕШНО ОТПРАВЛЕНО!
                        
📱 Telegram: \${data.telegram ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}
💬 Slack: \${data.slack ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}

💳 Платеж: \${data.payment_id}
📧 Email: \${data.customer_email}

🎉 Проверьте ваши каналы!\`;
                    } else {
                        result.className = 'result error';
                        result.innerHTML = \`❌ ОШИБКА: \${data.message}\`;
                    }
                } catch (error) {
                    result.className = 'result error';
                    result.innerHTML = \`❌ ОШИБКА СЕТИ: \${error.message}\`;
                } finally {
                    button.disabled = false;
                    button.textContent = '📱 Отправить последнюю покупку';
                }
            }
        </script>
    </body>
    </html>
  `);
});

// API endpoint для отправки последней покупки
app.post('/api/send-last-payment', async (req, res) => {
  try {
    console.log('🚀 API: ОТПРАВКА ПОСЛЕДНЕЙ ПОКУПКИ...');
    
    // Получаем последний платеж
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    
    if (payments.data.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Нет платежей для отправки' 
      });
    }
    
    const payment = payments.data[0];
    const customer = await stripe.customers.retrieve(payment.customer);
    const metadata = customer?.metadata || {};
    
    console.log(`💳 Отправляем платеж: ${payment.id}`);
    console.log(`📧 Email: ${customer?.email || 'НЕТ'}`);
    console.log(`🌍 UTM Source: ${metadata.utm_source || 'НЕТ'}`);
    console.log(`📱 Ad Name: ${metadata.ad_name || 'НЕТ'}`);
    console.log(`🎯 Campaign: ${metadata.utm_campaign || 'НЕТ'}`);
    console.log(`🌍 Geo Country: ${metadata.geo_country || 'НЕТ'}`);
    console.log(`🏙️ Geo City: ${metadata.geo_city || 'НЕТ'}`);
    
    // Формируем сообщения
    const amount = payment.amount / 100;
    const currency = payment.currency.toUpperCase();
    const email = customer?.email || 'N/A';
    const country = metadata.geo_country || 'US';
    const orderId = Math.random().toString(36).substring(2, 15);
    
    const telegramMessage = `🟢 Order ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ ${metadata.product_tag || 'N/A'}
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId.substring(0, 6)}
📍 ${country}
🧍${metadata.gender || 'N/A'} ${metadata.age || 'N/A'}
🔗 ${metadata.creative_link || 'N/A'}
${metadata.utm_source || 'N/A'}
${metadata.utm_medium || 'N/A'}
${metadata.ad_name || 'N/A'}
${metadata.adset_name || 'N/A'}
${metadata.utm_campaign || 'N/A'}`;

    const slackMessage = `:large_green_circle: Order ${orderId.substring(0, 8)}... processed!
---------------------------
:credit_card: card
:moneybag: ${amount} ${currency}
:label: ${metadata.product_tag || 'N/A'}
---------------------------
:e-mail: ${email}
---------------------------
:round_pushpin: ${country}
:standing_person: ${metadata.gender || 'N/A'} ${metadata.age || 'N/A'}
:link: ${metadata.creative_link || 'N/A'}
${metadata.utm_source || 'N/A'}
${metadata.utm_medium || 'N/A'}
${metadata.ad_name || 'N/A'}
${metadata.adset_name || 'N/A'}
${metadata.utm_campaign || 'N/A'}`;
    
    // Отправляем в Telegram
    console.log('\n📱 ОТПРАВЛЯЕМ В TELEGRAM...');
    let telegramSent = false;
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: telegramMessage,
            disable_web_page_preview: true
          })
        });
        const telegramData = await telegramResponse.json();
        telegramSent = telegramData.ok;
        console.log(`✅ Telegram: ${telegramSent ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
      } catch (error) {
        console.log('❌ Telegram error:', error.message);
      }
    } else {
      console.log('❌ Telegram не настроен');
    }
    
    // Отправляем в Slack
    console.log('\n💬 ОТПРАВЛЯЕМ В SLACK...');
    let slackSent = false;
    if (process.env.SLACK_WEBHOOK_URL) {
      try {
        const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: slackMessage })
        });
        slackSent = slackResponse.ok;
        console.log(`✅ Slack: ${slackSent ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
      } catch (error) {
        console.log('❌ Slack error:', error.message);
      }
    } else {
      console.log('❌ Slack не настроен');
    }
    
    console.log('\n🎯 РЕЗУЛЬТАТЫ:');
    console.log(`✅ Telegram: ${telegramSent ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
    console.log(`✅ Slack: ${slackSent ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
    
    if (telegramSent || slackSent) {
      console.log('\n🎉 ПОСЛЕДНЯЯ ПОКУПКА ОТПРАВЛЕНА!');
      console.log('✅ Проверьте ваши каналы');
      console.log('✅ Все данные должны отображаться правильно');
      
      return res.status(200).json({ 
        success: true, 
        message: 'Последняя покупка отправлена!',
        telegram: telegramSent,
        slack: slackSent,
        payment_id: payment.id,
        customer_email: customer?.email || 'N/A'
      });
    } else {
      console.log('\n❌ Не удалось отправить уведомления');
      console.log('🔍 Проверьте настройки в Render');
      
      return res.status(500).json({ 
        success: false, 
        message: 'Не удалось отправить уведомления',
        telegram: telegramSent,
        slack: slackSent
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка отправки:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка отправки: ' + error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
