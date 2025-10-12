// Refactored Stripe Ops API - Modular Architecture
import express from 'express';
import { ENV } from './src/config/env.js';
import { logger } from './src/utils/logging.js';
import { rateLimit, getRateLimitStats } from './src/middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import { getCacheStats } from './src/utils/cache.js';
import { stripe, getRecentPayments, getCustomerPayments, getCustomer } from './src/services/stripe.js';
import { sendNotifications } from './src/services/notifications.js';
import googleSheets from './src/services/googleSheets.js';
import { analytics } from './src/services/analytics.js';
import { formatPaymentForSheets, formatTelegramNotification } from './src/utils/formatting.js';
import { validateEmail, validateCustomerId, validatePaymentId, validateAmount } from './src/utils/validation.js';

const app = express();

// Simple storage for existing purchases
const existingPurchases = new Set();
const processedPurchaseIds = new Set();

// Middleware
app.use(express.json());
app.use('/api', rateLimit);

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  message: 'Stripe Ops API is running!',
  status: 'ok',
  timestamp: new Date().toISOString(),
  endpoints: ['/api/test', '/api/sync-payments', '/api/geo-alert', '/api/creative-alert', '/api/daily-stats', '/api/weekly-report', '/api/anomaly-check', '/api/memory-status', '/api/check-duplicates', '/health', '/webhook/stripe']
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

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString()
  });
});

// Sync payments endpoint
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
    
    logger.info('Found successful payments', { count: successfulPayments.length });
    
    // Initialize counters
    let processedCount = 0;
    let newPurchases = 0;
    
    // SIMPLE LOGIC: Group payments by customer only (no time window)
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      const customer = await getCustomer(payment.customer);
      const customerId = customer?.id;
      
      if (!customerId) continue;
      
      // Check if customer already exists in Google Sheets
      const existingCustomers = await googleSheets.findRows({ 'Customer ID': customerId });
      
      if (existingCustomers.length > 0) {
        // Customer exists - this is an upsell, update existing record
        const existingCustomer = existingCustomers[0];
        
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
        
        // Delete duplicate rows first (keep only the first one)
        if (existingCustomers.length > 1) {
          for (let i = 1; i < existingCustomers.length; i++) {
            await existingCustomers[i].delete();
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
          'Purchase ID': `purchase_${customerId}_${allSuccessfulPayments[0].created}`,
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
          // Get data from Google Sheets row for notification
          const sheetData = {
            'Ad Name': freshCustomer.get('Ad Name') || 'N/A',
            'Adset Name': freshCustomer.get('Adset Name') || 'N/A',
            'Campaign Name': freshCustomer.get('Campaign Name') || 'N/A',
            'Creative Link': freshCustomer.get('Creative Link') || 'N/A'
          };
          await sendNotifications(payment, customer, sheetData);
        }
        
        newPurchases++;
        processedCount++;
        
      } else {
        // New customer - add to group for batch processing
        if (groupedPurchases.has(customerId)) {
          // Add to existing group
          const group = groupedPurchases.get(customerId);
          group.payments.push(payment);
          group.totalAmount += payment.amount;
        } else {
          // Create new group
          groupedPurchases.set(customerId, {
            customer,
            payments: [payment],
            totalAmount: payment.amount,
            firstPayment: payment
          });
        }
      }
    }
    
    logger.info('Grouped payments by customer', { 
      totalPayments: successfulPayments.length,
      uniqueCustomers: groupedPurchases.size 
    });
    
    // Process only new customers (existing ones already processed above)
    for (const [customerId, group] of groupedPurchases) {
      try {
        const customer = group.customer;
        const payments = group.payments;
        const totalAmount = group.totalAmount;
        const firstPayment = group.firstPayment;
        
        // Add new customer to Google Sheets
        logger.info('Adding new customer', { 
          customerId, 
          paymentsCount: payments.length 
        });
        
        const rowData = formatPaymentForSheets(firstPayment, customer);
        rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
        rowData['Payment Count'] = payments.length.toString();
        rowData['Payment Intent IDs'] = payments.map(p => p.id).join(', ');
        
        await googleSheets.addRow(rowData);
        
        // Send notification for the first payment with sheet data
        const sheetData = {
          'Ad Name': rowData['Ad Name'] || 'N/A',
          'Adset Name': rowData['Adset Name'] || 'N/A',
          'Campaign Name': rowData['Campaign Name'] || 'N/A',
          'Creative Link': rowData['Creative Link'] || 'N/A'
        };
        await sendNotifications(firstPayment, customer, sheetData);
        
        newPurchases++;
        processedCount++;
        
      } catch (error) {
        logger.error('Error processing new customer', error, { customerId });
      }
    }
    
    res.json({
      success: true,
      message: `Sync completed! Processed ${processedCount} purchase(s)`,
      total_payments: successfulPayments.length,
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
      await sendNotifications(report);
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
      await sendNotifications(alert);
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

// Creative alert endpoint
app.get('/api/creative-alert', async (req, res) => {
  try {
    const alert = await analytics.generateCreativeAlert();
    
    if (alert) {
      await sendNotifications(alert);
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
    const rows = await googleSheets.getRows();
    
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
    
    console.log('🤖 AUTOMATIC SYNC ENABLED:');
    console.log('   ✅ Checks Stripe every 5 minutes');
    console.log('   ✅ Adds new purchases to Google Sheets');
    console.log('   ✅ Sends notifications to Telegram and Slack');
    console.log('   ✅ Works WITHOUT manual intervention');
  } else {
    console.log('⏸️ Automatic sync is DISABLED (AUTO_SYNC_DISABLED=true)');
  }
});

export default app;
