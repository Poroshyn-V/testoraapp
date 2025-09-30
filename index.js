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
    
    // Подготавливаем данные для экспорта
    const exportData = [
      ['Payment ID', 'Amount', 'Currency', 'Status', 'Created', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name']
    ];
    
    for (const payment of payments.data) {
      // Получаем данные клиента
      let customer = null;
      if (payment.customer) {
        customer = await stripe.customers.retrieve(payment.customer);
      }
      
      // Формируем GEO данные
      let geoData = 'N/A';
      if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
        geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
      } else if (customer?.address?.country) {
        geoData = customer.address.country;
      }
      
      const row = [
        payment.id,
        (payment.amount / 100).toFixed(2),
        payment.currency.toUpperCase(),
        payment.status,
        new Date(payment.created * 1000).toISOString(),
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        geoData,
        customer?.metadata?.utm_source || 'N/A',
        customer?.metadata?.utm_medium || 'N/A',
        customer?.metadata?.utm_campaign || 'N/A',
        customer?.metadata?.utm_content || 'N/A',
        customer?.metadata?.utm_term || 'N/A',
        customer?.metadata?.ad_name || 'N/A',
        customer?.metadata?.adset_name || 'N/A'
      ];
      
      exportData.push(row);
    }
    
    console.log(`📝 Подготовлено ${exportData.length} строк для экспорта`);
    
    // Очищаем лист и записываем новые данные
    const range = `A1:O${exportData.length}`;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
