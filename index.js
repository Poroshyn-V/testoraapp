import express from 'express';
import Stripe from 'stripe';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const processedEventIds = new Set();
const processedPayments = new Set();
const notifiedPayments = new Set();
const notifiedPurchases = new Set();

const normalizeValue = (value) => {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  const text = String(value).trim();
  return text.length === 0 ? 'N/A' : text;
};

const formatPerson = (gender, age) => {
  const parts = [normalizeValue(gender), normalizeValue(age)].filter((value) => value !== 'N/A');
  return parts.length > 0 ? parts.join(' ') : 'N/A';
};

const formatGeo = (city, country) => {
  const cityText = normalizeValue(city);
  const countryText = normalizeValue(country);
  if (cityText !== 'N/A' && countryText !== 'N/A') {
    return `${cityText}, ${countryText}`;
  }
  if (cityText !== 'N/A') {
    return cityText;
  }
  if (countryText !== 'N/A') {
    return countryText;
  }
  return 'N/A';
};

const buildTelegramText = ({
  orderId,
  amount,
  currency,
  productTag,
  email,
  country,
  city,
  person,
  creativeLink,
  metadata
}) => {
  const orderIdShort = orderId.length > 6 ? orderId.substring(0, 6) : orderId;
  const safeMeta = metadata || {};
  return `🟢 Order ${orderId} was processed!
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ ${normalizeValue(productTag)}
---------------------------
📧 ${normalizeValue(email)}
---------------------------
🌪️ ${orderIdShort}
📍 ${normalizeValue(country)}
🧍 ${normalizeValue(person)}
🔗 ${normalizeValue(creativeLink)}
${normalizeValue(safeMeta.utm_source)}
${normalizeValue(safeMeta.utm_medium)}
${normalizeValue(safeMeta.ad_name)}
${normalizeValue(safeMeta.adset_name)}
${normalizeValue(safeMeta.utm_campaign)}`;
};

const sendTelegram = async (text) => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });

  const data = await response.json();
  return Boolean(data.ok);
};

const sendSlack = async (text) => {
  if (!process.env.SLACK_WEBHOOK_URL) {
    return false;
  }

  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  return response.ok;
};

const requireAdminKey = (req, res, next) => {
  if (!process.env.ADMIN_API_KEY) {
    return next();
  }

  const providedKey = req.get('x-api-key') || req.query.api_key;
  if (providedKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
};

const getCustomerSafe = async (customerId) => {
  if (!customerId) {
    return null;
  }

  try {
    return await stripe.customers.retrieve(customerId);
  } catch (error) {
    console.log(`❌ Ошибка получения customer ${customerId}:`, error.message);
    return null;
  }
};

// Stripe webhook endpoint
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (process.env.DISABLE_WEBHOOK_NOTIFICATIONS === 'true') {
    console.log('⚠️ Webhook получен, но уведомления отключены (DISABLE_WEBHOOK_NOTIFICATIONS=true)');
    return res.json({ received: true, notifications_disabled: true });
  }

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (processedEventIds.has(event.id)) {
      return res.json({ ok: true, duplicate: true, event_id: event.id });
    }
    processedEventIds.add(event.id);

    const isCheckout = event.type === 'checkout.session.completed';
    const isPaymentIntent = event.type === 'payment_intent.succeeded';
    if (!isCheckout && !isPaymentIntent) {
      return res.json({ ok: true, ignored: event.type });
    }

    const paymentData = event.data.object;
    const paymentKey = isCheckout ? (paymentData.payment_intent || paymentData.id) : paymentData.id;
    if (!paymentKey) {
      return res.json({ ok: true, ignored: 'missing_payment_id' });
    }

    if (notifiedPayments.has(paymentKey)) {
      return res.json({ ok: true, duplicate: true, payment_id: paymentKey });
    }
    notifiedPayments.add(paymentKey);

    console.log(`🎉 Новая покупка через ${event.type}:`, paymentKey);

    const customer = await getCustomerSafe(paymentData.customer);
    const metadata = { ...(paymentData.metadata || {}), ...(customer?.metadata || {}) };
    const amountCents = isCheckout
      ? (paymentData.amount_total ?? paymentData.amount_subtotal ?? 0)
      : (paymentData.amount || 0);
    const amount = (amountCents / 100).toFixed(2);
    const currency = (paymentData.currency || 'usd').toUpperCase();
    const email = customer?.email || paymentData.customer_details?.email || 'N/A';
    const country = metadata.geo_country || customer?.address?.country || 'N/A';
    const city = metadata.geo_city || '';
    const person = formatPerson(metadata.gender, metadata.age);
    const creativeLink = metadata.creative_link || 'N/A';
    const orderId = paymentKey.substring(0, 9);
    const geo = formatGeo(city, country);

    const telegramText = buildTelegramText({
      orderId,
      amount,
      currency,
      productTag: metadata.product_tag,
      email,
      country,
      city,
      person,
      creativeLink,
      metadata
    });

    const telegramSent = await sendTelegram(telegramText);
    if (telegramSent) {
      console.log('✅ Telegram уведомление отправлено');
    }

    const slackSent = await sendSlack(telegramText);
    if (slackSent) {
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
            paymentKey,
            amount,
            currency,
            'succeeded',
            new Date(paymentData.created * 1000).toISOString(),
            customer?.id || 'N/A',
            normalizeValue(email),
            geo,
            normalizeValue(metadata.utm_source),
            normalizeValue(metadata.utm_medium),
            normalizeValue(metadata.utm_campaign),
            normalizeValue(metadata.utm_content),
            normalizeValue(metadata.utm_term),
            normalizeValue(metadata.ad_name),
            normalizeValue(metadata.adset_name)
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

    return res.json({ ok: true, telegram: telegramSent, slack: slackSent });
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).send('Server error');
  }
});

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Force process all payments endpoint
app.post('/api/force-process-payments', requireAdminKey, async (req, res) => {
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
          const customer = await getCustomerSafe(payment.customer);

          // Отправляем уведомления
          if (!notifiedPayments.has(payment.id)) {
            const metadata = { ...(payment.metadata || {}), ...(customer?.metadata || {}) };
            const orderId = payment.id.substring(0, 9);
            const amount = (payment.amount / 100).toFixed(2);
            const currency = payment.currency.toUpperCase();
            const email = customer?.email || 'N/A';
            const country = metadata.geo_country || customer?.address?.country || 'N/A';
            const city = metadata.geo_city || '';
            const person = formatPerson(metadata.gender, metadata.age);
            const creativeLink = metadata.creative_link || 'N/A';

            const telegramText = buildTelegramText({
              orderId,
              amount,
              currency,
              productTag: metadata.product_tag,
              email,
              country,
              city,
              person,
              creativeLink,
              metadata
            });

            const telegramSent = await sendTelegram(telegramText);
            const slackSent = await sendSlack(telegramText);

            if (telegramSent || slackSent) {
              notifiedPayments.add(payment.id);
              notified++;
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
app.post('/api/test-api-polling', requireAdminKey, async (req, res) => {
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
app.post('/api/test-webhook-simulation', requireAdminKey, async (req, res) => {
  try {
    console.log('🔍 Симулируем webhook событие...');
    
    // Получаем последний платеж
    const payments = await stripe.paymentIntents.list({ limit: 1 });
    if (payments.data.length === 0) {
      return res.json({ success: false, message: 'Нет платежей для тестирования' });
    }
    
    const payment = payments.data[0];
    const customer = await getCustomerSafe(payment.customer);
    
    console.log('👤 Customer data:', JSON.stringify(customer?.metadata, null, 2));
    
    // Симулируем webhook событие
    const mockEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: payment
      }
    };
    
    // Формируем данные как в webhook
    const metadata = { ...(payment.metadata || {}), ...(customer?.metadata || {}) };
    const orderId = payment.id.substring(0, 9);
    const amount = (payment.amount / 100).toFixed(2);
    const currency = payment.currency.toUpperCase();
    const email = customer?.email || 'N/A';
    const country = metadata.geo_country || customer?.address?.country || 'N/A';
    const city = metadata.geo_city || '';
    const geo = formatGeo(city, country);
    const person = formatPerson(metadata.gender, metadata.age);
    const creativeLink = metadata.creative_link || 'N/A';
    
    const telegramText = buildTelegramText({
      orderId,
      amount,
      currency,
      productTag: metadata.product_tag,
      email,
      country,
      city,
      person,
      creativeLink,
      metadata
    });
    
    return res.json({
      success: true,
      message: 'Webhook симуляция завершена',
      telegram_text: telegramText,
      customer_metadata: customer?.metadata,
      geo_data: geo,
      utm_source: metadata.utm_source,
      utm_medium: metadata.utm_medium,
      utm_campaign: metadata.utm_campaign,
      ad_name: metadata.ad_name,
      adset_name: metadata.adset_name
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
app.post('/api/test-webhook-data', requireAdminKey, async (req, res) => {
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
        
        <button id="checkPaymentsButton" class="button" onclick="checkAllPayments()">
            📊 Проверить все платежи
        </button>
        
        <button id="exportAllButton" class="button" onclick="exportAllPayments()">
            🚀 Выгрузить ВСЕ покупки в Google Sheets
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
            
            async function checkAllPayments() {
                const button = document.getElementById('checkPaymentsButton');
                const result = document.getElementById('result');
                
                button.disabled = true;
                button.textContent = '⏳ Проверяем...';
                result.innerHTML = '';
                
                try {
                    const response = await fetch('/api/check-all-payments');
                    const data = await response.json();
                    
                    if (response.ok) {
                        result.className = 'result success';
                        result.innerHTML = \`✅ ПРОВЕРКА ПЛАТЕЖЕЙ ЗАВЕРШЕНА!
                        
📊 Всего платежей: \${data.totalPayments}
✅ Успешных платежей: \${data.successfulPayments}
👥 Платежей с клиентами: \${data.paymentsWithCustomer}
👥 Уникальных клиентов: \${data.uniqueCustomers}

📋 Последние 10 платежей:
\${data.recentPayments.map(p => \`• \${p.id} - \${(p.amount/100).toFixed(2)} \${p.currency.toUpperCase()} - \${new Date(p.created).toLocaleString()}\`).join('\\n')}\`;
                    } else {
                        result.className = 'result error';
                        result.innerHTML = \`❌ ОШИБКА: \${data.error}\`;
                    }
                } catch (error) {
                    result.className = 'result error';
                    result.innerHTML = \`❌ ОШИБКА СЕТИ: \${error.message}\`;
                } finally {
                    button.disabled = false;
                    button.textContent = '📊 Проверить все платежи';
                }
            }
            
            async function exportAllPayments() {
                const button = document.getElementById('exportAllButton');
                const result = document.getElementById('result');
                
                button.disabled = true;
                button.textContent = '⏳ Выгружаем ВСЕ покупки...';
                result.innerHTML = '';
                
                try {
                    const response = await fetch('/api/export-all-payments-now');
                    const data = await response.json();
                    
                    if (response.ok) {
                        result.className = 'result success';
                        result.innerHTML = \`✅ ПОЛНАЯ ВЫГРУЗКА ЗАВЕРШЕНА!
                        
📊 Всего платежей: \${data.totalPayments}
✅ Успешных платежей: \${data.successfulPayments}
📦 Сгруппировано покупок: \${data.groupedPurchases}
📋 Выгружено в Google Sheets: \${data.message}

🔍 Первые 3 строки данных:
\${JSON.stringify(data.exportData, null, 2)}\`;
                    } else {
                        result.className = 'result error';
                        result.innerHTML = \`❌ ОШИБКА: \${data.error}\`;
                    }
                } catch (error) {
                    result.className = 'result error';
                    result.innerHTML = \`❌ ОШИБКА СЕТИ: \${error.message}\`;
                } finally {
                    button.disabled = false;
                    button.textContent = '🚀 Выгрузить ВСЕ покупки в Google Sheets';
                }
            }
        </script>
    </body>
    </html>
  `);
});

// Endpoint для полной выгрузки всех покупок в Google Sheets
app.get('/api/export-all-payments-now', requireAdminKey, async (req, res) => {
  try {
    console.log('🚀 ПОЛНАЯ ВЫГРУЗКА ВСЕХ ПОКУПОК...');
    
    // Получаем ВСЕ платежи (без лимита)
    const allPayments = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
      
      const payments = await stripe.paymentIntents.list(params);
      allPayments.push(...payments.data);
      
      hasMore = payments.has_more;
      if (hasMore && payments.data.length > 0) {
        startingAfter = payments.data[payments.data.length - 1].id;
      }
    }
    
    console.log(`📊 Всего найдено платежей: ${allPayments.length}`);
    
    const successfulPayments = allPayments.filter(p => p.status === 'succeeded' && p.customer);
    console.log(`✅ Успешных платежей с клиентами: ${successfulPayments.length}`);
    
    // Группируем покупки по клиенту и дате
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const customerIdForExport = customer?.id;
      const purchaseDateForExport = new Date(payment.created * 1000);
      const dateKeyForExport = `${customerIdForExport}_${purchaseDateForExport.toISOString().split('T')[0]}`;
      
      if (!groupedPurchases.has(dateKeyForExport)) {
        groupedPurchases.set(dateKeyForExport, {
          customer,
          payments: [],
          totalAmount: 0,
          firstPayment: payment
        });
      }
      
      const group = groupedPurchases.get(dateKeyForExport);
      group.payments.push(payment);
      group.totalAmount += payment.amount;
    }
    
    console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);
    
    // Сортируем группированные покупки по дате (старые → новые)
    const sortedGroups = Array.from(groupedPurchases.entries()).sort((a, b) => {
      const dateA = new Date(a[1].firstPayment.created * 1000);
      const dateB = new Date(b[1].firstPayment.created * 1000);
      return dateA - dateB; // старые сверху
    });
    
    console.log('📅 Покупки отсортированы: старые → новые');
    
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
        
        // Очищаем весь лист
        const clearResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Z:clear?valueInputOption=RAW`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (clearResponse.ok) {
          console.log('🧹 Google Sheets полностью очищен');
        }
        
        // Подготавливаем данные для экспорта
        const exportData = [
          ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
        ];
        
        for (const [dateKeyForExport, group] of sortedGroups) {
          const customer = group.customer;
          const firstPayment = group.firstPayment;
          
          // Формируем GEO данные
          let geoData = 'N/A';
          if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
            geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
          } else if (customer?.metadata?.geo_country) {
            geoData = customer.metadata.geo_country;
          }
          
          const utcTime = new Date(firstPayment.created * 1000).toISOString();
          const localTime = new Date(firstPayment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
          
          // Создаем уникальный ID покупки на основе клиента и даты
          const purchaseId = `purchase_${customer?.id}_${dateKeyForExport.split('_')[1]}`;
          
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
            group.payments.length // Payment Count
          ];
          
          exportData.push(row);
        }
        
    // Записываем ВСЕ данные в Google Sheets (полная перезапись)
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
      console.log('✅ ВСЕ ПОКУПКИ ЗАПИСАНЫ В GOOGLE SHEETS:', exportData.length - 1, 'покупок');
      res.json({
        success: true,
        message: `Записано ${exportData.length - 1} покупок в Google Sheets`,
        totalPayments: allPayments.length,
        successfulPayments: successfulPayments.length,
        groupedPurchases: groupedPurchases.size,
        exportedPurchases: exportData.length - 1,
        exportData: exportData.slice(0, 3) // Показываем первые 3 строки
      });
    } else {
      const errorText = await sheetsResponse.text();
      console.log('❌ Ошибка записи в Google Sheets:', errorText);
      res.status(500).json({ 
        error: 'Ошибка записи в Google Sheets',
        details: errorText
      });
    }
      } else {
        console.log('❌ Ошибка получения токена Google Sheets');
        res.status(500).json({ error: 'Ошибка получения токена Google Sheets' });
      }
    } else {
      res.status(500).json({ error: 'Google Sheets не настроен' });
    }
  } catch (error) {
    console.log('❌ Ошибка полной выгрузки:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для проверки всех платежей
app.get('/api/check-all-payments', requireAdminKey, async (req, res) => {
  try {
    console.log('🔍 Проверяем все платежи...');
    
    // Получаем все платежи
    const payments = await stripe.paymentIntents.list({ 
      limit: 100
    });
    
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded');
    const paymentsWithCustomer = successfulPayments.filter(p => p.customer);
    
    console.log(`📊 Всего платежей: ${payments.data.length}`);
    console.log(`✅ Успешных платежей: ${successfulPayments.length}`);
    console.log(`👥 Платежей с клиентами: ${paymentsWithCustomer.length}`);
    
    // Группируем по клиентам
    const customerGroups = new Map();
    for (const payment of paymentsWithCustomer) {
      const customerId = payment.customer;
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    console.log(`👥 Уникальных клиентов: ${customerGroups.size}`);
    
    res.json({
      totalPayments: payments.data.length,
      successfulPayments: successfulPayments.length,
      paymentsWithCustomer: paymentsWithCustomer.length,
      uniqueCustomers: customerGroups.size,
      recentPayments: successfulPayments.slice(0, 10).map(p => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        created: new Date(p.created * 1000).toISOString(),
        customer: p.customer,
        status: p.status
      }))
    });
  } catch (error) {
    console.log('❌ Ошибка проверки платежей:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint для отправки последней покупки
app.post('/api/send-last-payment', requireAdminKey, async (req, res) => {
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
    const metadata = { ...(payment.metadata || {}), ...(customer?.metadata || {}) };
    
    console.log(`💳 Отправляем платеж: ${payment.id}`);
    console.log(`📧 Email: ${customer?.email || 'НЕТ'}`);
    console.log(`🌍 UTM Source: ${metadata.utm_source || 'НЕТ'}`);
    console.log(`📱 Ad Name: ${metadata.ad_name || 'НЕТ'}`);
    console.log(`🎯 Campaign: ${metadata.utm_campaign || 'НЕТ'}`);
    console.log(`🌍 Geo Country: ${metadata.geo_country || 'НЕТ'}`);
    console.log(`🏙️ Geo City: ${metadata.geo_city || 'НЕТ'}`);
    
    // Формируем сообщения
    const amount = (payment.amount / 100).toFixed(2);
    const currency = payment.currency.toUpperCase();
    const email = customer?.email || 'N/A';
    const country = metadata.geo_country || customer?.address?.country || 'N/A';
    const city = metadata.geo_city || '';
    const orderId = payment.id.substring(0, 9);
    const person = formatPerson(metadata.gender, metadata.age);
    const creativeLink = metadata.creative_link || 'N/A';
    
    const telegramMessage = buildTelegramText({
      orderId,
      amount,
      currency,
      productTag: metadata.product_tag,
      email,
      country,
      city,
      person,
      creativeLink,
      metadata
    });
    
    // Отправляем в Telegram
    console.log('\n📱 ОТПРАВЛЯЕМ В TELEGRAM...');
    let telegramSent = false;
    try {
      telegramSent = await sendTelegram(telegramMessage);
      console.log(`✅ Telegram: ${telegramSent ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
    } catch (error) {
      console.log('❌ Telegram error:', error.message);
    }
    
    // Отправляем в Slack
    console.log('\n💬 ОТПРАВЛЯЕМ В SLACK...');
    let slackSent = false;
    try {
      slackSent = await sendSlack(telegramMessage);
      console.log(`✅ Slack: ${slackSent ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
    } catch (error) {
      console.log('❌ Slack error:', error.message);
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
app.post('/api/test-google-sheets', requireAdminKey, async (req, res) => {
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
app.post('/api/export-all-payments', requireAdminKey, async (req, res) => {
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
        const dateKeyForNotification = `${customerIdForNotification}_${purchaseDateForNotification.toISOString().split('T')[0]}`; // Группируем по клиенту и дню
        
        if (!groupedPurchases.has(dateKeyForNotification)) {
          groupedPurchases.set(dateKeyForNotification, {
            customer,
            payments: [],
            totalAmount: 0,
            firstPayment: payment
          });
        }
        
        const group = groupedPurchases.get(dateKeyForNotification);
        group.payments.push(payment);
        group.totalAmount += payment.amount;
      }
    }
    
    // Подготавливаем данные для экспорта
    const exportData = [
      ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
    ];
    
    for (const [dateKeyForNotification, group] of groupedPurchases) {
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
      const purchaseId = `purchase_${customer?.id}_${dateKeyForNotification.split('_')[1]}`;
      
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

// Принудительная полная выгрузка всех покупок
app.get('/api/force-export-all', requireAdminKey, async (req, res) => {
  try {
    console.log('🚀 ПРИНУДИТЕЛЬНАЯ ПОЛНАЯ ВЫГРУЗКА ВСЕХ ПОКУПОК...');
    
    // Получаем ВСЕ платежи (без лимита)
    const allPayments = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
      
      const payments = await stripe.paymentIntents.list(params);
      allPayments.push(...payments.data);
      
      hasMore = payments.has_more;
      if (hasMore && payments.data.length > 0) {
        startingAfter = payments.data[payments.data.length - 1].id;
      }
    }
    
    console.log(`📊 Всего найдено платежей: ${allPayments.length}`);
    
    const successfulPayments = allPayments.filter(p => p.status === 'succeeded' && p.customer);
    console.log(`✅ Успешных платежей с клиентами: ${successfulPayments.length}`);
    
    // Группируем покупки по клиенту и дате
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const customerIdForExport = customer?.id;
      const purchaseDateForExport = new Date(payment.created * 1000);
      const dateKeyForExport = `${customerIdForExport}_${purchaseDateForExport.toISOString().split('T')[0]}`;
      
      if (!groupedPurchases.has(dateKeyForExport)) {
        groupedPurchases.set(dateKeyForExport, {
          customer,
          payments: [],
          totalAmount: 0,
          firstPayment: payment
        });
      }
      
      const group = groupedPurchases.get(dateKeyForExport);
      group.payments.push(payment);
      group.totalAmount += payment.amount;
    }
    
    console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);
    
    // Сортируем группированные покупки по дате (старые → новые)
    const sortedGroups = Array.from(groupedPurchases.entries()).sort((a, b) => {
      const dateA = new Date(a[1].firstPayment.created * 1000);
      const dateB = new Date(b[1].firstPayment.created * 1000);
      return dateA - dateB; // старые сверху
    });
    
    console.log('📅 Покупки отсортированы: старые → новые');
    
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
        
        // Очищаем весь лист
        const clearResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Z:clear?valueInputOption=RAW`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (clearResponse.ok) {
          console.log('🧹 Google Sheets полностью очищен');
        }
        
        // Подготавливаем данные для экспорта
        const exportData = [
          ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
        ];
        
        for (const [dateKeyForExport, group] of sortedGroups) {
          const customer = group.customer;
          const firstPayment = group.firstPayment;
          
          // Формируем GEO данные
          let geoData = 'N/A';
          if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
            geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
          } else if (customer?.metadata?.geo_country) {
            geoData = customer.metadata.geo_country;
          }
          
          const utcTime = new Date(firstPayment.created * 1000).toISOString();
          const localTime = new Date(firstPayment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
          
          // Создаем уникальный ID покупки на основе клиента и даты
          const purchaseId = `purchase_${customer?.id}_${dateKeyForExport.split('_')[1]}`;
          
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
            group.payments.length // Payment Count
          ];
          
          exportData.push(row);
        }
        
        // Записываем ВСЕ данные в Google Sheets (полная перезапись)
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
          console.log('✅ ВСЕ ПОКУПКИ ЗАПИСАНЫ В GOOGLE SHEETS:', exportData.length - 1, 'покупок');
          res.json({
            success: true,
            message: `Записано ${exportData.length - 1} покупок в Google Sheets`,
            totalPayments: allPayments.length,
            successfulPayments: successfulPayments.length,
            groupedPurchases: groupedPurchases.size,
            exportedPurchases: exportData.length - 1,
            sheet_url: `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_DOC_ID}`
          });
        } else {
          const errorText = await sheetsResponse.text();
          console.log('❌ Ошибка записи в Google Sheets:', errorText);
          res.status(500).json({ 
            error: 'Ошибка записи в Google Sheets',
            details: errorText
          });
        }
      } else {
        console.log('❌ Ошибка получения токена Google Sheets');
        res.status(500).json({ error: 'Ошибка получения токена Google Sheets' });
      }
    } else {
      res.status(500).json({ error: 'Google Sheets не настроен' });
    }
  } catch (error) {
    console.log('❌ Ошибка принудительной выгрузки:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Очищаем хранилище при запуске
console.log('🧹 Очищаем хранилище обработанных платежей');
processedPayments.clear();
notifiedPayments.clear();
notifiedPurchases.clear();

// API polling отключен для предотвращения дублирования

// Автоматическое обновление Google Sheets отключено - используем только ручное управление
// setInterval(async () => {
//   try {
//     console.log('🔄 Автоматическое обновление Google Sheets...');
//     
//     // Получаем последние платежи
//     const payments = await stripe.paymentIntents.list({ 
//       limit: 100
//     });
//     
//     console.log(`📊 Найдено платежей: ${payments.data.length}`);
//     
//     // Подсчитываем успешные платежи
//     const successfulPayments = payments.data.filter(p => p.status === 'succeeded');
//     console.log(`✅ Успешных платежей: ${successfulPayments.length}`);
//     
//     // Группируем покупки по клиенту и дате
//     const groupedPurchases = new Map();
//     
//     for (const payment of payments.data) {
//       if (payment.status === 'succeeded' && payment.customer) {
//         console.log(`🔄 Обрабатываем платеж: ${payment.id}, клиент: ${payment.customer}`);
//         const customer = await stripe.customers.retrieve(payment.customer);
//         const customerIdForExport = customer?.id;
//         const purchaseDateForExport = new Date(payment.created * 1000);
//         const dateKeyForExport = `${customerIdForExport}_${purchaseDateForExport.toISOString().split('T')[0]}`;
//         console.log(`📅 Дата покупки: ${purchaseDateForExport.toISOString().split('T')[0]}, ключ: ${dateKeyForExport}`);
//         
//         if (!groupedPurchases.has(dateKeyForExport)) {
//           groupedPurchases.set(dateKeyForExport, {
//             customer,
//             payments: [],
//             totalAmount: 0,
//             firstPayment: payment
//           });
//         }
//         
//         const group = groupedPurchases.get(dateKeyForExport);
//         group.payments.push(payment);
//         group.totalAmount += payment.amount;
//       }
//     }
//     
//     console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);
//     
//     // Обновляем Google Sheets
//     if (process.env.GOOGLE_SHEETS_DOC_ID && process.env.GOOGLE_SERVICE_EMAIL && process.env.GOOGLE_SERVICE_PRIVATE_KEY) {
//       // Создаем JWT токен для Google Sheets
//       const header = { "alg": "RS256", "typ": "JWT" };
//       const now = Math.floor(Date.now() / 1000);
//       const payload = {
//         iss: process.env.GOOGLE_SERVICE_EMAIL,
//         scope: 'https://www.googleapis.com/auth/spreadsheets',
//         aud: 'https://oauth2.googleapis.com/token',
//         iat: now,
//         exp: now + 3600
//       };
// 
//       const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
//       const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
// 
//       const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY
//         .replace(/\\n/g, '\n')
//         .replace(/"/g, '');
// 
//       const signature = crypto.createSign('RSA-SHA256')
//         .update(`${encodedHeader}.${encodedPayload}`)
//         .sign(privateKey, 'base64url');
// 
//       const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
// 
//       // Получаем access token
//       const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//         body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
//       });
// 
//       if (tokenResponse.ok) {
//         const tokenData = await tokenResponse.json();
//         
//         // Подготавливаем данные для экспорта
//         const exportData = [
//           ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
//         ];
//         
//         for (const [dateKeyForExport, group] of groupedPurchases) {
//           const customer = group.customer;
//           const firstPayment = group.firstPayment;
//           
//           // Формируем GEO данные
//           let geoData = 'N/A';
//           if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
//             geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
//           } else if (customer?.address?.country) {
//             geoData = customer.address.country;
//           }
//           
//           const utcTime = new Date(firstPayment.created * 1000).toISOString();
//           const localTime = new Date(firstPayment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
//           
//           // Создаем уникальный ID покупки на основе клиента и даты
//           const purchaseId = `purchase_${customer?.id}_${dateKeyForExport.split('_')[1]}`;
//           
//           const row = [
//             purchaseId,
//             (group.totalAmount / 100).toFixed(2),
//             firstPayment.currency.toUpperCase(),
//             'succeeded',
//             utcTime,
//             localTime,
//             customer?.id || 'N/A',
//             customer?.email || 'N/A',
//             geoData,
//             customer?.metadata?.utm_source || 'N/A',
//             customer?.metadata?.utm_medium || 'N/A',
//             customer?.metadata?.utm_campaign || 'N/A',
//             customer?.metadata?.utm_content || 'N/A',
//             customer?.metadata?.utm_term || 'N/A',
//             customer?.metadata?.ad_name || 'N/A',
//             customer?.metadata?.adset_name || 'N/A',
//             group.payments.length // Количество платежей в группе
//           ];
//           
//           exportData.push(row);
//         }
//         
//         // Проверяем существующие данные в Google Sheets
//         const existingResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Q?valueInputOption=RAW`, {
//           method: 'GET',
//           headers: {
//             'Authorization': `Bearer ${tokenData.access_token}`,
//             'Content-Type': 'application/json'
//           }
//         });
//         
//         let existingData = [];
//         if (existingResponse.ok) {
//           const existing = await existingResponse.json();
//           existingData = existing.values || [];
//           console.log(`📊 Найдено существующих строк: ${existingData.length}`);
//         }
//         
//         // Фильтруем только новые покупки (которых еще нет в Google Sheets)
//         const newRows = [];
//         const existingPurchaseIds = new Set();
//         
//         // Собираем существующие ID покупок
//         for (let i = 1; i < existingData.length; i++) {
//           const row = existingData[i];
//           if (row[0]) {
//             existingPurchaseIds.add(row[0]);
//           }
//         }
//         
//         // Добавляем только новые покупки
//         for (let i = 1; i < exportData.length; i++) {
//           const row = exportData[i];
//           const purchaseId = row[0];
//           if (!existingPurchaseIds.has(purchaseId)) {
//             newRows.push(row);
//             console.log(`🆕 Новая покупка: ${purchaseId}`);
//           } else {
//             console.log(`⏭️ Покупка уже существует: ${purchaseId}`);
//           }
//         }
//         
//         console.log(`📊 Новых покупок для добавления: ${newRows.length}`);
//         
//         // Добавляем только новые покупки вниз (append)
//         if (newRows.length > 0) {
//           const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Q:append?valueInputOption=RAW`, {
//             method: 'POST',
//             headers: {
//               'Authorization': `Bearer ${tokenData.access_token}`,
//               'Content-Type': 'application/json'
//             },
//             body: JSON.stringify({ values: newRows })
//           });
//         
//           if (sheetsResponse.ok) {
//             console.log('✅ НОВЫЕ ПОКУПКИ ДОБАВЛЕНЫ В GOOGLE SHEETS:', newRows.length, 'покупок');
//           } else {
//             console.log('❌ Ошибка добавления в Google Sheets:', await sheetsResponse.text());
//           }
//         } else {
//           console.log('📊 Нет новых покупок для добавления');
//         }
//       }
//     }
//   } catch (error) {
//     console.log('❌ Ошибка автоматического обновления:', error.message);
//   }
// }, 5 * 60 * 1000); // каждые 5 минут - ОТКЛЮЧЕНО

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('✅ Google Sheets настроен правильно - автоматическое обновление отключено');
  
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
            
            const customer = await getCustomerSafe(payment.customer);
            const customerIdForStartup = customer?.id;
            const purchaseDateForStartup = new Date(payment.created * 1000);
            const dateKeyForStartup = `${customerIdForStartup}_${purchaseDateForStartup.toISOString().split('T')[0]}`;
            
            if (!notifiedPurchases.has(dateKeyForStartup)) {
              console.log(`📱 Отправляем уведомления для покупки: ${dateKeyForStartup}`);
              
              const customerPayments = payments.data.filter(p => 
                p.status === 'succeeded' && 
                p.customer === customerIdForStartup &&
                new Date(p.created * 1000).toISOString().split('T')[0] === purchaseDateForStartup.toISOString().split('T')[0]
              );
              
              const totalAmount = customerPayments.reduce((sum, p) => sum + p.amount, 0);
              const orderId = payment.id.substring(0, 9);
              const amount = (totalAmount / 100).toFixed(2);
              const currency = payment.currency.toUpperCase();
              const email = customer?.email || 'N/A';
              const metadata = { ...(payment.metadata || {}), ...(customer?.metadata || {}) };
              const country = metadata.geo_country || customer?.address?.country || 'N/A';
              const city = metadata.geo_city || '';
              const person = formatPerson(metadata.gender, metadata.age);
              const creativeLink = metadata.creative_link || 'N/A';

              const telegramText = buildTelegramText({
                orderId,
                amount,
                currency,
                productTag: `${customerPayments.length} payment${customerPayments.length > 1 ? 's' : ''}`,
                email,
                country,
                city,
                person,
                creativeLink,
                metadata
              });

              const telegramSent = await sendTelegram(telegramText);
              if (telegramSent) {
                console.log('✅ Telegram уведомление отправлено при запуске');
              }

              const slackSent = await sendSlack(telegramText);
              if (slackSent) {
                console.log('✅ Slack уведомление отправлено при запуске');
              }

              if (telegramSent || slackSent) {
                notifiedPurchases.add(dateKeyForStartup);
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
