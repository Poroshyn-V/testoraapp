import Stripe from 'stripe';
import fetch from 'node-fetch';
import crypto from 'crypto';

// Настройки
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Переменные окружения (замените на реальные)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const GOOGLE_SHEETS_DOC_ID = process.env.GOOGLE_SHEETS_DOC_ID || '';

// Хранилище обработанных платежей (с персистентностью)
const processedPayments = new Set();

// Загружаем обработанные платежи из localStorage (если доступен)
if (typeof localStorage !== 'undefined') {
  try {
    const stored = localStorage.getItem('processedPayments');
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.forEach(id => processedPayments.add(id));
    }
  } catch (error) {
    console.log('Не удалось загрузить обработанные платежи из localStorage');
  }
}

// Функция для сохранения обработанных платежей
function saveProcessedPayments() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('processedPayments', JSON.stringify([...processedPayments]));
    } catch (error) {
      console.log('Не удалось сохранить обработанные платежи в localStorage');
    }
  }
}

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
        channel: SLACK_CHANNEL_ID,
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

async function saveToGoogleSheets(payment, customer = null) {
  try {
    console.log('📊 Сохранение в Google Sheets:', payment.id);
    
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
    
    // Создаем подпись с правильным алгоритмом
    const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${encodedHeader}.${encodedPayload}`);
    const signature = sign.sign(privateKey, 'base64url');
    
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Получаем access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${token}`
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      throw new Error(`Ошибка аутентификации: ${tokenData.error_description}`);
    }
    
    const accessToken = tokenData.access_token;
    
    if (!accessToken) {
      throw new Error('Не удалось получить access token для Google Sheets API.');
    }
    
    // Получаем metadata из customer
    const metadata = customer?.metadata || payment.metadata || {};
    
    // Получаем простой ГЕО по IP
    const ipAddress = metadata.ip_address || 'N/A';
    let geo = 'N/A';
    
    if (ipAddress !== 'N/A' && !ipAddress.includes(':')) {
      try {
        const geoResponse = await fetch(`https://ipinfo.io/${ipAddress}/json`);
        const geoData = await geoResponse.json();
        const country = geoData.country || 'N/A';
        const city = geoData.city || 'N/A';
        geo = `${country}, ${city}`;
      } catch (error) {
        console.log('Ошибка получения ГЕО:', error.message);
      }
    } else if (ipAddress.includes(':')) {
      geo = 'IPv6';
    }
    
    // Подготавливаем данные
    const spreadsheetId = process.env.GOOGLE_SHEETS_DOC_ID;
    const range = 'A1';
    const values = [
      [
        payment.id,
        `$${(payment.amount / 100).toFixed(2)}`,
        payment.currency.toUpperCase(),
        payment.status,
        new Date(payment.created * 1000).toLocaleString(),
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        geo, // Простой ГЕО в одной колонке
        metadata.utm_source || 'N/A',
        metadata.utm_medium || 'N/A',
        metadata.utm_campaign || 'N/A',
        metadata.utm_content || 'N/A',
        metadata.utm_term || 'N/A',
        metadata.ad_name || 'N/A',
        metadata.adset_name || 'N/A'
      ]
    ];
    
    // Добавляем данные
    const updateResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    });
    
    const updateData = await updateResponse.json();
    
    if (updateData.error) {
      throw new Error(updateData.error.message);
    }
    
    console.log('✅ Данные сохранены в Google Sheets');
    return true;
    
  } catch (error) {
    console.error('Google Sheets error:', error.message);
    return false;
  }
}

function formatTelegram(payment, customer = null) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = customer?.email || 'N/A';
  const country = customer?.address?.country || customer?.metadata?.geo_country || 'US';
  
  // Генерируем случайный ID заказа
  const orderId = Math.random().toString(36).substring(2, 15);
  
  // Получаем metadata из customer
  const metadata = customer?.metadata || {};
  
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

function formatSlack(payment, customer = null) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = customer?.email || 'N/A';
  const country = customer?.address?.country || customer?.metadata?.geo_country || 'US';
  
  // Генерируем случайный ID заказа
  const orderId = Math.random().toString(36).substring(2, 15);
  
  // Получаем metadata из customer
  const metadata = customer?.metadata || {};
  
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
${placement}
${adName}
${adsetName}
${campaignName}`;
}

async function syncPayments() {
  console.log('🔄 СИНХРОНИЗАЦИЯ ПЛАТЕЖЕЙ...');
  
  try {
    // Получаем платежи за последние 5 минут (уменьшили время)
    const fiveMinutesAgo = Math.floor((Date.now() - 5 * 60 * 1000) / 1000);
    
    const payments = await stripe.paymentIntents.list({
      limit: 50, // Уменьшили лимит
      created: {
        gte: fiveMinutesAgo
      }
    });

    console.log(`📊 Найдено платежей: ${payments.data.length}`);
    console.log(`📋 Уже обработано: ${processedPayments.size}`);

    let processedCount = 0;

    for (const payment of payments.data) {
      // Пропускаем уже обработанные
      if (processedPayments.has(payment.id)) {
        console.log(`⏭️ Пропускаю уже обработанный: ${payment.id}`);
        continue;
      }

      // Обрабатываем только успешные платежи
      if (payment.status === 'succeeded') {
        console.log(`💳 Обрабатываю платеж: ${payment.id}`);
        
        try {
          // Получаем данные клиента
          const customer = payment.customer ? await stripe.customers.retrieve(payment.customer) : null;
          
          // Отправляем в Telegram
          const telegramText = formatTelegram(payment, customer);
          const telegramSent = await sendTelegram(telegramText);
          
          // Отправляем в Slack
          const slackText = formatSlack(payment, customer);
          const slackSent = await sendSlack(slackText);
          
          // Сохраняем в Google Sheets
          const sheetsSaved = await saveToGoogleSheets(payment, customer);
          
          // Помечаем как обработанный ТОЛЬКО если хотя бы одно уведомление отправилось
          if (telegramSent || slackSent || sheetsSaved) {
            processedPayments.add(payment.id);
            saveProcessedPayments(); // Сохраняем в localStorage
            processedCount++;
            console.log(`✅ Платеж ${payment.id} обработан (Telegram: ${telegramSent}, Slack: ${slackSent}, Sheets: ${sheetsSaved})`);
          } else {
            console.log(`⚠️ Платеж ${payment.id} не обработан - все уведомления не отправились`);
          }
        } catch (error) {
          console.error(`❌ Ошибка обработки платежа ${payment.id}:`, error.message);
        }
      }
    }

    console.log(`✅ Синхронизация завершена. Обработано новых: ${processedCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка синхронизации:', error.message);
  }
}

// Запускаем синхронизацию каждые 5 минут
console.log('🚀 Запуск автоматической синхронизации каждые 5 минут...');
console.log('⏰ Первая синхронизация через 10 секунд...');

setTimeout(() => {
  syncPayments();
}, 10000);

setInterval(() => {
  syncPayments();
}, 5 * 60 * 1000); // 5 минут

console.log('🔄 Синхронизация запущена! Проверьте Telegram и Slack через 10 секунд...');
