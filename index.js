import express from 'express';
import Stripe from 'stripe';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

// Stripe webhook endpoint
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('⚠️ Webhook получен, но уведомления отключены для предотвращения дублирования');
  res.json({received: true, notifications_disabled: true});
  return;
  
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      let session, paymentIntent;
      
      if (event.type === 'checkout.session.completed') {
        session = event.data.object;
        console.log('🎉 Новая покупка через checkout.session.completed:', session.id);
      } else if (event.type === 'payment_intent.succeeded') {
        paymentIntent = event.data.object;
        console.log('🎉 Новая покупка через payment_intent.succeeded:', paymentIntent.id);
      }
      
      // Получаем полную информацию о клиенте
      let customer = null;
      let paymentData = null;
      
      if (session) {
        if (session.customer) {
          customer = await stripe.customers.retrieve(session.customer);
          console.log('👤 Customer data from session:', JSON.stringify(customer, null, 2));
        }
        paymentData = session;
      } else if (paymentIntent) {
        if (paymentIntent.customer) {
          customer = await stripe.customers.retrieve(paymentIntent.customer);
          console.log('👤 Customer data from payment_intent:', JSON.stringify(customer, null, 2));
        }
        paymentData = paymentIntent;
      }
      
      // Получаем GEO данные
      let geoData = 'N/A';
      if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
        geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
      } else if (customer?.address?.country) {
        geoData = customer.address.country;
      }
      
      console.log('🌍 GEO Data:', geoData);
      console.log('📊 Customer metadata:', customer?.metadata);
      
      // Формируем красивое уведомление
      const orderId = paymentData.id.substring(0, 9); // Берем первые 9 символов
      const amount = session ? (session.amount_total / 100).toFixed(2) : (paymentIntent.amount / 100).toFixed(2);
      const currency = (session?.currency || paymentIntent?.currency)?.toUpperCase() || 'USD';
      const email = customer?.email || 'N/A';
      const country = customer?.metadata?.geo_country || 'N/A';
      const city = customer?.metadata?.geo_city || '';
      const geo = city ? `${city}, ${country}` : country;
      
      const telegramText = `🟢 Order ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ N/A
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId}
📍 ${country}
🧍 N/A
🔗 N/A
${customer?.metadata?.utm_source || 'N/A'}
${customer?.metadata?.utm_medium || 'N/A'}
${customer?.metadata?.ad_name || 'N/A'}
${customer?.metadata?.adset_name || 'N/A'}
${customer?.metadata?.utm_campaign || 'N/A'}`;
      
      // Telegram
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: telegramText
          })
        });
        console.log('✅ Telegram уведомление отправлено');
      }
      
      // Slack
      if (process.env.SLACK_WEBHOOK_URL) {
        await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: telegramText })
        });
        console.log('✅ Slack уведомление отправлено');
      }
      
      // Добавляем новую покупку в Google Sheets
      if (process.env.GOOGLE_SHEETS_DOC_ID && process.env.GOOGLE_SERVICE_EMAIL && process.env.GOOGLE_SERVICE_PRIVATE_KEY) {
        try {
          // Создаем JWT токен для Google Sheets
          const header = { "alg": "RS256", "typ": "JWT" };
          const now = Math.floor(Date.now() / 1000);
          const payload = {
            iss: process.env.GOOGLE_SERVICE_EMAIL,
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600
          };

          const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
          const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

          const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY
            .replace(/\\n/g, '\n')
            .replace(/"/g, '');

          const signature = crypto.createSign('RSA-SHA256')
            .update(`${encodedHeader}.${encodedPayload}`)
            .sign(privateKey, 'base64url');

          const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;

          // Получаем access token
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
          });

          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            
            // Добавляем новую строку в Google Sheets
            const newRow = [
              paymentData.id,
              amount,
              currency,
              'succeeded',
              new Date(paymentData.created * 1000).toISOString(),
              customer?.id || 'N/A',
              customer?.email || 'N/A',
              geo,
              customer?.metadata?.utm_source || 'N/A',
              customer?.metadata?.utm_medium || 'N/A',
              customer?.metadata?.utm_campaign || 'N/A',
              customer?.metadata?.utm_content || 'N/A',
              customer?.metadata?.utm_term || 'N/A',
              customer?.metadata?.ad_name || 'N/A',
              customer?.metadata?.adset_name || 'N/A'
            ];

            const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:O:append?valueInputOption=RAW`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ values: [newRow] })
            });

            if (sheetsResponse.ok) {
              console.log('✅ Google Sheets обновлен новой покупкой');
            } else {
              const errorText = await sheetsResponse.text();
              console.log('❌ Ошибка обновления Google Sheets:', errorText);
            }
          }
        } catch (error) {
          console.log('❌ Ошибка Google Sheets:', error.message);
        }
      }
      
      return res.json({ ok: true });
    }
    
    res.json({ ok: true, ignored: event.type });
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).send('Server error');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Force process all payments endpoint
app.post('/api/force-process-payments', async (req, res) => {
  try {
    console.log('🔄 Принудительная обработка всех платежей...');
    
    // Получаем все платежи
    const payments = await stripe.paymentIntents.list({ limit: 100 });
    console.log(`📊 Найдено платежей: ${payments.data.length}`);
    
    let processed = 0;
    let notified = 0;
    
    for (const payment of payments.data) {
      if (payment.status === 'succeeded' && payment.customer) {
        try {
          const customer = await stripe.customers.retrieve(payment.customer);
          
          // Отправляем уведомления
          if (!notifiedPayments.has(payment.id)) {
            const orderId = payment.id.substring(0, 9);
            const amount = (payment.amount / 100).toFixed(2);
            const currency = payment.currency.toUpperCase();
            const email = customer?.email || 'N/A';
            const country = customer?.metadata?.geo_country || 'N/A';
            const city = customer?.metadata?.geo_city || '';
            const geo = city ? `${city}, ${country}` : country;

            const telegramText = `🟢 Order ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ N/A
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId}
📍 ${country}
🧍 N/A
🔗 N/A
${customer?.metadata?.utm_source || 'N/A'}
${customer?.metadata?.utm_medium || 'N/A'}
${customer?.metadata?.ad_name || 'N/A'}
${customer?.metadata?.adset_name || 'N/A'}
${customer?.metadata?.utm_campaign || 'N/A'}`;

            // Telegram
            if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
              await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: process.env.TELEGRAM_CHAT_ID,
                  text: telegramText
                })
              });
              notifiedPayments.add(payment.id);
              notified++;
            }

            // Slack
            if (process.env.SLACK_WEBHOOK_URL) {
              await fetch(process.env.SLACK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: telegramText })
              });
            }
          }
          
          processedPayments.add(payment.id);
          processed++;
          
        } catch (error) {
          console.log(`❌ Ошибка обработки платежа ${payment.id}:`, error.message);
        }
      }
    }
    
    return res.json({
      success: true,
      message: 'Принудительная обработка завершена',
      total_payments: payments.data.length,
      processed: processed,
      notified: notified
    });
    
  } catch (error) {
    console.log('❌ Ошибка принудительной обработки:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Ошибка обработки',
      error: error.message
    });
  }
});

// Test API polling endpoint
app.post('/api/test-api-polling', async (req, res) => {
  try {
    console.log('🔍 Тестируем API polling...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ 
      limit: 5
    });
    
    console.log(`📊 Найдено платежей: ${payments.data.length}`);
    
    const results = [];
    for (const payment of payments.data) {
      if (payment.status === 'succeeded' && payment.customer) {
        const customer = await stripe.customers.retrieve(payment.customer);
        results.push({
          payment_id: payment.id,
          amount: (payment.amount / 100).toFixed(2),
          currency: payment.currency,
          email: customer?.email || 'N/A',
          geo_country: customer?.metadata?.geo_country || 'N/A',
          geo_city: customer?.metadata?.geo_city || 'N/A',
          utm_source: customer?.metadata?.utm_source || 'N/A',
          utm_medium: customer?.metadata?.utm_medium || 'N/A',
          ad_name: customer?.metadata?.ad_name || 'N/A',
          processed: processedPayments.has(payment.id),
          notified: notifiedPayments.has(payment.id)
        });
      }
    }
    
    return res.json({
      success: true,
      message: 'API polling тест завершен',
      payments_found: payments.data.length,
      successful_payments: results.length,
      results: results
    });
    
  } catch (error) {
    console.log('❌ Ошибка тестирования API polling:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Ошибка тестирования',
      error: error.message
    });
  }
});

// Test webhook simulation endpoint
app.post('/api/test-webhook-simulation', async (req, res) => {
  try {
    console.log('🔍 Симулируем webhook событие...');
    
    // Получаем последний платеж
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    if (payments.data.length === 0) {
      return res.json({ success: false, message: 'Нет платежей для тестирования' });
    }
    
    const payment = payments.data[0];
    let customer = null;
    if (payment.customer) {
      customer = await stripe.customers.retrieve(payment.customer);
    }
    
    console.log('👤 Customer data:', JSON.stringify(customer?.metadata, null, 2));
    
    // Симулируем webhook событие
    const mockEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: payment
      }
    };
    
    // Формируем данные как в webhook
    const orderId = payment.id.substring(0, 9);
    const amount = (payment.amount / 100).toFixed(2);
    const currency = payment.currency.toUpperCase();
    const email = customer?.email || 'N/A';
    const country = customer?.metadata?.geo_country || 'N/A';
    const city = customer?.metadata?.geo_city || '';
    const geo = city ? `${city}, ${country}` : country;
    
    const telegramText = `🟢 Order ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ N/A
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId}
📍 ${country}
🧍 N/A
🔗 N/A
${customer?.metadata?.utm_source || 'N/A'}
${customer?.metadata?.utm_medium || 'N/A'}
${customer?.metadata?.ad_name || 'N/A'}
${customer?.metadata?.adset_name || 'N/A'}
${customer?.metadata?.utm_campaign || 'N/A'}`;
    
    return res.json({
      success: true,
      message: 'Webhook симуляция завершена',
      telegram_text: telegramText,
      customer_metadata: customer?.metadata,
      geo_data: geo,
      utm_source: customer?.metadata?.utm_source,
      utm_medium: customer?.metadata?.utm_medium,
      utm_campaign: customer?.metadata?.utm_campaign,
      ad_name: customer?.metadata?.ad_name,
      adset_name: customer?.metadata?.adset_name
    });
    
  } catch (error) {
    console.log('❌ Ошибка симуляции webhook:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Ошибка симуляции',
      error: error.message
    });
  }
});

// Test webhook data endpoint
app.post('/api/test-webhook-data', async (req, res) => {
  try {
    console.log('🔍 Тестируем webhook данные...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ limit: 5 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    const results = [];
    
    for (const payment of payments.data) {
      let customer = null;
      if (payment.customer) {
        customer = await stripe.customers.retrieve(payment.customer);
      }
      
      const paymentData = {
        payment_id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        created: payment.created,
        customer_id: payment.customer,
        customer_email: customer?.email,
        customer_metadata: customer?.metadata,
        customer_address: customer?.address,
        payment_metadata: payment.metadata
      };
      
      results.push(paymentData);
      console.log(`📝 Payment ${payment.id}:`, {
        customer_email: customer?.email,
        customer_metadata: customer?.metadata,
        payment_metadata: payment.metadata
      });
    }
    
    return res.json({
      success: true,
      message: 'Webhook данные проанализированы',
      payments_count: results.length,
      payments: results
    });
    
  } catch (error) {
    console.log('❌ Ошибка тестирования webhook данных:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Ошибка тестирования',
      error: error.message
    });
  }
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
        
        <button id="testPollingButton" class="button" onclick="testApiPolling()">
            🔍 Тест API Polling
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
            
            async function testApiPolling() {
                const button = document.getElementById('testPollingButton');
                const result = document.getElementById('result');
                
                button.disabled = true;
                button.textContent = '⏳ Тестируем...';
                result.innerHTML = '';
                
                try {
                    const response = await fetch('/api/test-api-polling', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        result.className = 'result success';
                        result.innerHTML = \`✅ API POLLING ТЕСТ ЗАВЕРШЕН!
                        
📊 Найдено платежей: \${data.payments_found}
✅ Успешных платежей: \${data.successful_payments}

\${data.results.map(p => \`
💳 \${p.payment_id}
💰 \${p.amount} \${p.currency}
📧 \${p.email}
🌍 \${p.geo_city}, \${p.geo_country}
📱 \${p.utm_source} / \${p.utm_medium}
🎯 \${p.ad_name}
🔄 Обработан: \${p.processed ? 'ДА' : 'НЕТ'}
📱 Уведомлен: \${p.notified ? 'ДА' : 'НЕТ'}
---\`).join('')}\`;
                    } else {
                        result.className = 'result error';
                        result.innerHTML = \`❌ ОШИБКА: \${data.message}\`;
                    }
                } catch (error) {
                    result.className = 'result error';
                    result.innerHTML = \`❌ ОШИБКА: \${error.message}\`;
                } finally {
                    button.disabled = false;
                    button.textContent = '🔍 Тест API Polling';
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

// Test Google Sheets endpoint
app.post('/api/test-google-sheets', async (req, res) => {
  console.log('🔍 Тестируем Google Sheets API...');
  
  const GOOGLE_SHEETS_DOC_ID = process.env.GOOGLE_SHEETS_DOC_ID;
  const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
  const GOOGLE_SERVICE_PRIVATE_KEY = process.env.GOOGLE_SERVICE_PRIVATE_KEY;
  
  console.log('GOOGLE_SHEETS_DOC_ID:', GOOGLE_SHEETS_DOC_ID ? 'Настроен' : 'НЕ НАСТРОЕН');
  console.log('GOOGLE_SERVICE_EMAIL:', GOOGLE_SERVICE_EMAIL ? 'Настроен' : 'НЕ НАСТРОЕН');
  console.log('GOOGLE_SERVICE_PRIVATE_KEY:', GOOGLE_SERVICE_PRIVATE_KEY ? 'Настроен' : 'НЕ НАСТРОЕН');
  
  if (!GOOGLE_SHEETS_DOC_ID || !GOOGLE_SERVICE_EMAIL || !GOOGLE_SERVICE_PRIVATE_KEY) {
    return res.status(400).json({ 
      success: false, 
      message: 'Google Sheets не настроен полностью',
      details: {
        GOOGLE_SHEETS_DOC_ID: !!GOOGLE_SHEETS_DOC_ID,
        GOOGLE_SERVICE_EMAIL: !!GOOGLE_SERVICE_EMAIL,
        GOOGLE_SERVICE_PRIVATE_KEY: !!GOOGLE_SERVICE_PRIVATE_KEY
      }
    });
  }
  
  try {
    // Создаем JWT токен
    const header = {
      "alg": "RS256",
      "typ": "JWT"
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    // Кодируем header и payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createSign('RSA-SHA256')
      .update(`${encodedHeader}.${encodedPayload}`)
      .sign(GOOGLE_SERVICE_PRIVATE_KEY, 'base64url');
    
    const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Получаем access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.log('❌ Ошибка получения токена:', errorText);
      return res.status(500).json({ 
        success: false, 
        message: 'Ошибка получения токена',
        error: errorText
      });
    }
    
    const tokenData = await tokenResponse.json();
    console.log('✅ Токен получен успешно');
    
    // Тестируем запись в Google Sheets
    const testData = [
      ['Payment ID', 'Amount', 'Currency', 'Status', 'Created', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name']
    ];
    
    const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_DOC_ID}/values/A1:O1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: testData })
    });
    
    if (sheetsResponse.ok) {
      console.log('✅ Google Sheets тест успешен!');
      return res.status(200).json({ 
        success: true, 
        message: 'Google Sheets тест успешен!',
        sheet_url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_DOC_ID}`
      });
    } else {
      const errorText = await sheetsResponse.text();
      console.log('❌ Google Sheets error:', errorText);
      return res.status(500).json({ 
        success: false, 
        message: 'Ошибка записи в Google Sheets',
        error: errorText
      });
    }
    
  } catch (error) {
    console.log('❌ Google Sheets error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка Google Sheets',
      error: error.message
    });
  }
});

// Export all payments to Google Sheets endpoint
app.post('/api/export-all-payments', async (req, res) => {
  console.log('🔄 Экспорт ВСЕХ платежей в Google Sheets...');
  
  try {
    // Получаем ВСЕ платежи
    const payments = await stripe.paymentIntents.list({ limit: 100 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    // Сортируем платежи по дате создания (старые → новые)
    payments.data.sort((a, b) => a.created - b.created);
    console.log('📅 Платежи отсортированы: старые → новые');
    
    // Создаем правильный JWT токен
    const header = {
      "alg": "RS256",
      "typ": "JWT"
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    // Кодируем header и payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    // Исправляем формат приватного ключа
    const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .replace(/"/g, '');
    
    const signature = crypto.createSign('RSA-SHA256')
      .update(`${encodedHeader}.${encodedPayload}`)
      .sign(privateKey, 'base64url');
    
    const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Получаем access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.log('❌ Ошибка получения токена:', errorText);
      return res.status(500).json({ 
        success: false, 
        message: 'Ошибка получения токена',
        error: errorText
      });
    }
    
    const tokenData = await tokenResponse.json();
    console.log('✅ Токен получен успешно');
    
    // Группируем покупки по клиенту и дате (в пределах 1 часа)
    const groupedPurchases = new Map();
    
    for (const payment of payments.data) {
      if (payment.status === 'succeeded' && payment.customer) {
        const customer = await stripe.customers.retrieve(payment.customer);
        const customerIdForNotification = customer?.id;
        const purchaseDateForNotification = new Date(payment.created * 1000);
        const dateKey = `${customerIdForNotification}_${purchaseDateForNotification.toISOString().split('T')[0]}`; // Группируем по клиенту и дню
        
        if (!groupedPurchases.has(dateKey)) {
          groupedPurchases.set(dateKey, {
            customer,
            payments: [],
            totalAmount: 0,
            firstPayment: payment
          });
        }
        
        const group = groupedPurchases.get(dateKey);
        group.payments.push(payment);
        group.totalAmount += payment.amount;
      }
    }
    
    // Подготавливаем данные для экспорта
    const exportData = [
      ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
    ];
    
    for (const [dateKey, group] of groupedPurchases) {
      const customer = group.customer;
      const firstPayment = group.firstPayment;
      
      // Формируем GEO данные
      let geoData = 'N/A';
      if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
        geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
      } else if (customer?.address?.country) {
        geoData = customer.address.country;
      }
      
      const utcTime = new Date(firstPayment.created * 1000).toISOString();
      const localTime = new Date(firstPayment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
      
      // Создаем уникальный ID покупки на основе клиента и даты
      const purchaseId = `purchase_${customer?.id}_${dateKey.split('_')[1]}`;
      
      const row = [
        purchaseId,
        (group.totalAmount / 100).toFixed(2),
        firstPayment.currency.toUpperCase(),
        'succeeded',
        utcTime,
        localTime,
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        geoData,
        customer?.metadata?.utm_source || 'N/A',
        customer?.metadata?.utm_medium || 'N/A',
        customer?.metadata?.utm_campaign || 'N/A',
        customer?.metadata?.utm_content || 'N/A',
        customer?.metadata?.utm_term || 'N/A',
        customer?.metadata?.ad_name || 'N/A',
        customer?.metadata?.adset_name || 'N/A',
        group.payments.length // Количество платежей в группе
      ];
      
      exportData.push(row);
    }
    
    console.log(`📝 Подготовлено ${exportData.length} строк для экспорта`);
    
    // Сначала очищаем весь лист
    const clearResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Z:clear`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (clearResponse.ok) {
      console.log('✅ Лист очищен');
    } else {
      console.log('⚠️ Не удалось очистить лист, продолжаем...');
    }

    // Теперь записываем новые данные
    const range = `A1:Q${exportData.length}`;
    const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/${range}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: exportData })
    });
    
    if (sheetsResponse.ok) {
      console.log('✅ Google Sheets экспорт успешен!');
      console.log(`📊 Экспортировано ${exportData.length - 1} платежей`);
      return res.status(200).json({ 
        success: true, 
        message: 'Google Sheets экспорт успешен!',
        exported_count: exportData.length - 1,
        sheet_url: `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_DOC_ID}`
      });
    } else {
      const errorText = await sheetsResponse.text();
      console.log('❌ Google Sheets error:', errorText);
      return res.status(500).json({ 
        success: false, 
        message: 'Ошибка записи в Google Sheets',
        error: errorText
      });
    }
    
  } catch (error) {
    console.log('❌ Ошибка экспорта:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка экспорта',
      error: error.message
    });
  }
});

// Хранилище обработанных платежей (глобальное, не сбрасывается)
const processedPayments = new Set();
const notifiedPayments = new Set();

// Очищаем хранилище при запуске
console.log('🧹 Очищаем хранилище обработанных платежей');
processedPayments.clear();
notifiedPayments.clear();

// API polling отключен для предотвращения дублирования
// setInterval(async () => {
  try {
    console.log('🔄 Проверяем новые покупки...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ 
      limit: 10
    });
    
    console.log(`📊 Найдено платежей: ${payments.data.length}`);
    
    for (const payment of payments.data) {
      if (payment.status === 'succeeded' && payment.customer) {
        // Проверяем, не обрабатывали ли уже этот платеж
        if (processedPayments.has(payment.id)) {
          console.log(`⏭️ Платеж ${payment.id} уже обработан, пропускаем`);
          continue;
        }
        
        try {
          console.log(`🔄 Обрабатываем новый платеж: ${payment.id}`);
          processedPayments.add(payment.id);
          const customer = await stripe.customers.retrieve(payment.customer);
          
          console.log('🔍 Данные клиента:', {
            id: customer?.id,
            email: customer?.email,
            metadata_keys: Object.keys(customer?.metadata || {}),
            geo_country: customer?.metadata?.geo_country,
            geo_city: customer?.metadata?.geo_city,
            utm_source: customer?.metadata?.utm_source
          });
          
          // Проверяем, есть ли уже в Google Sheets
          if (process.env.GOOGLE_SHEETS_DOC_ID && process.env.GOOGLE_SERVICE_EMAIL && process.env.GOOGLE_SERVICE_PRIVATE_KEY) {
            // Создаем JWT токен для Google Sheets
            const header = { "alg": "RS256", "typ": "JWT" };
            const now = Math.floor(Date.now() / 1000);
            const payload = {
              iss: process.env.GOOGLE_SERVICE_EMAIL,
              scope: 'https://www.googleapis.com/auth/spreadsheets',
              aud: 'https://oauth2.googleapis.com/token',
              iat: now,
              exp: now + 3600
            };

            const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
            const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

            const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY
              .replace(/\\n/g, '\n')
              .replace(/"/g, '');

            const signature = crypto.createSign('RSA-SHA256')
              .update(`${encodedHeader}.${encodedPayload}`)
              .sign(privateKey, 'base64url');

            const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;

            // Получаем access token
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
            });

            if (tokenResponse.ok) {
              const tokenData = await tokenResponse.json();

              // Получаем GEO данные
              let geoData = 'N/A';
              if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
                geoData = `${customer.metadata.geo_city}, ${customer.metadata.geo_country}`;
              } else if (customer?.address?.country) {
                geoData = customer.address.country;
              } else if (customer?.metadata?.geo_country) {
                geoData = customer.metadata.geo_country;
              }

              console.log('🔍 Customer metadata for Google Sheets:', JSON.stringify(customer?.metadata, null, 2));

                     // Группируем уведомления по клиенту и дате
                     const customerIdForNotification2 = customer?.id;
                     const purchaseDateForNotification2 = new Date(payment.created * 1000);
                     const dateKey = `${customerIdForNotification2}_${purchaseDateForNotification2.toISOString().split('T')[0]}`;
                     
                     if (!notifiedPayments.has(dateKey)) {
                       console.log(`📱 Отправляем уведомления для покупки: ${dateKey}`);
                       notifiedPayments.add(dateKey);
                       
                       // Получаем все платежи этого клиента за этот день
                       const customerPayments = payments.data.filter(p => 
                         p.status === 'succeeded' && 
                         p.customer === customerId &&
                         new Date(p.created * 1000).toISOString().split('T')[0] === purchaseDate.toISOString().split('T')[0]
                       );
                       
                       const totalAmount = customerPayments.reduce((sum, p) => sum + p.amount, 0);
                       const orderId = payment.id.substring(0, 9);
                       const amount = (totalAmount / 100).toFixed(2);
                       const currency = payment.currency.toUpperCase();
                       const email = customer?.email || 'N/A';
                       const country = customer?.metadata?.geo_country || 'N/A';
                       const city = customer?.metadata?.geo_city || '';
                       const geo = city ? `${city}, ${country}` : country;

                       console.log('🔍 Данные для уведомления:', {
                         email,
                         country,
                         city,
                         geo,
                         totalAmount: amount,
                         paymentCount: customerPayments.length,
                         utm_source: customer?.metadata?.utm_source,
                         utm_medium: customer?.metadata?.utm_medium,
                         ad_name: customer?.metadata?.ad_name
                       });

                       const telegramText = `🟢 Purchase ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ ${customerPayments.length} payment${customerPayments.length > 1 ? 's' : ''}
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId}
📍 ${country}
🧍 N/A
🔗 N/A
${customer?.metadata?.utm_source || 'N/A'}
${customer?.metadata?.utm_medium || 'N/A'}
${customer?.metadata?.ad_name || 'N/A'}
${customer?.metadata?.adset_name || 'N/A'}
${customer?.metadata?.utm_campaign || 'N/A'}`;

                       // Telegram
                       if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                         await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({
                             chat_id: process.env.TELEGRAM_CHAT_ID,
                             text: telegramText
                           })
                         });
                         console.log('✅ Telegram уведомление отправлено через API polling');
                       }

                       // Slack
                       if (process.env.SLACK_WEBHOOK_URL) {
                         await fetch(process.env.SLACK_WEBHOOK_URL, {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ text: telegramText })
                         });
                         console.log('✅ Slack уведомление отправлено через API polling');
                       }
                     }

              // Проверяем, есть ли уже этот платеж в Google Sheets
              const checkResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:A?valueInputOption=RAW`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'Content-Type': 'application/json'
                }
              });

              if (checkResponse.ok) {
                const checkData = await checkResponse.json();
                const existingIds = checkData.values?.flat() || [];
                
                if (existingIds.includes(payment.id)) {
                  console.log(`⏭️ Платеж ${payment.id} уже есть в Google Sheets, пропускаем`);
                  continue;
                }
              }

              // Группируем покупки по клиенту и дате для Google Sheets
              const customerIdForGrouping = customer?.id;
              const purchaseDateForGrouping = new Date(payment.created * 1000);
              const dateKey = `${customerIdForGrouping}_${purchaseDateForGrouping.toISOString().split('T')[0]}`;
              
              // Проверяем, есть ли уже покупка этого клиента за этот день
              const existingPurchaseResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Q?valueInputOption=RAW`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'Content-Type': 'application/json'
                }
              });
              
              let shouldAddPurchase = true;
              let existingRowIndex = -1;
              
              if (existingPurchaseResponse.ok) {
                const existingData = await existingPurchaseResponse.json();
                const rows = existingData.values || [];
                
                // Ищем существующую покупку этого клиента за этот день
                for (let i = 1; i < rows.length; i++) {
                  const row = rows[i];
                  if (row[6] === customerIdForGrouping && row[4]?.includes(dateKey.split('_')[1])) {
                    // Найдена существующая покупка - обновляем ее
                    existingRowIndex = i;
                    shouldAddPurchase = false;
                    break;
                  }
                }
              }
              
              if (shouldAddPurchase) {
                // Добавляем новую покупку
                const utcTime = new Date(payment.created * 1000).toISOString();
                const localTime = new Date(payment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
                
                const purchaseId = `purchase_${customerIdForGrouping}_${dateKey.split('_')[1]}`;
                
                const newRow = [
                  purchaseId,
                  (payment.amount / 100).toFixed(2),
                  payment.currency.toUpperCase(),
                  'succeeded',
                  utcTime,
                  localTime,
                  customer?.id || 'N/A',
                  customer?.email || 'N/A',
                  geoData,
                  customer?.metadata?.utm_source || 'N/A',
                  customer?.metadata?.utm_medium || 'N/A',
                  customer?.metadata?.utm_campaign || 'N/A',
                  customer?.metadata?.utm_content || 'N/A',
                  customer?.metadata?.utm_term || 'N/A',
                  customer?.metadata?.ad_name || 'N/A',
                  customer?.metadata?.adset_name || 'N/A',
                  1 // Payment Count
                ];
                
                const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Q:append?valueInputOption=RAW`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${tokenData.access_token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ values: [newRow] })
                });
                
                if (sheetsResponse.ok) {
                  console.log('✅ Новая покупка добавлена в Google Sheets:', purchaseId);
                }
              } else {
                // Обновляем существующую покупку
                console.log('🔄 Обновляем существующую покупку для клиента:', customerIdForGrouping);
                // Здесь можно добавить логику обновления существующей покупки
              }
            }
          }
        } catch (error) {
          console.log('❌ Ошибка обработки платежа:', error.message);
        }
      }
    }
  } catch (error) {
    console.log('❌ Ошибка API polling:', error.message);
  }
// }, 5 * 60 * 1000); // каждые 5 минут - ОТКЛЮЧЕНО

// Автоматическое обновление Google Sheets каждые 10 минут
setInterval(async () => {
  try {
    console.log('🔄 Автоматическое обновление Google Sheets...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ 
      limit: 20
    });
    
    console.log(`📊 Найдено платежей: ${payments.data.length}`);
    
    // Группируем покупки по клиенту и дате
    const groupedPurchases = new Map();
    
    for (const payment of payments.data) {
      if (payment.status === 'succeeded' && payment.customer) {
        const customer = await stripe.customers.retrieve(payment.customer);
        const customerIdForExport = customer?.id;
        const purchaseDateForExport = new Date(payment.created * 1000);
        const dateKey = `${customerIdForExport}_${purchaseDateForExport.toISOString().split('T')[0]}`;
        
        if (!groupedPurchases.has(dateKey)) {
          groupedPurchases.set(dateKey, {
            customer,
            payments: [],
            totalAmount: 0,
            firstPayment: payment
          });
        }
        
        const group = groupedPurchases.get(dateKey);
        group.payments.push(payment);
        group.totalAmount += payment.amount;
      }
    }
    
    console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);
    
    // Обновляем Google Sheets
    if (process.env.GOOGLE_SHEETS_DOC_ID && process.env.GOOGLE_SERVICE_EMAIL && process.env.GOOGLE_SERVICE_PRIVATE_KEY) {
      // Создаем JWT токен для Google Sheets
      const header = { "alg": "RS256", "typ": "JWT" };
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: process.env.GOOGLE_SERVICE_EMAIL,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
      };

      const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

      const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY
        .replace(/\\n/g, '\n')
        .replace(/"/g, '');

      const signature = crypto.createSign('RSA-SHA256')
        .update(`${encodedHeader}.${encodedPayload}`)
        .sign(privateKey, 'base64url');

      const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;

      // Получаем access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        
        // Подготавливаем данные для экспорта
        const exportData = [
          ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
        ];
        
        for (const [dateKey, group] of groupedPurchases) {
          const customer = group.customer;
          const firstPayment = group.firstPayment;
          
          // Формируем GEO данные
          let geoData = 'N/A';
          if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
            geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
          } else if (customer?.address?.country) {
            geoData = customer.address.country;
          }
          
          const utcTime = new Date(firstPayment.created * 1000).toISOString();
          const localTime = new Date(firstPayment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
          
          // Создаем уникальный ID покупки на основе клиента и даты
          const purchaseId = `purchase_${customer?.id}_${dateKey.split('_')[1]}`;
          
          const row = [
            purchaseId,
            (group.totalAmount / 100).toFixed(2),
            firstPayment.currency.toUpperCase(),
            'succeeded',
            utcTime,
            localTime,
            customer?.id || 'N/A',
            customer?.email || 'N/A',
            geoData,
            customer?.metadata?.utm_source || 'N/A',
            customer?.metadata?.utm_medium || 'N/A',
            customer?.metadata?.utm_campaign || 'N/A',
            customer?.metadata?.utm_content || 'N/A',
            customer?.metadata?.utm_term || 'N/A',
            customer?.metadata?.ad_name || 'N/A',
            customer?.metadata?.adset_name || 'N/A',
            group.payments.length // Количество платежей в группе
          ];
          
          exportData.push(row);
        }
        
        // Очищаем лист и записываем новые данные
        const clearResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Z:clear`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (clearResponse.ok) {
          console.log('✅ Лист очищен');
        }
        
        const range = `A1:Q${exportData.length}`;
        const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/${range}?valueInputOption=RAW`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: exportData })
        });
        
        if (sheetsResponse.ok) {
          console.log('✅ Google Sheets автоматически обновлен:', exportData.length - 1, 'покупок');
        }
      }
    }
  } catch (error) {
    console.log('❌ Ошибка автоматического обновления:', error.message);
  }
}, 5 * 60 * 1000); // каждые 5 минут

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('🔄 Автоматическое обновление Google Sheets каждые 5 минут');
  
  // Принудительно запускаем API polling при старте
  setTimeout(async () => {
    console.log('🚀 Принудительный запуск API polling...');
    try {
      const payments = await stripe.paymentIntents.list({ limit: 10 });
      console.log(`📊 Найдено платежей при запуске: ${payments.data.length}`);
      
      for (const payment of payments.data) {
        if (payment.status === 'succeeded' && payment.customer) {
          if (!processedPayments.has(payment.id)) {
            console.log(`🔄 Обрабатываем платеж при запуске: ${payment.id}`);
            processedPayments.add(payment.id);
            
            const customer = await stripe.customers.retrieve(payment.customer);
            const customerIdForStartup = customer?.id;
            const purchaseDateForStartup = new Date(payment.created * 1000);
            const dateKey = `${customerIdForStartup}_${purchaseDateForStartup.toISOString().split('T')[0]}`;
            
            if (!notifiedPayments.has(dateKey)) {
              console.log(`📱 Отправляем уведомления для покупки: ${dateKey}`);
              notifiedPayments.add(dateKey);
              
              const customerPayments = payments.data.filter(p => 
                p.status === 'succeeded' && 
                p.customer === customerId &&
                new Date(p.created * 1000).toISOString().split('T')[0] === purchaseDate.toISOString().split('T')[0]
              );
              
              const totalAmount = customerPayments.reduce((sum, p) => sum + p.amount, 0);
              const orderId = payment.id.substring(0, 9);
              const amount = (totalAmount / 100).toFixed(2);
              const currency = payment.currency.toUpperCase();
              const email = customer?.email || 'N/A';
              const country = customer?.metadata?.geo_country || 'N/A';
              const city = customer?.metadata?.geo_city || '';
              const geo = city ? `${city}, ${country}` : country;

              const telegramText = `🟢 Purchase ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ ${customerPayments.length} payment${customerPayments.length > 1 ? 's' : ''}
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId}
📍 ${country}
🧍 N/A
🔗 N/A
${customer?.metadata?.utm_source || 'N/A'}
${customer?.metadata?.utm_medium || 'N/A'}
${customer?.metadata?.ad_name || 'N/A'}
${customer?.metadata?.adset_name || 'N/A'}
${customer?.metadata?.utm_campaign || 'N/A'}`;

              // Telegram
              if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: process.env.TELEGRAM_CHAT_ID,
                    text: telegramText
                  })
                });
                console.log('✅ Telegram уведомление отправлено при запуске');
              }

              // Slack
              if (process.env.SLACK_WEBHOOK_URL) {
                await fetch(process.env.SLACK_WEBHOOK_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: telegramText })
                });
                console.log('✅ Slack уведомление отправлено при запуске');
              }
            }
          }
        }
      }
    } catch (error) {
      console.log('❌ Ошибка принудительного API polling:', error.message);
    }
  }, 10000); // Запускаем через 10 секунд после старта
});
