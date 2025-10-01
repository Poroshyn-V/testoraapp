import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// Инициализация
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_EMAIL,
  key: process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);

// Заголовки таблицы
const HEADER = [
  'created_at','session_id','payment_status','amount','currency','email','country','gender','age',
  'product_tag','creative_link',
  'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
  'platform_placement','ad_name','adset_name','campaign_name','web_campaign',
  'customer_id','client_reference_id','mode','status','raw_metadata_json'
];

// Инициализация Google Sheets
async function initGoogleSheets() {
  await doc.loadInfo();
  
  let sheet = doc.sheetsByTitle['payments'];
  if (!sheet) {
    sheet = await doc.addSheet({ title: 'payments', headerValues: HEADER });
  } else if (sheet.headerValues?.length !== HEADER.length) {
    await sheet.setHeaderRow(HEADER);
  }
  
  return sheet;
}

// Проверка существования платежа
async function paymentExists(sheet, sessionId) {
  const rows = await sheet.getRows();
  return rows.some(row => row.get('session_id') === sessionId);
}

// Форматирование сообщения для Telegram
function formatTelegram(session, customerMetadata = {}) {
  const m = { ...session.metadata, ...customerMetadata };
  const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
  const currency = (session.currency || 'usd').toUpperCase();
  const pm = session.payment_method_types?.[0] || 'card';
  const email = session.customer_details?.email || session.customer_email || '';
  
  const product_tag = m.product_tag || 'N/A';
  const orderId = session.id.slice(3, 14);
  const country = m.geo_country || m.country || session.customer_details?.address?.country || 'N/A';
  const gender = m.gender || 'N/A';
  const age = m.age || 'N/A';
  const creative_link = m.creative_link || 'N/A';
  const utm_source = m.utm_source || 'N/A';
  const platform_placement = m.platform_placement || 'N/A';
  const ad_name = m.ad_name || 'N/A';
  const adset_name = m.adset_name || 'N/A';
  const campaign_name = m.campaign_name || m.utm_campaign || 'N/A';

  return `🟢 Order ${orderId} was processed!
---------------------------
💳 ${pm}
💰 ${amount} ${currency}
🏷️ ${product_tag}
---------------------------
📧 ${email}
---------------------------
🌪️ ${orderId}
📍 ${country}
🧍${gender} ${age}
🔗 ${creative_link}
${utm_source}
${platform_placement}
${ad_name}
${adset_name}
${campaign_name}`;
}

// Отправка в Telegram
async function sendTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping');
    return;
  }
  
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });
  
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Telegram error: ${res.status} ${t}`);
  }
}

// Отправка в Slack
async function sendSlack(session, customerMetadata = {}) {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_CHANNEL_ID) {
    console.log('Slack not configured, skipping');
    return;
  }
  
  const m = { ...session.metadata, ...customerMetadata };
  const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
  const currency = (session.currency || 'usd').toUpperCase();
  const email = session.customer_details?.email || session.customer_email || 'N/A';
  const country = m.geo_country || m.country || session.customer_details?.address?.country || 'N/A';
  
  const text = `💰 *New Payment Received!*
  
💳 *Amount:* ${amount} ${currency}
📧 *Email:* ${email}
🆔 *Session ID:* \`${session.id}\`
📅 *Date:* ${new Date().toLocaleString()}
🌍 *Country:* ${country}
🎯 *Campaign:* ${m.campaign_name || m.utm_campaign || 'N/A'}
📱 *Source:* ${m.utm_source || 'N/A'}

✅ Payment processed successfully!`;

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: process.env.SLACK_CHANNEL_ID,
      text: text,
      username: 'Stripe Bot',
      icon_emoji: ':money_with_wings:'
    })
  });

  const result = await res.json();
  if (!result.ok) {
    console.error('Slack API error:', result.error);
  }
}

// Главная функция синхронизации
async function syncPayments() {
  try {
    console.log('🔄 Checking for new payments...');
    
    // Получаем сессии за последние 24 часа
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      created: {
        gte: oneDayAgo  // только за последние 24 часа
      }
    });
    
    if (sessions.data.length === 0) {
      console.log('📭 No payments found');
      return;
    }
    
    console.log(`📊 Found ${sessions.data.length} completed sessions`);
    
    // Инициализируем Google Sheets
    const sheet = await initGoogleSheets();
    
    let newPayments = 0;
    
    // Обрабатываем каждую сессию
    for (const session of sessions.data) {
      // Проверяем, есть ли уже в таблице
      const exists = await paymentExists(sheet, session.id);
      
      if (exists) {
        console.log(`⏭️  Skipping existing payment: ${session.id}`);
        continue;
      }
      
      console.log(`✨ New payment found: ${session.id}`);
      newPayments++;
      
      // Получаем данные клиента для metadata
      let customerMetadata = {};
      if (session.customer) {
        try {
          const customer = await stripe.customers.retrieve(session.customer);
          if (customer && !customer.deleted) {
            customerMetadata = customer.metadata || {};
            console.log(`📋 Customer metadata loaded for: ${session.customer}`);
          }
        } catch (error) {
          console.error('Error loading customer:', error.message);
        }
      }
      
      // Объединяем metadata из session и customer
      const m = { ...session.metadata, ...customerMetadata };
      
      // Получаем GEO данные
      const geoCountry = m.geo_country || m.country || session.customer_details?.address?.country || 'N/A';
      const geoCity = m.geo_city || '';
      const geoData = geoCity ? `${geoCity}, ${geoCountry}` : geoCountry;
      
      // Формируем данные для Google Sheets в правильном формате
      const createdDate = new Date((session.created || Math.floor(Date.now()/1000)) * 1000);
      const createdUTC = createdDate.toISOString();
      const createdLocal = new Date(createdDate.getTime() + 3600000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC+1');
      
      const row = {
        created_at: createdUTC,
        session_id: session.id,
        payment_status: session.payment_status || 'paid',
        amount: (session.amount_total ?? 0) / 100,
        currency: (session.currency || 'usd').toUpperCase(),
        email: session.customer_details?.email || session.customer_email || '',
        country: geoData,
        gender: m.gender || '',
        age: m.age || '',
        product_tag: m.product_tag || '',
        creative_link: m.creative_link || '',
        utm_source: m.utm_source || '',
        utm_medium: m.utm_medium || '',
        utm_campaign: m.utm_campaign || '',
        utm_content: m.utm_content || '',
        utm_term: m.utm_term || '',
        platform_placement: m.platform_placement || '',
        ad_name: m.ad_name || '',
        adset_name: m.adset_name || '',
        campaign_name: m.campaign_name || '',
        web_campaign: m.web_campaign || '',
        customer_id: (session.customer || '').toString(),
        client_reference_id: session.client_reference_id || '',
        mode: session.mode || '',
        status: session.status || '',
        raw_metadata_json: JSON.stringify(m)
      };
      
      await sheet.addRow(row);
      console.log(`✅ Added to Google Sheets: ${session.id}`);
      
      // Отправляем уведомления
      try {
        const telegramText = formatTelegram(session, customerMetadata);
        await sendTelegram(telegramText);
        console.log('📱 Telegram notification sent');
      } catch (error) {
        console.error('Error sending Telegram:', error.message);
      }
      
      try {
        await sendSlack(session, customerMetadata);
        console.log('💬 Slack notification sent');
      } catch (error) {
        console.error('Error sending Slack:', error.message);
      }
    }
    
    if (newPayments > 0) {
      console.log(`✨ Processed ${newPayments} new payment(s)`);
    } else {
      console.log('✓ No new payments');
    }
    
  } catch (error) {
    console.error('❌ Sync error:', error.message);
  }
}

// Запуск синхронизации
console.log('🚀 Starting Stripe sync service...');
console.log('⏰ Sync interval: 5 minutes');

// Первый запуск сразу
syncPayments();

// Затем каждые 5 минут
setInterval(syncPayments, 5 * 60 * 1000);

