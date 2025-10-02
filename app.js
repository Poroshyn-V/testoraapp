// Чистая версия для Vercel - без синтаксических ошибок
import express from 'express';
import pino from 'pino';
import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const app = express();
const logger = pino({ level: 'info' });

// Environment variables
const ENV = {
  PORT: process.env.PORT || 3000,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: process.env.GOOGLE_SERVICE_PRIVATE_KEY,
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Middleware
app.use(express.json());

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  message: 'Stripe Ops API is running!',
  status: 'ok',
  timestamp: new Date().toISOString(),
  endpoints: ['/api/test', '/api/sync-payments', '/health', '/webhook/stripe']
}));

// Health check
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Vercel test successful!',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url
  });
});

// GET endpoint for sync-payments (for testing)
app.get('/api/sync-payments', (req, res) => {
  res.json({ 
    message: 'Sync endpoint available - use POST method for actual sync',
    timestamp: new Date().toISOString(),
    method: req.method,
    note: 'Use POST /api/sync-payments to trigger sync'
  });
});

// Stripe webhook endpoint
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, ENV.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      console.log('🎉 Webhook received:', event.type);
      console.log('✅ Webhook processed - automatic sync will handle this');
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Sync payments endpoint
app.post('/api/sync-payments', async (req, res) => {
  try {
    console.log('🔄 Starting payment sync...');
    
    // Get payments from last 7 days
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    const payments = await stripe.paymentIntents.list({
      limit: 100,
      created: {
        gte: sevenDaysAgo
      }
    });
    
    if (payments.data.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No payments found',
        processed: 0 
      });
    }
    
    // Filter successful payments
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded' && p.customer);
    console.log(`📊 Found ${successfulPayments.length} successful payments`);
    
    // Group purchases by customer + date
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      if (payment.customer) {
        let customer = null;
        try {
          customer = await stripe.customers.retrieve(payment.customer);
          if (customer && 'deleted' in customer && customer.deleted) {
            customer = null;
          }
        } catch (err) {
          console.error(`Error retrieving customer ${payment.customer}:`, err);
        }

        const customerId = customer?.id || 'unknown_customer';
        const purchaseDate = new Date(payment.created * 1000);
        const dateKey = `${customerId}_${purchaseDate.toISOString().split('T')[0]}`;

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

    let newPurchases = 0;
    const processedPurchases = [];

    // Initialize Google Sheets
    console.log('🔍 Google Sheets debug info:');
    console.log('Email exists:', !!ENV.GOOGLE_SERVICE_EMAIL);
    console.log('Private key exists:', !!ENV.GOOGLE_SERVICE_PRIVATE_KEY);
    console.log('Doc ID exists:', !!ENV.GOOGLE_SHEETS_DOC_ID);
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Missing Google Sheets environment variables');
      return res.status(500).json({
        success: false,
        message: 'Google Sheets not configured - missing environment variables'
      });
    }
    
    let serviceAccountAuth;
    let doc;
    let sheet;
    let rows = [];
    
    try {
      // Обработка приватного ключа для Vercel
      let privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
      
      // Vercel может экранировать символы, исправляем
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      // Если ключ не содержит заголовки, добавляем их
      if (!privateKey.includes('BEGIN PRIVATE KEY')) {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
      }
      
      console.log('✅ Google Sheets key formatted successfully');
      
      serviceAccountAuth = new JWT({
        email: ENV.GOOGLE_SERVICE_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      
      doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
      await doc.loadInfo();
      
      sheet = doc.sheetsByIndex[0];
      if (!sheet) {
        console.error('❌ No sheets found in document!');
        return res.status(500).json({ success: false, message: 'Sheet not found' });
      }
      
      console.log(`📄 Using sheet: "${sheet.title}"`);
      
      // Load existing rows
      rows = await sheet.getRows();
      console.log(`📋 Existing rows in sheet: ${rows.length}`);
      
      // Показываем первые 3 строки для отладки
      if (rows.length > 0) {
        console.log('📄 First 3 rows in Google Sheets:');
        console.log('📄 Available columns:', sheet.headerValues);
        for (let i = 0; i < Math.min(3, rows.length); i++) {
          const row = rows[i];
          console.log(`Row ${i + 1}:`);
          console.log(`  - customer_id: "${row.get('customer_id')}"`);
          console.log(`  - created_at: "${row.get('created_at')}"`);
          console.log(`  - email: "${row.get('email')}"`);
          console.log(`  - All data:`, row._rawData);
        }
      }
      
    } catch (error) {
      console.error('❌ Google Sheets error:', error.message);
      console.log('⚠️ Google Sheets not available - STOPPING SYNC to prevent duplicates');
      
      // Если Google Sheets не работает, НЕ ОБРАБАТЫВАЕМ ПОКУПКИ ВООБЩЕ
      return res.status(500).json({
        success: false,
        message: 'Google Sheets not available - sync stopped to prevent duplicates',
        error: error.message
      });
    }

    // СТРОГАЯ ПРОВЕРКА: если Google Sheets пустой, НЕ ОБРАБАТЫВАЕМ
    if (rows.length === 0) {
      console.log('⚠️ Google Sheets is EMPTY - STOPPING SYNC to prevent duplicates');
      return res.status(500).json({
        success: false,
        message: 'Google Sheets is empty - sync stopped to prevent duplicates',
        rows_count: 0
      });
    }

    // ПРОСТАЯ РАБОЧАЯ ЛОГИКА С RENDER: проверяем каждую покупку индивидуально
    console.log(`✅ Processing ${groupedPurchases.size} Stripe purchases against ${rows.length} existing rows in Google Sheets`);

    // ПРОСТАЯ ЛОГИКА: проверяем каждую покупку из Stripe (только если Google Sheets пустой)
    for (const [dateKey, group] of groupedPurchases.entries()) {
      try {
        const customer = group.customer;
        const firstPayment = group.firstPayment;
        const m = { ...firstPayment.metadata, ...(customer?.metadata || {}) };

        // Create unique purchase ID
        const purchaseId = `purchase_${customer?.id || 'unknown'}_${dateKey.split('_')[1]}`;

        // ПРОСТАЯ ПРОВЕРКА С RENDER: есть ли эта покупка в Google Sheets?
        const exists = rows.some((row) => row.get('purchase_id') === purchaseId);
        
        if (exists) {
          console.log(`⏭️ Purchase already exists: ${purchaseId} - SKIP`);
          continue; // Пропускаем существующие
        }
        
        console.log(`🆕 NEW purchase: ${purchaseId} - ADDING`);

        // Format GEO data
        let geoCountry = m.geo_country || m.country || customer?.address?.country || 'N/A';
        let geoCity = m.geo_city || '';
        const country = geoCity ? `${geoCity}, ${geoCountry}` : geoCountry;

        const purchaseData = {
          created_at: new Date(firstPayment.created * 1000).toISOString(),
          purchase_id: purchaseId,
          payment_status: 'succeeded',
          amount: (group.totalAmount / 100).toFixed(2),
          currency: (firstPayment.currency || 'usd').toUpperCase(),
          email: customer?.email || firstPayment.receipt_email || 'N/A',
          country: country,
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
          campaign_name: m.campaign_name || m.utm_campaign || '',
          web_campaign: m.web_campaign || '',
          customer_id: customer?.id || 'N/A',
          client_reference_id: firstPayment.client_secret || '',
          mode: firstPayment.setup_future_usage ? 'setup' : 'payment',
          status: firstPayment.status || '',
          raw_metadata_json: JSON.stringify(m),
          payment_count: group.payments.length
        };

        // Добавляем в Google Sheets только если подключение работает
        if (sheet) {
          await sheet.addRow(purchaseData);
          console.log('✅ Payment data saved to Google Sheets:', purchaseId);
        } else {
          console.log('⚠️ Google Sheets not available, skipping save for:', purchaseId);
        }

            // Отправляем уведомления ТОЛЬКО для новых покупок (после добавления в Google Sheets)
            try {
              const telegramText = formatTelegram(purchaseData, customer?.metadata || {});
              await sendTelegram(telegramText);
              console.log('📱 Telegram notification sent for NEW purchase:', purchaseId);
            } catch (error) {
              console.error('Error sending Telegram:', error.message);
            }

            try {
              const slackText = formatSlack(purchaseData, customer?.metadata || {});
              await sendSlack(slackText);
              console.log('💬 Slack notification sent for NEW purchase:', purchaseId);
            } catch (error) {
              console.error('Error sending Slack:', error.message);
            }

        newPurchases++;
        processedPurchases.push({
          purchase_id: purchaseId,
          email: purchaseData.email,
          amount: purchaseData.amount,
          payments_count: purchaseData.payment_count
        });
      } catch (error) {
        console.error(`Error processing purchase ${dateKey}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      message: `Sync completed! Processed ${newPurchases} purchase(s)`,
      total_groups: groupedPurchases.size,
      processed: newPurchases,
      purchases: processedPurchases
    });
    
  } catch (error) {
    console.error('❌ Sync error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Sync failed',
      error: error.message
    });
  }
});

// Telegram functions
async function sendTelegram(text) {
  if (!ENV.TELEGRAM_BOT_TOKEN || !ENV.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping notification');
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
      })
    });

    const result = await response.json();
    if (result.ok) {
      console.log('Telegram notification sent successfully');
    } else {
      console.error('Telegram API error:', result.description);
    }
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}

function formatTelegram(purchaseData, customerMetadata = {}) {
  const m = { ...purchaseData, ...customerMetadata };
  const amount = parseFloat(purchaseData.amount);
  const currency = purchaseData.currency;
  const email = purchaseData.email;
  const paymentId = purchaseData.purchase_id;
  const paymentCount = m.payment_count || '1 payment';
  
  const country = m.country || 'N/A';
  const gender = m.gender || 'N/A';
  const creative_link = m.creative_link || 'N/A';
  const utm_source = m.utm_source || 'N/A';
  const platform_placement = m.platform_placement || 'N/A';
  const ad_name = m.ad_name || 'N/A';
  const adset_name = m.adset_name || 'N/A';
  const campaign_name = m.campaign_name || m.utm_campaign || 'N/A';

  const lines = [
    `🟢 Purchase ${paymentId} was processed!`,
    `---------------------------`,
    `💳 card`,
    `💰 ${amount} ${currency}`,
    `🏷️ ${paymentCount}`,
    `---------------------------`,
    `📧 ${email}`,
    `---------------------------`,
    `🌪️ ${paymentId}`,
    `📍 ${country}`,
    `🧍 ${gender}`,
    `🔗 ${creative_link}`,
    utm_source,
    platform_placement,
    ad_name,
    adset_name,
    campaign_name
  ];

  let text = lines.join('\n');
  if (text.length > 4096) text = text.slice(0, 4093) + '...';
  return text;
}

// Slack functions
async function sendSlack(text) {
  console.log('🔍 Slack debug - checking configuration...');
  console.log('SLACK_BOT_TOKEN exists:', !!ENV.SLACK_BOT_TOKEN);
  console.log('SLACK_CHANNEL_ID exists:', !!ENV.SLACK_CHANNEL_ID);
  
  if (!ENV.SLACK_BOT_TOKEN || !ENV.SLACK_CHANNEL_ID) {
    console.log('❌ Slack not configured, skipping notification');
    console.log('Missing:', {
      token: !ENV.SLACK_BOT_TOKEN,
      channel: !ENV.SLACK_CHANNEL_ID
    });
    return;
  }

  try {
    console.log('📤 Sending Slack notification...');
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENV.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: ENV.SLACK_CHANNEL_ID,
        text: text,
        username: 'Stripe Bot',
        icon_emoji: ':money_with_wings:'
      })
    });

    const result = await response.json();
    console.log('📥 Slack API response:', result);
    
    if (result.ok) {
      console.log('✅ Slack notification sent successfully');
    } else {
      console.error('❌ Slack API error:', result.error);
    }
  } catch (error) {
    console.error('❌ Error sending Slack notification:', error);
  }
}

function formatSlack(purchaseData, customerMetadata = {}) {
  const m = { ...purchaseData, ...customerMetadata };
  const amount = parseFloat(purchaseData.amount);
  const currency = purchaseData.currency;
  const email = purchaseData.email;
  const paymentId = purchaseData.purchase_id;
  const paymentCount = m.payment_count || '1 payment';
  
  const country = m.country || 'N/A';
  const gender = m.gender || 'N/A';
  const creative_link = m.creative_link || 'N/A';
  const utm_source = m.utm_source || 'N/A';
  const platform_placement = m.platform_placement || 'N/A';
  const ad_name = m.ad_name || 'N/A';
  const adset_name = m.adset_name || 'N/A';
  const campaign_name = m.campaign_name || m.utm_campaign || 'N/A';
  
  return `🟢 *Purchase ${paymentId} was processed!*
---------------------------
💳 card
💰 ${amount} ${currency}
🏷️ ${paymentCount}
---------------------------
📧 ${email}
---------------------------
🌪️ ${paymentId}
📍 ${country}
🧍 ${gender}
🔗 ${creative_link}
${utm_source}
${platform_placement}
${ad_name}
${adset_name}
${campaign_name}`;
}

// Start server
app.listen(ENV.PORT, () => {
  logger.info(`Server listening on port ${ENV.PORT}`);
  console.log('🔄 Starting automatic sync every 2 minutes...');
  
  // First run after 30 seconds
  setTimeout(async () => {
    try {
      console.log('🚀 Running initial sync...');
      const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      console.log('Initial sync completed:', result);
    } catch (error) {
      console.error('Initial sync failed:', error.message);
    }
  }, 30000);
  
  // Then every 2 minutes
        // АВТОСИНХРОНИЗАЦИЯ ВКЛЮЧЕНА - УМНАЯ ПРОВЕРКА ДУБЛИРОВАНИЙ
        console.log('🔄 Auto-sync ENABLED - smart duplicate checking');
        
        // АВТОСИНХРОНИЗАЦИЯ ВКЛЮЧЕНА - РАБОЧАЯ ЛОГИКА С RENDER
        console.log('🔄 АвтоСинхронизация ВКЛЮЧЕНА - рабочая логика с Render');
        setInterval(async () => {
          try {
            console.log('🔄 Running scheduled sync...');
            const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            console.log('Scheduled sync completed:', result);
          } catch (error) {
            console.error('Scheduled sync failed:', error.message);
          }
        }, 5 * 60 * 1000); // 5 minutes
});

export default app;
