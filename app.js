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
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID,
  BOT_DISABLED: process.env.BOT_DISABLED === 'true',
       NOTIFICATIONS_DISABLED: process.env.NOTIFICATIONS_DISABLED === 'true', // По умолчанию включены
       AUTO_SYNC_DISABLED: process.env.AUTO_SYNC_DISABLED === 'true' // По умолчанию включены
};

// Простое хранилище для запоминания существующих покупок
const existingPurchases = new Set();

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Функция для анализа GEO данных и отправки ТОП-3 алертов
async function sendGeoAlert() {
  try {
    console.log('🌍 Анализирую GEO данные за сегодня...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю GEO анализ');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    // Получаем сегодняшнюю дату в UTC+1
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`📅 Анализирую покупки за ${todayStr} (UTC+1)`);
    
    // Фильтруем покупки за сегодня
    const todayPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      return createdLocal.includes(todayStr);
    });
    
    console.log(`📊 Найдено ${todayPurchases.length} покупок за сегодня`);
    
    if (todayPurchases.length === 0) {
      console.log('📭 Нет покупок за сегодня - пропускаю GEO алерт');
      return;
    }
    
    // Анализируем GEO данные
    const geoStats = new Map();
    
    for (const purchase of todayPurchases) {
      const geo = purchase.get('GEO') || 'Unknown';
      const country = geo.split(',')[0].trim(); // Берем только страну
      
      if (geoStats.has(country)) {
        geoStats.set(country, geoStats.get(country) + 1);
      } else {
        geoStats.set(country, 1);
      }
    }
    
    // Сортируем по количеству покупок
    const sortedGeo = Array.from(geoStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    // Формируем ТОП-3
    const top3 = [];
    for (const [country, count] of sortedGeo) {
      const flag = getCountryFlag(country);
      top3.push(`${flag} ${country} - ${count}`);
    }
    
    // Добавляем WW (все остальные)
    const totalToday = todayPurchases.length;
    const top3Total = sortedGeo.reduce((sum, [, count]) => sum + count, 0);
    const wwCount = totalToday - top3Total;
    
    if (wwCount > 0) {
      top3.push(`🌍 WW - ${wwCount}`);
    }
    
    // Формируем сообщение
    const alertText = `📊 **ТОП-3 ГЕО за сегодня (${todayStr})**\n\n${top3.join('\n')}\n\n📈 Всего покупок: ${totalToday}`;
    
    console.log('📤 Отправляю GEO алерт:', alertText);
    
    // Отправляем в Telegram
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      try {
        await sendTelegram(alertText);
        console.log('✅ GEO алерт отправлен в Telegram');
      } catch (error) {
        console.error('❌ Ошибка отправки GEO алерта в Telegram:', error.message);
      }
    }
    
    // Отправляем в Slack
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      try {
        await sendSlack(alertText);
        console.log('✅ GEO алерт отправлен в Slack');
      } catch (error) {
        console.error('❌ Ошибка отправки GEO алерта в Slack:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка GEO анализа:', error.message);
  }
}

// Функция для получения флага страны
function getCountryFlag(country) {
  const flags = {
    'US': '🇺🇸',
    'CA': '🇨🇦', 
    'AU': '🇦🇺',
    'GB': '🇬🇧',
    'DE': '🇩🇪',
    'FR': '🇫🇷',
    'IT': '🇮🇹',
    'ES': '🇪🇸',
    'NL': '🇳🇱',
    'SE': '🇸🇪',
    'NO': '🇳🇴',
    'DK': '🇩🇰',
    'FI': '🇫🇮',
    'PL': '🇵🇱',
    'CZ': '🇨🇿',
    'HU': '🇭🇺',
    'RO': '🇷🇴',
    'BG': '🇧🇬',
    'HR': '🇭🇷',
    'SI': '🇸🇮',
    'SK': '🇸🇰',
    'LT': '🇱🇹',
    'LV': '🇱🇻',
    'EE': '🇪🇪',
    'IE': '🇮🇪',
    'PT': '🇵🇹',
    'GR': '🇬🇷',
    'CY': '🇨🇾',
    'MT': '🇲🇹',
    'LU': '🇱🇺',
    'AT': '🇦🇹',
    'BE': '🇧🇪',
    'CH': '🇨🇭',
    'IS': '🇮🇸',
    'LI': '🇱🇮',
    'MC': '🇲🇨',
    'SM': '🇸🇲',
    'VA': '🇻🇦',
    'AD': '🇦🇩',
    'JP': '🇯🇵',
    'KR': '🇰🇷',
    'CN': '🇨🇳',
    'IN': '🇮🇳',
    'BR': '🇧🇷',
    'MX': '🇲🇽',
    'AR': '🇦🇷',
    'CL': '🇨🇱',
    'CO': '🇨🇴',
    'PE': '🇵🇪',
    'VE': '🇻🇪',
    'UY': '🇺🇾',
    'PY': '🇵🇾',
    'BO': '🇧🇴',
    'EC': '🇪🇨',
    'GY': '🇬🇾',
    'SR': '🇸🇷',
    'FK': '🇫🇰',
    'GF': '🇬🇫',
    'ZA': '🇿🇦',
    'EG': '🇪🇬',
    'NG': '🇳🇬',
    'KE': '🇰🇪',
    'GH': '🇬🇭',
    'MA': '🇲🇦',
    'TN': '🇹🇳',
    'DZ': '🇩🇿',
    'LY': '🇱🇾',
    'SD': '🇸🇩',
    'ET': '🇪🇹',
    'UG': '🇺🇬',
    'TZ': '🇹🇿',
    'RW': '🇷🇼',
    'BI': '🇧🇮',
    'DJ': '🇩🇯',
    'SO': '🇸🇴',
    'ER': '🇪🇷',
    'SS': '🇸🇸',
    'CF': '🇨🇫',
    'TD': '🇹🇩',
    'NE': '🇳🇪',
    'ML': '🇲🇱',
    'BF': '🇧🇫',
    'CI': '🇨🇮',
    'GN': '🇬🇳',
    'SN': '🇸🇳',
    'GM': '🇬🇲',
    'GW': '🇬🇼',
    'CV': '🇨🇻',
    'ST': '🇸🇹',
    'AO': '🇦🇴',
    'ZM': '🇿🇲',
    'ZW': '🇿🇼',
    'BW': '🇧🇼',
    'NA': '🇳🇦',
    'SZ': '🇸🇿',
    'LS': '🇱🇸',
    'MW': '🇲🇼',
    'MZ': '🇲🇿',
    'MG': '🇲🇬',
    'MU': '🇲🇺',
    'SC': '🇸🇨',
    'KM': '🇰🇲',
    'YT': '🇾🇹',
    'RE': '🇷🇪',
    'Unknown': '❓',
    'N/A': '❓'
  };
  
  return flags[country] || '🌍';
}

// Функция для загрузки и запоминания существующих покупок
async function loadExistingPurchases() {
  try {
    console.log('🔄 Загружаю существующие покупки из Google Sheets...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю загрузку');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📋 Найдено ${rows.length} строк в Google Sheets`);
    console.log('📊 Доступные колонки:', sheet.headerValues);
    
    // Очищаем старое хранилище
    existingPurchases.clear();
    
    // Загружаем все существующие Purchase ID
    for (const row of rows) {
      const purchaseId = row.get('Purchase ID') || row.get('purchase_id') || '';
      if (purchaseId) {
        existingPurchases.add(purchaseId);
        // Убираем детальные логи для каждой покупки
      } else {
        console.log(`⚠️ Пустой Purchase ID в строке:`, row._rawData);
      }
    }
    
    console.log(`✅ Загружено ${existingPurchases.size} существующих покупок в память`);
    console.log('📝 Список покупок:', Array.from(existingPurchases).slice(0, 5), '...');
    
  } catch (error) {
    console.error('❌ Ошибка загрузки существующих покупок:', error.message);
  }
}

// Middleware
app.use(express.json());

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  message: 'Stripe Ops API is running!',
  status: 'ok',
  timestamp: new Date().toISOString(),
  endpoints: ['/api/test', '/api/sync-payments', '/api/geo-alert', '/api/memory-status', '/health', '/webhook/stripe']
}));

// Исправляем ошибки favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/favicon.png', (req, res) => {
  res.status(204).end();
});

// Health check
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Endpoint для загрузки существующих покупок
app.get('/api/load-existing', async (req, res) => {
  try {
    await loadExistingPurchases();
    res.json({
      success: true,
      message: `Loaded ${existingPurchases.size} existing purchases`,
      count: existingPurchases.size,
      purchases: Array.from(existingPurchases).slice(0, 10) // Показываем первые 10
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для проверки состояния памяти
app.get('/api/memory-status', (req, res) => {
  res.json({
    success: true,
    message: `Memory contains ${existingPurchases.size} purchases`,
    count: existingPurchases.size,
    purchases: Array.from(existingPurchases).slice(0, 20), // Показываем первые 20
    auto_sync_disabled: ENV.AUTO_SYNC_DISABLED,
    notifications_disabled: ENV.NOTIFICATIONS_DISABLED
  });
});

// Endpoint для ручного запуска GEO алерта
app.get('/api/geo-alert', async (req, res) => {
  try {
    console.log('🌍 Ручной запуск GEO алерта...');
    await sendGeoAlert();
    res.json({
      success: true,
      message: 'GEO alert sent successfully'
    });
  } catch (error) {
    console.error('❌ GEO alert error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ПРИНУДИТЕЛЬНАЯ АКТИВНОСТЬ чтобы Vercel не засыпал
app.get('/ping', (_req, res) => {
  console.log('💓 PING: Поддерживаю активность Vercel...');
  console.log('🕐 Время:', new Date().toISOString());
  res.status(200).json({ 
    status: 'alive', 
    timestamp: new Date().toISOString(),
    message: 'Vercel не заснет!' 
  });
});

// ПРИНУДИТЕЛЬНАЯ АВТОСИНХРОНИЗАЦИЯ при каждом запросе
app.get('/auto-sync', async (req, res) => {
  try {
    console.log('🔄 Принудительная автоСинхронизация...');
    
    // Используем тот же endpoint что и основной sync
    const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      console.error('❌ Auto-sync request failed:', response.status, response.statusText);
      return res.status(500).json({ error: 'Auto-sync request failed' });
    }
    
    const result = await response.json();
    console.log('✅ Auto-sync completed:', result);
    
    res.json({ 
      success: true, 
      message: `Auto-sync completed! ${result.processed || 0} NEW purchases processed`,
      processed: result.processed || 0,
      total_groups: result.total_groups || 0
    });
    
  } catch (error) {
    console.error('Auto-sync failed:', error.message);
    res.status(500).json({ error: 'Auto-sync failed: ' + error.message });
  }
});

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
    
    // Загружаем существующие покупки в память
    console.log('🔄 Вызываю loadExistingPurchases...');
    await loadExistingPurchases();
    console.log(`📝 В памяти сейчас: ${existingPurchases.size} покупок`);
    
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
      // ПРОСТАЯ ОБРАБОТКА: используем ключ как есть
      const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
      
      if (!privateKey) {
        throw new Error('Google Sheets private key not configured');
      }
      
      console.log('✅ Google Sheets key loaded successfully');
      
      serviceAccountAuth = new JWT({
        email: ENV.GOOGLE_SERVICE_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      
      doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
      await doc.loadInfo();
      console.log(`✅ Google Sheets подключен: ${doc.title}`);
      
      sheet = doc.sheetsByIndex[0];
      if (!sheet) {
        console.error('❌ No sheets found in document!');
        return res.status(500).json({ success: false, message: 'Sheet not found' });
      }
      
      console.log(`📄 Using sheet: "${sheet.title}"`);
      console.log(`📄 Sheet ID: ${sheet.sheetId}`);
      console.log(`📄 Sheet URL: ${sheet.url}`);
      
      // Load existing rows
      rows = await sheet.getRows();
      console.log(`📋 Existing rows in sheet: ${rows.length}`);
      
      // СТРОГАЯ ПРОВЕРКА: показываем все данные для отладки
      if (rows.length > 0) {
        console.log('📄 Google Sheets debug info:');
        console.log('📄 Total rows:', rows.length);
        console.log('📄 Available columns:', sheet.headerValues);
        console.log('📄 First 3 rows:');
        for (let i = 0; i < Math.min(3, rows.length); i++) {
          const row = rows[i];
          console.log(`Row ${i + 1}:`);
          console.log(`  - Purchase ID: "${row.get('Purchase ID')}"`);
          console.log(`  - purchase_id: "${row.get('purchase_id')}"`);
          console.log(`  - Customer ID: "${row.get('Customer ID')}"`);
          console.log(`  - Email: "${row.get('Customer Email')}"`);
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
    
    // Упрощенная отладка Google Sheets
    console.log(`📊 Google Sheets: ${rows.length} строк, колонки: ${sheet.headerValues.length}`);

    // ПРОСТАЯ ЛОГИКА: проверяем каждую покупку из Stripe (только если Google Sheets пустой)
    for (const [dateKey, group] of groupedPurchases.entries()) {
      try {
        const customer = group.customer;
        const firstPayment = group.firstPayment;
        const m = { ...firstPayment.metadata, ...(customer?.metadata || {}) };

        // Create unique purchase ID
        const purchaseId = `purchase_${customer?.id || 'unknown'}_${dateKey.split('_')[1]}`;

        // ИСПРАВЛЕНО: ПРОВЕРЯЕМ ДУБЛИКАТЫ В ПАМЯТИ И GOOGLE SHEETS
        const existsInMemory = existingPurchases.has(purchaseId);
        const existsInSheets = rows.some((row) => {
          const rowPurchaseId = row.get('Purchase ID') || row.get('purchase_id') || '';
          return rowPurchaseId === purchaseId;
        });
        
        if (existsInMemory || existsInSheets) {
          console.log(`⏭️ SKIP: ${purchaseId} already exists`);
          continue; // Пропускаем существующие
        }
        
        console.log(`🆕 NEW: ${purchaseId} - ADDING`);

        // ИСПРАВЛЕНО: GEO data - Country, City формат
        let geoCountry = m.geo_country || m.country || customer?.address?.country || 'N/A';
        let geoCity = m.geo_city || m.city || '';
        const country = geoCity ? `${geoCountry}, ${geoCity}` : geoCountry;
        
        // GEO формат: Country, City

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

        // Валидация данных покупки

        // Добавляем в Google Sheets только если подключение работает
        let savedToSheets = false;
        if (sheet) {
          try {
            console.log(`💾 Saving to Google Sheets: ${purchaseId}`);
            
            // Создаем данные в том же формате что уже есть в таблице
            // ИСПРАВЛЕНО: ПРАВИЛЬНОЕ UTC+1 ВРЕМЯ
            const utcTime = new Date(purchaseData.created_at);
            const utcPlus1 = new Date(utcTime.getTime() + 60 * 60 * 1000);
            const utcPlus1Formatted = utcPlus1.toISOString().replace('T', ' ').replace('Z', ' UTC+1');
            
            const rowData = {
              'Purchase ID': purchaseData.purchase_id,
              'Total Amount': purchaseData.amount,
              'Currency': purchaseData.currency,
              'Status': purchaseData.payment_status,
              'Created UTC': purchaseData.created_at,
              'Created Local (UTC+1)': utcPlus1Formatted,
              'Customer ID': purchaseData.customer_id,
              'Customer Email': purchaseData.email,
              'GEO': purchaseData.country,
              'UTM Source': purchaseData.utm_source,
              'UTM Medium': purchaseData.utm_medium,
              'UTM Campaign': purchaseData.utm_campaign,
              'UTM Content': purchaseData.utm_content,
              'UTM Term': purchaseData.utm_term,
              'Ad Name': purchaseData.ad_name,
              'Adset Name': purchaseData.adset_name,
              'Payment Count': purchaseData.payment_count
            };
            
            // Сохраняем данные в Google Sheets
            await sheet.addRow(rowData);
            console.log('✅ Payment data saved to Google Sheets:', purchaseId);
            savedToSheets = true;
          } catch (error) {
            console.error('❌ Error saving to Google Sheets:', error.message);
            console.error('❌ Error details:', error);
            console.log('⚠️ Purchase data:', purchaseData);
            savedToSheets = false;
          }
        } else {
          console.log('⚠️ Google Sheets not available, skipping save for:', purchaseId);
          savedToSheets = false;
        }

        // Отправляем уведомления ТОЛЬКО если успешно сохранили в Google Sheets И уведомления включены
        if (savedToSheets && !ENV.NOTIFICATIONS_DISABLED) {
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
        } else if (ENV.NOTIFICATIONS_DISABLED) {
          console.log('🚫 Notifications disabled - skipping notifications');
        } else {
          console.log('🚫 Notifications skipped - purchase not saved to Google Sheets');
        }

        // ИСПРАВЛЕНО: Увеличиваем счетчики ТОЛЬКО если покупка действительно сохранена
        if (savedToSheets) {
          // Добавляем в память для будущих проверок
          existingPurchases.add(purchaseId);
          console.log(`✅ Added to memory: ${purchaseId}`);
          
          newPurchases++;
          processedPurchases.push({
            purchase_id: purchaseId,
            email: purchaseData.email,
            amount: purchaseData.amount,
            payments_count: purchaseData.payment_count
          });
        }
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
    `🔗 quiz.testora.pro/iq1`,
    `meta`,
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
🔗 quiz.testora.pro/iq1
meta
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
        
        // ПОСТОЯННАЯ АВТОСИНХРОНИЗАЦИЯ - РАБОТАЕТ НА VERCEL
        console.log('🔄 АвтоСинхронизация ВКЛЮЧЕНА - постоянная работа каждые 5 минут');
        
        // Функция синхронизации - ИСПРАВЛЕННАЯ ЛОГИКА
        async function runSync() {
          try {
            console.log('🤖 АВТОМАТИЧЕСКАЯ РАБОТА БОТА:');
            console.log('   🔍 Проверяю Stripe на новые покупки...');
            console.log('⏰ Время проверки:', new Date().toISOString());
            
            // ИСПРАВЛЕНО: Используем правильный endpoint с проверкой savedToSheets
            const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) {
              console.error('❌ Sync request failed:', response.status, response.statusText);
              return;
            }
            
            const result = await response.json();
            console.log('✅ Auto-sync completed:', result);
            
            console.log(`🤖 АВТОМАТИЧЕСКАЯ РАБОТА ЗАВЕРШЕНА:`);
            console.log(`   ✅ Обработано новых покупок: ${result.processed || 0}`);
            console.log(`   📊 Всего групп в Stripe: ${result.total_groups || 0}`);
            console.log(`   ⏰ Следующая проверка через 5 минут`);
            
          } catch (error) {
            console.error('❌ Auto-sync failed:', error.message);
          }
        }
        
        // НАДЕЖНАЯ АВТОСИНХРОНИЗАЦИЯ КАЖДЫЕ 5 МИНУТ
        console.log('🔄 Запуск автоСинхронизации каждые 5 минут...');
        
        // Первый запуск через 30 секунд
        setTimeout(() => {
          console.log('🚀 Первый запуск автоСинхронизации...');
          runSync();
        }, 30 * 1000);
        
        // ПОЛНАЯ АВТОМАТИЗАЦИЯ - БОТ РАБОТАЕТ САМ БЕЗ ПРОСЬБ
        console.log('🤖 БОТ НАСТРОЕН НА ПОЛНУЮ АВТОМАТИЗАЦИЮ:');
        console.log('   ✅ Проверяет Stripe каждые 5 минут');
        console.log('   ✅ Добавляет новые покупки в Google Sheets');
        console.log('   ✅ Отправляет уведомления в Telegram и Slack');
        console.log('   ✅ Работает БЕЗ твоего участия');
        console.log('🚀 АВТОСИНХРОНИЗАЦИЯ ЗАПУЩЕНА И РАБОТАЕТ!');
        console.log('⚠️ ВНИМАНИЕ: Vercel может "засыпать" - используйте внешний cron!');
        console.log('🔗 Настройте cron job на: https://cron-job.org/');
        console.log('   URL: https://testoraapp.vercel.app/api/sync-payments');
        console.log('   Method: POST');
        console.log('   Interval: каждые 5 минут');
        
        // ЛОГИРОВАНИЕ ПРИ ЗАПУСКЕ
        console.log('🚀 ===== БОТ ЗАПУЩЕН =====');
        console.log('🕐 Время запуска:', new Date().toISOString());
        console.log('🌐 Vercel URL: https://testoraapp.vercel.app');
        // ПРОВЕРКА: БОТ ОТКЛЮЧЕН?
        if (ENV.BOT_DISABLED) {
          console.log('🛑 ===== БОТ ОТКЛЮЧЕН =====');
          console.log('⚠️ BOT_DISABLED=true - бот не работает');
          console.log('🔧 Чтобы включить: установи BOT_DISABLED=false');
          return;
        }
        
        // ВОЗВРАЩАЕМ АВТОМАТИЗАЦИЮ ДЛЯ RAILWAY
        console.log('🚀 ===== БОТ ЗАПУЩЕН НА RAILWAY =====');
        console.log('🕐 Время запуска:', new Date().toISOString());
        console.log('🌐 Railway URL: https://testoraapp.railway.app');
        console.log('🤖 БОТ НАСТРОЕН НА ПОЛНУЮ АВТОМАТИЗАЦИЮ:');
        console.log('   ✅ Проверяет Stripe каждые 5 минут');
        console.log('   ✅ Добавляет новые покупки в Google Sheets');
        console.log('   ✅ Отправляет уведомления в Telegram и Slack');
        console.log('   ✅ Работает БЕЗ твоего участия');
        console.log('🚀 АВТОСИНХРОНИЗАЦИЯ ЗАПУЩЕНА И РАБОТАЕТ!');
        
             // ОСНОВНАЯ АВТОМАТИЗАЦИЯ каждые 5 минут (ВКЛЮЧЕНА ПО УМОЛЧАНИЮ)
             if (ENV.AUTO_SYNC_DISABLED !== true) {
               console.log('🔄 АВТОСИНХРОНИЗАЦИЯ ВКЛЮЧЕНА (по умолчанию)');
               setInterval(() => {
                 console.log('🤖 АВТОМАТИЧЕСКАЯ ПРОВЕРКА: Ищу новые покупки в Stripe...');
                 runSync();
               }, 5 * 60 * 1000);
               
               // ДОПОЛНИТЕЛЬНАЯ АВТОМАТИЗАЦИЯ каждые 2 минуты
               setInterval(() => {
                 console.log('🤖 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Убеждаюсь что ничего не пропустил...');
                 runSync();
               }, 2 * 60 * 1000);
               
               // GEO АЛЕРТЫ каждые 60 минут
               console.log('🌍 GEO АЛЕРТЫ ВКЛЮЧЕНЫ - каждые 60 минут');
               setInterval(() => {
                 console.log('🌍 АВТОМАТИЧЕСКИЙ GEO АНАЛИЗ: Анализирую ТОП-3 стран...');
                 sendGeoAlert();
               }, 60 * 60 * 1000); // 60 минут
               
             } else {
               console.log('🛑 АВТОСИНХРОНИЗАЦИЯ ОТКЛЮЧЕНА');
               console.log('🔧 Для включения установите AUTO_SYNC_DISABLED=false в Railway');
               console.log('📞 Используйте ручной вызов: POST /api/sync-payments');
             }
        
        // Показываем статус уведомлений
        if (ENV.NOTIFICATIONS_DISABLED) {
          console.log('🚫 УВЕДОМЛЕНИЯ ОТКЛЮЧЕНЫ');
          console.log('🔧 Для включения установите NOTIFICATIONS_DISABLED=false в Railway');
        } else {
          console.log('📱 УВЕДОМЛЕНИЯ ВКЛЮЧЕНЫ (по умолчанию)');
        }
});

export default app;
