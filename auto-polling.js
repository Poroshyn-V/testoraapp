import Stripe from 'stripe';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Хранилище обработанных платежей
const processedPayments = new Set();
const notifiedPayments = new Set();

console.log('🚀 Запуск автоматического API polling...');

// Функция обработки платежей
async function processPayments() {
  try {
    console.log('🔄 Проверяем новые покупки...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ 
      limit: 20
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
          
          // Группируем уведомления по клиенту и дате
          const customerId = customer?.id;
          const purchaseDate = new Date(payment.created * 1000);
          const dateKey = `${customerId}_${purchaseDate.toISOString().split('T')[0]}`;
          
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

              // Получаем GEO данные
              let geoData = 'N/A';
              if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
                geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
              } else if (customer?.address?.country) {
                geoData = customer.address.country;
              } else if (customer?.metadata?.geo_country) {
                geoData = customer.metadata.geo_country;
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

              // Добавляем новую строку в Google Sheets
              const utcTime = new Date(payment.created * 1000).toISOString();
              const localTime = new Date(payment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
              
              const newRow = [
                payment.id,
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
                customer?.metadata?.adset_name || 'N/A'
              ];

              const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:P:append?valueInputOption=RAW`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ values: [newRow] })
              });

              if (sheetsResponse.ok) {
                console.log('✅ Новая покупка добавлена в Google Sheets:', payment.id);
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
}

// Запускаем обработку сразу
processPayments();

// Затем каждые 5 минут
setInterval(processPayments, 5 * 60 * 1000);

console.log('🔄 Автоматический API polling запущен (каждые 5 минут)');
