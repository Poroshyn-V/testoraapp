// Refactored Stripe Ops API - Modular Architecture
import express from 'express';
import { ENV } from './src/config/env.js';
import { logger } from './src/utils/logging.js';
import { rateLimit, getRateLimitStats } from './src/middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import { getCacheStats } from './src/utils/cache.js';
import { stripe, getRecentPayments, getCustomerPayments, getCustomer } from './src/services/stripe.js';
import { sendNotifications, sendTextNotifications } from './src/services/notifications.js';
import googleSheets from './src/services/googleSheets.js';
import { analytics } from './src/services/analytics.js';
import { formatPaymentForSheets, formatTelegramNotification } from './src/utils/formatting.js';
import { validateEmail, validateCustomerId, validatePaymentId, validateAmount } from './src/utils/validation.js';

const app = express();

// Simple storage for existing purchases
const existingPurchases = new Set();
const processedPurchaseIds = new Set();

// Alert tracking to prevent duplicate sends
const sentAlerts = {
  dailyStats: new Set(),
  creativeAlert: new Set(),
  weeklyReport: new Set()
};

// Load existing purchases from Google Sheets into memory
async function loadExistingPurchases() {
  try {
    logger.info('🔄 Загружаю существующие покупки из Google Sheets...');
    
    const rows = await googleSheets.getAllRows();
    
    logger.info(`📋 Найдено ${rows.length} строк в Google Sheets`);
    
    // Очищаем старое хранилище
    existingPurchases.clear();
    
    // Загружаем все существующие Purchase ID
    for (const row of rows) {
      const purchaseId = row.get('Purchase ID') || row.get('purchase_id') || '';
      if (purchaseId) {
        existingPurchases.add(purchaseId);
      } else {
        logger.warn('⚠️ Пустой Purchase ID в строке:', { rowData: row._rawData });
      }
    }
    
    logger.info(`✅ Загружено ${existingPurchases.size} существующих покупок в память`);
    logger.info('📝 Примеры покупок:', { 
      sample: Array.from(existingPurchases).slice(0, 5) 
    });
    
  } catch (error) {
    logger.error('❌ Ошибка загрузки существующих покупок:', error);
  }
}

// Middleware
app.use(express.json());
app.use('/api', rateLimit);

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  message: 'Stripe Ops API is running!',
  status: 'ok',
  timestamp: new Date().toISOString(),
  endpoints: ['/api/test', '/api/sync-payments', '/api/geo-alert', '/api/creative-alert', '/api/daily-stats', '/api/weekly-report', '/api/anomaly-check', '/api/memory-status', '/api/load-existing', '/api/check-duplicates', '/auto-sync', '/ping', '/health']
}));

// Health check
app.get('/health', async (_req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime,
      memory: memUsage,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      services: {
        stripe: 'connected',
        googleSheets: ENV.GOOGLE_SERVICE_EMAIL ? 'configured' : 'not_configured',
        telegram: ENV.TELEGRAM_BOT_TOKEN ? 'configured' : 'not_configured',
        slack: ENV.SLACK_BOT_TOKEN ? 'configured' : 'not_configured'
      },
      rateLimit: getRateLimitStats(),
      memory: {
        existingPurchases: existingPurchases.size,
        processedPurchases: processedPurchaseIds.size
      }
    };
    
    res.status(200).json(healthStatus);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Load existing purchases endpoint
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
    logger.error('Error loading existing purchases', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check duplicates endpoint
app.get('/api/check-duplicates', async (req, res) => {
  try {
    logger.info('🔍 Проверяю дубликаты в Google Sheets...');
    
    const rows = await googleSheets.getAllRows();
    
    logger.info(`📋 Проверяю ${rows.length} строк на дубликаты...`);
    
    // Ищем дубликаты по email + дата + сумма
    const duplicates = [];
    const seen = new Map();
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const email = row.get('Email') || '';
      const date = row.get('Created Local (UTC+1)') || '';
      const amount = row.get('Total Amount') || '';
      
      if (email && date && amount) {
        const key = `${email}_${date}_${amount}`;
        
        if (seen.has(key)) {
          duplicates.push({
            row: i + 1,
            email: email,
            date: date,
            amount: amount,
            purchaseId: row.get('Purchase ID') || '',
            duplicateOf: seen.get(key)
          });
        } else {
          seen.set(key, i + 1);
        }
      }
    }
    
    logger.info(`🔍 Найдено ${duplicates.length} дубликатов`);
    
    res.json({
      success: true,
      message: `Found ${duplicates.length} duplicates in ${rows.length} rows`,
      total_rows: rows.length,
      duplicates_count: duplicates.length,
      duplicates: duplicates.slice(0, 10) // Показываем первые 10
    });
    
  } catch (error) {
    logger.error('Error checking duplicates', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Memory status endpoint
app.get('/api/memory-status', (req, res) => {
  res.json({
    success: true,
    message: `Memory contains ${existingPurchases.size} purchases`,
    count: existingPurchases.size,
    purchases: Array.from(existingPurchases).slice(0, 20),
    auto_sync_disabled: ENV.AUTO_SYNC_DISABLED,
    notifications_disabled: ENV.NOTIFICATIONS_DISABLED
  });
});

// Metrics endpoint
app.get('/api/metrics', (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(uptime),
      human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    },
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
    },
    cache: {
      ...getCacheStats(),
      rateLimitConnections: getRateLimitStats().activeConnections,
      existingPurchases: existingPurchases.size,
      processedPurchases: processedPurchaseIds.size
    },
    performance: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    }
  });
});

// Auto-sync endpoint
app.get('/auto-sync', async (req, res) => {
  try {
    logger.info('🔄 Принудительная автоСинхронизация...');
    
    // Используем тот же endpoint что и основной sync
    const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      logger.error('❌ Auto-sync request failed:', { status: response.status, statusText: response.statusText });
      return res.status(500).json({ error: 'Auto-sync request failed' });
    }
    
    const result = await response.json();
    logger.info('✅ Auto-sync completed:', result);
    
    res.json({ 
      success: true, 
      message: `Auto-sync completed! ${result.processed || 0} NEW purchases processed`,
      processed: result.processed || 0,
      total_groups: result.total_groups || 0
    });
    
  } catch (error) {
    logger.error('Auto-sync failed:', error);
    return res.status(500).json({ error: 'Auto-sync failed: ' + error.message });
  }
});

// Ping endpoint
app.get('/ping', (_req, res) => {
  logger.info('💓 PING: Поддерживаю активность Railway...');
  logger.info('🕐 Время:', { timestamp: new Date().toISOString() });
  res.status(200).json({ 
    status: 'alive', 
    timestamp: new Date().toISOString(),
    message: 'Railway не заснет!' 
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString()
  });
});

// Full resync endpoint - fix all existing data
app.post('/api/full-resync', async (req, res) => {
  try {
    logger.info('Starting full resync...');
    
    // Get all existing rows
    const rows = await googleSheets.getAllRows();
    const customerMap = new Map();
    let processedCount = 0;
    let fixedCount = 0;
    
    // Group rows by Customer ID
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, []);
      }
      customerMap.get(customerId).push(row);
    }
    
    // Process each customer
    for (const [customerId, customerRows] of customerMap) {
      try {
        // Get all payments for this customer from Stripe
        const allPayments = await getCustomerPayments(customerId);
        const allSuccessfulPayments = allPayments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        if (allSuccessfulPayments.length === 0) continue;
        
        // Calculate totals
        let totalAmountAll = 0;
        let paymentCountAll = 0;
        const paymentIdsAll = [];
        
        for (const p of allSuccessfulPayments) {
          totalAmountAll += p.amount;
          paymentCountAll++;
          paymentIdsAll.push(p.id);
        }
        
        // Delete all duplicate rows (keep only the first one)
        if (customerRows.length > 1) {
          for (let i = 1; i < customerRows.length; i++) {
            try {
              await customerRows[i].delete();
              fixedCount++;
            } catch (error) {
              logger.warn(`Could not delete duplicate row:`, error.message);
            }
          }
        }
        
        // Get fresh row data after deleting duplicates
        const freshCustomers = await googleSheets.findRows({ 'Customer ID': customerId });
        if (freshCustomers.length === 0) continue;
        
        const freshCustomer = freshCustomers[0];
        
        // Update with correct totals
        await googleSheets.updateRow(freshCustomer, {
          'Purchase ID': `purchase_${customerId}`,
          'Total Amount': (totalAmountAll / 100).toFixed(2),
          'Payment Count': paymentCountAll.toString(),
          'Payment Intent IDs': paymentIdsAll.join(', ')
        });
        
        processedCount++;
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logger.error(`Error processing customer ${customerId}:`, error);
      }
    }
    
    res.json({
      success: true,
      message: `Full resync completed! Processed ${processedCount} customers, fixed ${fixedCount} duplicates`,
      processed_customers: processedCount,
      fixed_duplicates: fixedCount
    });
    
  } catch (error) {
    logger.error('Error in full resync', error);
    res.status(500).json({
      success: false,
      message: 'Error in full resync',
      error: error.message
    });
  }
});

// Clean duplicates endpoint
app.post('/api/clean-duplicates', async (req, res) => {
  try {
    logger.info('Starting duplicate cleanup...');
    
    const rows = await googleSheets.getAllRows();
    const customerMap = new Map();
    let duplicatesRemoved = 0;
    
    // Group rows by Customer ID
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, []);
      }
      customerMap.get(customerId).push(row);
    }
    
    // Remove duplicates for each customer
    for (const [customerId, customerRows] of customerMap) {
      if (customerRows.length > 1) {
        logger.info(`Found ${customerRows.length} duplicates for customer ${customerId}`);
        
        // Keep the first row, delete the rest
        for (let i = 1; i < customerRows.length; i++) {
          try {
            await customerRows[i].delete();
            duplicatesRemoved++;
          } catch (error) {
            logger.warn(`Could not delete row ${i} for customer ${customerId}:`, error.message);
          }
        }
      }
    }
    
    res.json({
      success: true,
      message: `Duplicate cleanup completed! Removed ${duplicatesRemoved} duplicate rows`,
      total_rows: rows.length,
      duplicates_removed: duplicatesRemoved
    });
    
  } catch (error) {
    logger.error('Error cleaning duplicates', error);
    res.status(500).json({
      success: false,
      message: 'Error cleaning duplicates',
      error: error.message
    });
  }
});

// Test Telegram API directly
app.post('/api/test-telegram', async (req, res) => {
  try {
    const testMessage = `🟢 Test notification from Stripe Ops Bot!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 Payment Method: Card
💰 Amount: 9.99 USD
🏷️ Payments: 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 Email: test@example.com
📍 Location: US, New York
🔗 Link: quiz.testora.pro/iq1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Campaign Data:
• Ad: 6025_static_var01_Spectrum_Impulse_12_IQTypes_VP_En
• Adset: WEB_EN_US_Broad_testora-myiq_LC_12.10.2025_Testora_ABO_60
• Campaign: Testora_WEB_US_Core-0030-ABO_cpi_fcb_12.11.2025`;

    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text: testMessage,
        parse_mode: 'HTML'
      })
    });

    const responseText = await response.text();
    
    res.json({
      success: response.ok,
      status: response.status,
      response: responseText,
      message: response.ok ? 'Telegram test message sent successfully' : 'Telegram test failed'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error testing Telegram',
      error: error.message
    });
  }
});

// Remove test data endpoint
app.post('/api/remove-test-data', async (req, res) => {
  try {
    logger.info('Removing test data from Google Sheets...');
    
    const rows = await googleSheets.getAllRows();
    let removedCount = 0;
    
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      // Remove test data
      if (customerId === 'cus_test_123456789' || 
          email === 'test@example.com' ||
          customerId?.includes('test') ||
          email?.includes('test@')) {
        await row.delete();
        removedCount++;
        logger.info(`Removed test row: ${customerId} - ${email}`);
      }
    }
    
    res.json({
      success: true,
      message: `Test data cleanup completed! Removed ${removedCount} test rows`,
      removed_count: removedCount
    });
    
  } catch (error) {
    logger.error('Error removing test data', error);
    res.status(500).json({
      success: false,
      message: 'Error removing test data',
      error: error.message
    });
  }
});

// Test notifications endpoint (DISABLED - no test data)
app.post('/api/test-notifications', async (req, res) => {
  res.json({
    success: false,
    message: 'Test notifications disabled to prevent spam',
    timestamp: new Date().toISOString()
  });
});

// Sync payments endpoint - SIMPLIFIED AND RELIABLE
app.post('/api/sync-payments', async (req, res) => {
  try {
    logger.info('Starting payment sync...');
    
    // Get recent payments from Stripe
    const payments = await getRecentPayments(100);
    
    // Filter successful payments
    const successfulPayments = payments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (p.description && p.description.toLowerCase().includes('subscription update')) {
        return false;
      }
      return true;
    });
    
    // Get existing payment IDs from Google Sheets to avoid duplicates
    const existingRows = await googleSheets.getAllRows();
    const existingPaymentIds = new Set();
    
    for (const row of existingRows) {
      const paymentIds = row.get('Payment Intent IDs');
      if (paymentIds && paymentIds !== 'N/A') {
        const ids = paymentIds.split(', ').map(id => id.trim());
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    // Filter out already processed payments
    const newPayments = successfulPayments.filter(p => !existingPaymentIds.has(p.id));
    
    logger.info('Payment filtering', { 
      total: successfulPayments.length, 
      existing: existingPaymentIds.size,
      new: newPayments.length 
    });
    
    if (newPayments.length === 0) {
      return res.json({
        success: true,
        message: 'No new payments to process',
        total_payments: successfulPayments.length,
        processed: 0,
        new_purchases: 0
      });
    }
    
    // GROUP PAYMENTS BY CUSTOMER WITH TIME WINDOW (restored from old working version)
    const groupedPurchases = new Map();
    
    for (const payment of newPayments) {
      const customer = await getCustomer(payment.customer);
      const customerId = customer?.id;
      if (!customerId) continue;
      
      // Ищем существующую группу для этого клиента в течение 3 часов
      let foundGroup = null;
      const threeHoursInSeconds = 3 * 60 * 60; // 3 часа в секундах
      
      for (const [key, group] of groupedPurchases.entries()) {
        if (key.startsWith(customerId + '_')) {
          const timeDiff = Math.abs(payment.created - group.firstPayment.created);
          if (timeDiff <= threeHoursInSeconds) {
            foundGroup = group;
            break;
          }
        }
      }
      
      if (foundGroup) {
        // Добавляем к существующей группе
        foundGroup.payments.push(payment);
        foundGroup.totalAmount += payment.amount;
        logger.info(`Added upsell to group: ${payment.id} - $${(payment.amount / 100).toFixed(2)}`);
      } else {
        // Создаем новую группу
        const groupKey = `${customerId}_${payment.created}`;
        groupedPurchases.set(groupKey, {
          customer,
          payments: [payment],
          totalAmount: payment.amount,
          firstPayment: payment
        });
        logger.info(`Created new group: ${payment.id} - $${(payment.amount / 100).toFixed(2)}`);
      }
    }
    
    logger.info(`Grouped ${newPayments.length} payments into ${groupedPurchases.size} customer groups`);
    
    // Process each customer group
    let processedCount = 0;
    let newPurchases = 0;
    
    for (const [dateKey, group] of groupedPurchases) {
      const customer = group.customer;
      const payments = group.payments;
      const firstPayment = group.firstPayment;
      
      const customerId = customer?.id;
      if (!customerId) continue;
      
      // Check if customer already exists in Google Sheets
      const existingCustomers = await googleSheets.findRows({ 'Customer ID': customerId });
      
      if (existingCustomers.length > 0) {
        // Customer exists - update existing record with new payments
        logger.info(`Updating existing customer ${customerId} with ${payments.length} new payments`);
        
        // Get all payments for this customer from Stripe
        const allPayments = await getCustomerPayments(customerId);
        const allSuccessfulPayments = allPayments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        // Calculate totals
        let totalAmountAll = 0;
        let paymentCountAll = 0;
        const paymentIdsAll = [];
        
        for (const p of allSuccessfulPayments) {
          totalAmountAll += p.amount;
          paymentCountAll++;
          paymentIdsAll.push(p.id);
        }
        
        // Delete ALL duplicate rows first
        for (let i = 1; i < existingCustomers.length; i++) {
          try {
            await existingCustomers[i].delete();
          } catch (error) {
            logger.warn(`Could not delete duplicate row:`, error.message);
          }
        }
        
        // Get fresh row data after deleting duplicates
        const freshCustomers = await googleSheets.findRows({ 'Customer ID': customerId });
        if (freshCustomers.length === 0) {
          logger.warn('Customer row disappeared after cleanup, skipping update', { customerId });
          continue;
        }
        
        const freshCustomer = freshCustomers[0];
        
        // Update existing row with fresh data
        await googleSheets.updateRow(freshCustomer, {
          'Purchase ID': `purchase_${customerId}`,
          'Total Amount': (totalAmountAll / 100).toFixed(2),
          'Payment Count': paymentCountAll.toString(),
          'Payment Intent IDs': paymentIdsAll.join(', ')
        });
        
        // Send notification for upsell
        const currentPaymentCount = parseInt(freshCustomer.get('Payment Count') || '0');
        if (allSuccessfulPayments.length > currentPaymentCount) {
          logger.info('Sending notification for upsell', { 
            customerId, 
            currentCount: currentPaymentCount,
            newCount: allSuccessfulPayments.length 
          });
          
          const sheetData = {
            'Ad Name': freshCustomer.get('Ad Name') || 'N/A',
            'Adset Name': freshCustomer.get('Adset Name') || 'N/A',
            'Campaign Name': freshCustomer.get('Campaign Name') || 'N/A',
            'Creative Link': freshCustomer.get('Creative Link') || 'N/A',
            'Total Amount': (totalAmountAll / 100).toFixed(2),
            'Payment Count': paymentCountAll.toString(),
            'Payment Intent IDs': paymentIdsAll.join(', ')
          };
          
          const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];
          await sendNotifications(latestPayment, customer, sheetData);
        }
        
        newPurchases++;
        processedCount++;
        
      } else {
        // New customer - add to Google Sheets with grouped payments
        logger.info('Adding new customer with grouped payments', { customerId, paymentCount: payments.length });
        
        // Use first payment for formatting, but include all payments in totals
        const rowData = formatPaymentForSheets(firstPayment, customer);
        
        // Calculate totals for all payments in group
        let totalAmount = 0;
        const paymentIds = [];
        for (const p of payments) {
          totalAmount += p.amount;
          paymentIds.push(p.id);
        }
        
        rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
        rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
        rowData['Payment Count'] = payments.length.toString();
        rowData['Payment Intent IDs'] = paymentIds.join(', ');
        
        await googleSheets.addRow(rowData);
        
        // Send notification for new customer with grouped data
        const sheetData = {
          'Ad Name': rowData['Ad Name'] || 'N/A',
          'Adset Name': rowData['Adset Name'] || 'N/A',
          'Campaign Name': rowData['Campaign Name'] || 'N/A',
          'Creative Link': rowData['Creative Link'] || 'N/A',
          'Total Amount': (totalAmount / 100).toFixed(2),
          'Payment Count': payments.length.toString(),
          'Payment Intent IDs': paymentIds.join(', ')
        };
        
        await sendNotifications(firstPayment, customer, sheetData);
        
        newPurchases++;
        processedCount++;
      }
    }
    
    logger.info('Sync completed', { 
      totalPayments: newPayments.length,
      processed: processedCount,
      newPurchases: newPurchases
    });
    
    res.json({
      success: true,
      message: `Sync completed! Processed ${processedCount} purchase(s)`,
      total_payments: newPayments.length,
      processed: processedCount,
      new_purchases: newPurchases
    });
    
  } catch (error) {
    logger.error('Error in sync-payments endpoint', error);
    res.status(500).json({
      success: false,
      message: 'Sync failed',
      error: error.message
    });
  }
});

// Weekly report endpoint
app.get('/api/weekly-report', async (req, res) => {
  try {
    const report = await analytics.generateWeeklyReport();
    
    if (report) {
      await sendTextNotifications(report);
      res.json({
        success: true,
        message: 'Weekly report sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for weekly report'
      });
    }
  } catch (error) {
    logger.error('Error generating weekly report', error);
    res.status(500).json({
      success: false,
      message: 'Weekly report failed',
      error: error.message
    });
  }
});

// GEO alert endpoint
app.get('/api/geo-alert', async (req, res) => {
  try {
    const alert = await analytics.generateGeoAlert();
    
    if (alert) {
      await sendTextNotifications(alert);
      res.json({
        success: true,
        message: 'GEO alert sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for GEO alert'
      });
    }
  } catch (error) {
    logger.error('Error generating GEO alert', error);
    res.status(500).json({
      success: false,
      message: 'GEO alert failed',
      error: error.message
    });
  }
});

// Daily stats endpoint
app.get('/api/daily-stats', async (req, res) => {
  try {
    const stats = await analytics.generateDailyStats();
    
    if (stats) {
      await sendTextNotifications(stats);
      res.json({
        success: true,
        message: 'Daily stats sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for daily stats'
      });
    }
  } catch (error) {
    logger.error('Error generating daily stats', error);
    res.status(500).json({
      success: false,
      message: 'Daily stats failed',
      error: error.message
    });
  }
});

// Anomaly check endpoint
app.get('/api/anomaly-check', async (req, res) => {
  try {
    const alert = await analytics.generateAnomalyCheck();
    
    if (alert) {
      await sendTextNotifications(alert);
      res.json({
        success: true,
        message: 'Anomaly alert sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No anomalies detected'
      });
    }
  } catch (error) {
    logger.error('Error checking anomalies', error);
    res.status(500).json({
      success: false,
      message: 'Anomaly check failed',
      error: error.message
    });
  }
});

// Creative alert endpoint
app.get('/api/creative-alert', async (req, res) => {
  try {
    const alert = await analytics.generateCreativeAlert();
    
    if (alert) {
      await sendTextNotifications(alert);
      res.json({
        success: true,
        message: 'Creative alert sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for creative alert'
      });
    }
  } catch (error) {
    logger.error('Error generating creative alert', error);
    res.status(500).json({
      success: false,
      message: 'Creative alert failed',
      error: error.message
    });
  }
});

// Last purchases endpoint
app.get('/api/last-purchases', async (req, res) => {
  try {
    const payments = await getRecentPayments(10);
    
    const formattedPayments = payments.map(payment => ({
      payment_id: payment.id,
      amount: (payment.amount / 100).toFixed(2),
      currency: payment.currency,
      status: payment.status,
      created: new Date(payment.created * 1000).toISOString(),
      customer_id: payment.customer,
      customer_email: payment.receipt_email || 'N/A',
      customer_name: 'N/A',
      metadata: payment.metadata || {},
      customer_metadata: {}
    }));
    
    res.json({
      success: true,
      message: `Found ${formattedPayments.length} recent purchases`,
      count: formattedPayments.length,
      purchases: formattedPayments
    });
    
  } catch (error) {
    logger.error('Error fetching last purchases', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch last purchases',
      error: error.message
    });
  }
});

// Debug endpoint to check specific customer
// Fix Google Sheets data endpoint
app.post('/api/fix-sheets-data', async (req, res) => {
  try {
    logger.info('Starting Google Sheets data fix...');
    
    // Get all rows from Google Sheets
    const rows = await googleSheets.getAllRows();
    logger.info(`Found ${rows.length} rows to check`);
    
    let fixedCount = 0;
    
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      if (!customerId || customerId === 'N/A') continue;
      
      logger.info(`Checking customer: ${email} (${customerId})`);
      
      // Get customer data from Stripe
      const customer = await getCustomer(customerId);
      if (!customer) {
        logger.warn(`Customer not found in Stripe: ${customerId}`);
        continue;
      }
      
      // Get customer's payments to find metadata
      const payments = await getCustomerPayments(customerId);
      const successfulPayments = payments.filter(p => p.status === 'succeeded');
      
      if (successfulPayments.length === 0) {
        logger.warn(`No successful payments found for: ${customerId}`);
        continue;
      }
      
      // Get metadata from the first successful payment
      const payment = successfulPayments[0];
      const m = { ...payment.metadata, ...(customer?.metadata || {}) };
      
      // Check if we need to update any fields
      const currentAdName = row.get('Ad Name');
      const currentAdsetName = row.get('Adset Name');
      const currentCampaignName = row.get('Campaign Name');
      const currentCreativeLink = row.get('Creative Link');
      
      const newAdName = m.ad_name || m['Ad Name'] || 'N/A';
      const newAdsetName = m.adset_name || m['Adset Name'] || 'N/A';
      const newCampaignName = m.campaign_name || m['Campaign Name'] || m.utm_campaign || 'N/A';
      const newCreativeLink = m.creative_link || m['Creative Link'] || 'N/A';
      
      // Check if any field needs updating
      const needsUpdate = 
        (currentAdName === 'N/A' && newAdName !== 'N/A') ||
        (currentAdsetName === 'N/A' && newAdsetName !== 'N/A') ||
        (currentCampaignName === 'N/A' && newCampaignName !== 'N/A') ||
        (currentCreativeLink === 'N/A' && newCreativeLink !== 'N/A');
      
      if (needsUpdate) {
        logger.info(`Updating data for: ${email}`, {
          adName: `${currentAdName} → ${newAdName}`,
          adsetName: `${currentAdsetName} → ${newAdsetName}`,
          campaignName: `${currentCampaignName} → ${newCampaignName}`,
          creativeLink: `${currentCreativeLink} → ${newCreativeLink}`
        });
        
        await googleSheets.updateRow(row, {
          'Ad Name': newAdName,
          'Adset Name': newAdsetName,
          'Campaign Name': newCampaignName,
          'Creative Link': newCreativeLink
        });
        
        fixedCount++;
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info(`Fix completed! Updated ${fixedCount} rows`);
    
    res.json({
      success: true,
      message: `Google Sheets data fix completed!`,
      total_rows: rows.length,
      fixed_rows: fixedCount
    });
    
  } catch (error) {
    logger.error('Error fixing Google Sheets data', error);
    res.status(500).json({
      success: false,
      message: 'Error fixing Google Sheets data',
      error: error.message
    });
  }
});

app.get('/api/debug-customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    // Get customer from Stripe
    const customer = await getCustomer(customerId);
    const payments = await getCustomerPayments(customerId);
    
    // Get customer from Google Sheets
    const sheetRows = await googleSheets.findRows({ 'Customer ID': customerId });
    
    res.json({
      success: true,
      customer: {
        id: customer?.id,
        email: customer?.email,
        name: customer?.name
      },
      stripePayments: payments.map(p => ({
        id: p.id,
        amount: (p.amount / 100).toFixed(2),
        currency: p.currency,
        status: p.status,
        description: p.description,
        created: new Date(p.created * 1000).toISOString()
      })),
      googleSheetsRows: sheetRows.map(row => ({
        purchaseId: row.get('Purchase ID'),
        totalAmount: row.get('Total Amount'),
        paymentCount: row.get('Payment Count'),
        paymentIds: row.get('Payment Intent IDs')
      }))
    });
    
  } catch (error) {
    logger.error('Error in debug-customer endpoint', error);
    res.status(500).json({
      success: false,
      message: 'Debug failed',
      error: error.message
    });
  }
});

// Debug endpoint for GEO alert data
app.get('/api/debug-geo', async (req, res) => {
  try {
    const rows = await googleSheets.getAllRows();
    
    // Get today's date
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStart = new Date(utcPlus1);
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(utcPlus1);
    todayEnd.setHours(23, 59, 59, 999);
    
    // Filter today's purchases
    const todayPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      const purchaseDate = new Date(createdLocal);
      return purchaseDate >= todayStart && purchaseDate <= todayEnd;
    });
    
    // Analyze GEO data
    const geoStats = new Map();
    
    for (const purchase of todayPurchases) {
      const geo = purchase.get('GEO') || '';
      const country = geo.split(',')[0].trim();
      if (country) {
        geoStats.set(country, (geoStats.get(country) || 0) + 1);
      }
    }
    
    // Top countries
    const topCountries = Array.from(geoStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    res.json({
      success: true,
      debug: {
        totalRows: rows.length,
        todayStart: todayStart.toISOString(),
        todayEnd: todayEnd.toISOString(),
        todayPurchases: todayPurchases.length,
        topCountries: topCountries,
        sampleDates: todayPurchases.slice(0, 5).map(p => ({
          date: p.get('Created Local (UTC+1)'),
          geo: p.get('GEO'),
          amount: p.get('Total Amount')
        }))
      }
    });
    
  } catch (error) {
    logger.error('Error in debug-geo endpoint', error);
    res.status(500).json({
      success: false,
      message: 'Debug failed',
      error: error.message
    });
  }
});

// Error handlers
app.use(errorHandler);
app.use(notFoundHandler);

// Start server
app.listen(ENV.PORT, () => {
  logger.info(`Server listening on port ${ENV.PORT}`);
  console.log('🚀 Refactored Stripe Ops API is running!');
  console.log(`📊 Modular architecture with ${Object.keys(ENV).length} environment variables`);
  console.log(`🛡️ Rate limiting: ${getRateLimitStats().maxRequests} requests per ${getRateLimitStats().window / 1000 / 60} minutes`);
  console.log(`💾 Cache system: Google Sheets caching enabled`);
  console.log(`📝 Structured logging: JSON format with timestamps`);
  
  // Load existing purchases on startup
  setTimeout(async () => {
    try {
      console.log('📋 Loading existing purchases...');
      await loadExistingPurchases();
      console.log(`✅ Loaded ${existingPurchases.size} existing purchases into memory`);
    } catch (error) {
      console.error('❌ Failed to load existing purchases:', error.message);
    }
  }, 5000); // Load after 5 seconds

  // Start automatic synchronization
  if (!ENV.AUTO_SYNC_DISABLED) {
    console.log('🔄 Starting automatic sync every 5 minutes...');
    
    // First sync after 30 seconds
    setTimeout(async () => {
      try {
        console.log('🚀 Running initial sync...');
        const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        console.log(`✅ Initial sync completed: ${result.total_payments || 0} payments processed`);
      } catch (error) {
        console.error('❌ Initial sync failed:', error.message);
      }
    }, 30000);
    
    // Then every 5 minutes
    setInterval(async () => {
      try {
        console.log('🔄 Running scheduled sync...');
        const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        console.log(`✅ Scheduled sync completed: ${result.total_payments || 0} payments processed`);
      } catch (error) {
        console.error('❌ Scheduled sync failed:', error.message);
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // GEO Alert every hour
    const scheduleGeoAlert = () => {
      console.log('🌍 Starting hourly GEO alerts...');
      
      // First alert after 1 minute
      setTimeout(async () => {
        try {
          console.log('🌍 Running first GEO alert...');
          const response = await fetch(`http://localhost:${ENV.PORT}/api/geo-alert`, {
            method: 'GET'
          });
          const result = await response.json();
          console.log(`✅ GEO alert completed: ${result.message}`);
        } catch (error) {
          console.error('❌ GEO alert failed:', error.message);
        }
      }, 60000); // 1 minute
      
      // Then every hour
      setInterval(async () => {
        try {
          console.log('🌍 Running hourly GEO alert...');
          const response = await fetch(`http://localhost:${ENV.PORT}/api/geo-alert`, {
            method: 'GET'
          });
          const result = await response.json();
          console.log(`✅ GEO alert completed: ${result.message}`);
        } catch (error) {
          console.error('❌ GEO alert failed:', error.message);
        }
      }, 60 * 60 * 1000); // 1 hour
    };
    
    // Weekly Report every Monday at 9 AM UTC+1 (8 AM UTC)
    const scheduleWeeklyReport = () => {
      const now = new Date();
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7); // Next Monday
      nextMonday.setHours(8, 0, 0, 0); // 9 AM UTC+1 = 8 AM UTC
      
      const timeUntilMonday = nextMonday.getTime() - now.getTime();
      
      setTimeout(async () => {
        try {
          console.log('📊 Running weekly report...');
          const response = await fetch(`http://localhost:${ENV.PORT}/api/weekly-report`, {
            method: 'GET'
          });
          const result = await response.json();
          console.log(`✅ Weekly report completed: ${result.message}`);
        } catch (error) {
          console.error('❌ Weekly report failed:', error.message);
        }
      }, timeUntilMonday);
      
      console.log(`📊 Weekly Report scheduled for: ${nextMonday.toLocaleString()}`);
      
      // Schedule weekly interval after first run
      setTimeout(() => {
        setInterval(async () => {
          const now = new Date();
          const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
          const weekKey = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
          
          if (!sentAlerts.weeklyReport.has(weekKey)) {
            try {
              console.log('📊 Running weekly report...');
              const response = await fetch(`http://localhost:${ENV.PORT}/api/weekly-report`, {
                method: 'GET'
              });
              const result = await response.json();
              console.log(`✅ Weekly report completed: ${result.message}`);
              sentAlerts.weeklyReport.add(weekKey);
            } catch (error) {
              console.error('❌ Weekly report failed:', error.message);
            }
          }
        }, 7 * 24 * 60 * 60 * 1000); // 7 days
      }, timeUntilMonday);
    };
    
    // Daily Stats every morning at 7:00 UTC+1
    const scheduleDailyStats = () => {
      console.log('📊 Starting daily stats alerts...');
      
      // Check every 2 minutes for 7:00 UTC+1
      setInterval(async () => {
        const now = new Date();
        const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
        const hour = utcPlus1.getUTCHours();
        const minute = utcPlus1.getUTCMinutes();
        
        // Check for 7:00 UTC+1 (with ±2 minutes tolerance)
        if (hour === 7 && minute >= 0 && minute <= 2) {
          const today = utcPlus1.toISOString().split('T')[0];
          if (!sentAlerts.dailyStats.has(today)) {
            try {
              console.log('📊 Running daily stats alert...');
              const response = await fetch(`http://localhost:${ENV.PORT}/api/daily-stats`, {
                method: 'GET'
              });
              const result = await response.json();
              console.log(`✅ Daily stats completed: ${result.message}`);
              sentAlerts.dailyStats.add(today);
            } catch (error) {
              console.error('❌ Daily stats failed:', error.message);
            }
          }
        }
      }, 2 * 60 * 1000); // 2 minutes
    };
    
    // Creative Alert at 10:00 and 22:00 UTC+1
    const scheduleCreativeAlert = () => {
      console.log('🎨 Starting creative alerts...');
      
      // Check every 2 minutes for 10:00 and 22:00 UTC+1
      setInterval(async () => {
        const now = new Date();
        const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
        const hour = utcPlus1.getUTCHours();
        const minute = utcPlus1.getUTCMinutes();
        
        // Check for 10:00 and 22:00 UTC+1 (with ±2 minutes tolerance)
        if ((hour === 10 && minute >= 0 && minute <= 2) || 
            (hour === 22 && minute >= 0 && minute <= 2)) {
          const today = utcPlus1.toISOString().split('T')[0];
          const alertKey = `${today}_${hour}`;
          if (!sentAlerts.creativeAlert.has(alertKey)) {
            try {
              console.log('🎨 Running creative alert...');
              const response = await fetch(`http://localhost:${ENV.PORT}/api/creative-alert`, {
                method: 'GET'
              });
              const result = await response.json();
              console.log(`✅ Creative alert completed: ${result.message}`);
              sentAlerts.creativeAlert.add(alertKey);
            } catch (error) {
              console.error('❌ Creative alert failed:', error.message);
            }
          }
        }
      }, 2 * 60 * 1000); // 2 minutes
    };
    
    // Start all alert scheduling
    scheduleGeoAlert();
    scheduleWeeklyReport();
    scheduleDailyStats();
    scheduleCreativeAlert();
    
    console.log('🤖 AUTOMATIC SYSTEM ENABLED:');
    console.log('   ✅ Checks Stripe every 5 minutes');
    console.log('   ✅ Adds new purchases to Google Sheets');
    console.log('   ✅ Sends notifications to Telegram and Slack');
    console.log('   ✅ GEO alerts every hour');
    console.log('   ✅ Daily stats every morning at 7:00 UTC+1');
    console.log('   ✅ Creative alerts at 10:00 and 22:00 UTC+1');
    console.log('   ✅ Weekly reports every Monday at 9 AM UTC+1');
    console.log('   ✅ Works WITHOUT manual intervention');
  } else {
    console.log('⏸️ Automatic sync is DISABLED (AUTO_SYNC_DISABLED=true)');
  }
});

export default app;
