import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import fetch from 'node-fetch';
import { ENV } from './lib/env.js';

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
const processedPayments = new Set();

async function sendTelegram(text) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ENV.TELEGRAM_CHAT_ID,
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
  if (!ENV.SLACK_BOT_TOKEN || !ENV.SLACK_CHANNEL_ID) {
    console.log('Slack not configured, skipping');
    return true;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENV.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: ENV.SLACK_CHANNEL_ID,
        text: text,
        mrkdwn: false,
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

async function saveToGoogleSheets(payment) {
  if (!ENV.GOOGLE_SHEETS_DOC_ID || !ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY) {
    console.log('Google Sheets not configured, skipping');
    return true;
  }

  try {
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID);
    await doc.useServiceAccountAuth({
      client_email: ENV.GOOGLE_SERVICE_EMAIL,
      private_key: ENV.GOOGLE_SERVICE_PRIVATE_KEY
    });
    await doc.loadInfo();

    let sheet = doc.sheetsByTitle['payments'];
    if (!sheet) {
      const HEADER = ['created_at', 'payment_id', 'amount', 'currency', 'email', 'status', 'source'];
      sheet = await doc.addSheet({ title: 'payments', headerValues: HEADER });
    }

    await sheet.addRow({
      created_at: new Date(payment.created * 1000).toISOString(),
      payment_id: payment.id,
      amount: payment.amount / 100,
      currency: payment.currency.toUpperCase(),
      email: payment.receipt_email || '',
      status: payment.status,
      source: 'API_SYNC'
    });

    console.log('✅ Данные сохранены в Google Sheets');
    return true;
  } catch (error) {
    console.error('Google Sheets error:', error.message);
    return false;
  }
}

function formatTelegram(payment) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = payment.receipt_email || 'N/A';
  
  return `💰 *Новая покупка!*

💳 *Сумма:* ${amount} ${currency}
📧 *Email:* ${email}
🆔 *Payment ID:* \`${payment.id}\`
📅 *Дата:* ${new Date(payment.created * 1000).toLocaleString()}
🔄 *Источник:* API Sync

✅ Платеж обработан успешно!`;
}

function formatSlack(payment) {
  const amount = payment.amount / 100;
  const currency = payment.currency.toUpperCase();
  const email = payment.receipt_email || 'N/A';
  
  return `💰 *New Payment Received!*

💳 *Amount:* ${amount} ${currency}
📧 *Email:* ${email}
🆔 *Payment ID:* \`${payment.id}\`
📅 *Date:* ${new Date(payment.created * 1000).toLocaleString()}
🔄 *Source:* API Sync

✅ Payment processed successfully!`;
}

export async function syncPayments() {
  console.log('🔄 СИНХРОНИЗАЦИЯ ПЛАТЕЖЕЙ...');
  
  try {
    const tenMinutesAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    
    const payments = await stripe.paymentIntents.list({
      limit: 100,
      created: {
        gte: tenMinutesAgo
      }
    });

    console.log(`📊 Найдено платежей: ${payments.data.length}`);

    for (const payment of payments.data) {
      if (processedPayments.has(payment.id)) {
        continue;
      }

      if (payment.status === 'succeeded') {
        console.log(`💳 Обрабатываю платеж: ${payment.id}`);
        
        const telegramText = formatTelegram(payment);
        await sendTelegram(telegramText);
        
        const slackText = formatSlack(payment);
        await sendSlack(slackText);
        
        await saveToGoogleSheets(payment);
        
        processedPayments.add(payment.id);
        console.log(`✅ Платеж ${payment.id} обработан`);
      }
    }

    console.log('✅ Синхронизация завершена');
    
  } catch (error) {
    console.error('❌ Ошибка синхронизации:', error.message);
  }
}
