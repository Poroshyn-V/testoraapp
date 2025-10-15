// Refactored Stripe Ops API - Modular Architecture
import express from 'express';
import cors from 'cors';
import { ENV } from './src/config/env.js';
import { logger } from './src/utils/logging.js';
import { rateLimit, getRateLimitStats } from './src/middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import { getCacheStats } from './src/utils/cache.js';
import { stripe, getRecentPayments, getCustomerPayments, getCustomer } from './src/services/stripe.js';
import { sendNotifications, sendTextNotifications, sendPurchaseNotification } from './src/services/notifications.js';
import googleSheets from './src/services/googleSheets.js';
import { analytics } from './src/services/analytics.js';
import { smartAlerts } from './src/services/smartAlerts.js';
import { alertConfig } from './src/config/alertConfig.js';
import { alertCooldown } from './src/utils/alertCooldown.js';
import { performanceMonitor } from './src/services/performanceMonitor.js';
import { notificationQueue } from './src/services/notificationQueue.js';
import { campaignAnalyzer } from './src/services/campaignAnalyzer.js';
import { duplicateChecker } from './src/services/duplicateChecker.js';
import { formatPaymentForSheets, formatTelegramNotification } from './src/utils/formatting.js';
import healthRoutes from './src/routes/health.js';

// Глобальные переменные для locks
const syncLock = new Map(); // customerId -> timestamp

function acquireCustomerLock(customerId) {
  const now = Date.now();
  const existingLock = syncLock.get(customerId);
  
  if (existingLock && (now - existingLock) < 5 * 60 * 1000) {
    return false;
  }
  
  syncLock.set(customerId, now);
  return true;
}

function releaseCustomerLock(customerId) {
  syncLock.delete(customerId);
}

// Периодическая очистка старых locks
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 10 * 60 * 1000;
  
  for (const [customerId, timestamp] of syncLock.entries()) {
    if (now - timestamp > staleThreshold) {
      logger.warn(`Removing stale lock for customer ${customerId}`);
      syncLock.delete(customerId);
    }
  }
}, 10 * 60 * 1000);
import { validateEmail, validateCustomerId, validatePaymentId, validateAmount } from './src/utils/validation.js';
import { purchaseCache } from './src/services/purchaseCache.js';
import { metrics } from './src/services/metrics.js';
import { clearSheetsCache } from './src/utils/cache.js';
import { distributedLock } from './src/services/distributedLock.js';

const app = express();

// Alert history storage
const alertHistory = [];
const MAX_HISTORY = 100;

// Function to save alert history
function saveAlertHistory(alertType, status, message, metadata = {}) {
  const historyEntry = {
    type: alertType,
    status: status, // 'sent', 'failed', 'skipped'
    message: message,
    metadata: metadata,
    timestamp: new Date().toISOString()
  };
  
  alertHistory.unshift(historyEntry);
  
  // Limit history size
  if (alertHistory.length > MAX_HISTORY) {
    alertHistory.pop();
  }
  
  metrics.increment('alert_history_recorded', 1, { type: alertType, status });
}

// Purchase cache is now managed by purchaseCache service

// Interval variables for graceful shutdown
let syncInterval = null;
let geoAlertInterval = null;
let dailyStatsInterval = null;
let creativeAlertInterval = null;
let weeklyReportInterval = null;
let campaignAnalysisInterval = null;
let campaignReportInterval = null;
let alertCleanupInterval = null;

// Emergency stop flag
let emergencyStop = false;

// Helper function for VIP purchase alerts
async function sendVipPurchaseAlert(payment, customer, sheetData) {
  const amount = parseFloat(sheetData['Total Amount'] || 0);
  
  if (amount >= alertConfig.vipPurchaseThreshold) {
    const alertType = `vip_${customer.id}`;
    
    if (alertCooldown.canSend(alertType, alertConfig.cooldownMinutes.vip)) {
      const vipAlert = `💎 VIP PURCHASE ALERT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Amount: $${amount.toFixed(2)}
👤 Customer: ${customer.email || 'N/A'}
🆔 ID: ${customer.id}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 High-value customer detected!`;
      
      // Add VIP alert to notification queue
      await notificationQueue.add({
        type: 'vip_purchase',
        channel: 'telegram',
        message: vipAlert,
        metadata: { 
          amount, 
          customerId: customer.id,
          customerEmail: customer.email 
        }
      });
      
      alertCooldown.markSent(alertType);
      saveAlertHistory('vip_purchase', 'sent', vipAlert, { 
        amount, 
        customerId: customer.id,
        customerEmail: customer.email 
      });
    }
  }
}

// Sync protection flag to prevent overlapping synchronizations
let isSyncing = false;

// Alert tracking to prevent duplicate sends
const sentAlerts = {
  dailyStats: new Set(),
  creativeAlert: new Set(),
  weeklyReport: new Set(),
  geoAlert: new Set(),
  campaignAnalysis: new Set(),
  duplicateCheck: new Set()
};

// Clean old alert records to prevent memory leaks
function cleanOldAlerts() {
  const now = new Date();
  const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
  const today = utcPlus1.toISOString().split('T')[0];
  const yesterday = new Date(utcPlus1);
  yesterday.setDate(utcPlus1.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  logger.info('🧹 Cleaning old alert records...', {
    before: {
      dailyStats: sentAlerts.dailyStats.size,
      creativeAlert: sentAlerts.creativeAlert.size,
      weeklyReport: sentAlerts.weeklyReport.size,
      campaignAnalysis: sentAlerts.campaignAnalysis.size,
      duplicateCheck: sentAlerts.duplicateCheck.size
    },
    timestamp: new Date().toISOString()
  });
  
  // Clean daily stats - keep only today and yesterday
  const oldDailyStats = sentAlerts.dailyStats.size;
  sentAlerts.dailyStats = new Set(
    Array.from(sentAlerts.dailyStats).filter(date => 
      date >= yesterdayStr
    )
  );
  
  // Clean creative alerts - keep only today and yesterday
  const oldCreativeAlerts = sentAlerts.creativeAlert.size;
  sentAlerts.creativeAlert = new Set(
    Array.from(sentAlerts.creativeAlert).filter(alertKey => {
      const date = alertKey.split('_')[0];
      return date >= yesterdayStr;
    })
  );
  
  // Clean weekly reports - keep only last 2 weeks
  const twoWeeksAgo = new Date(utcPlus1);
  twoWeeksAgo.setDate(utcPlus1.getDate() - 14);
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
  
  const oldWeeklyReports = sentAlerts.weeklyReport.size;
  sentAlerts.weeklyReport = new Set(
    Array.from(sentAlerts.weeklyReport).filter(date => 
      date >= twoWeeksAgoStr
    )
  );
  
  // Clean campaign analysis - keep only today and yesterday
  const oldCampaignAnalysis = sentAlerts.campaignAnalysis.size;
  sentAlerts.campaignAnalysis = new Set(
    Array.from(sentAlerts.campaignAnalysis).filter(date => 
      date >= yesterdayStr
    )
  );
  
  // Clean duplicate check - keep only today and yesterday
  const oldDuplicateCheck = sentAlerts.duplicateCheck.size;
  sentAlerts.duplicateCheck = new Set(
    Array.from(sentAlerts.duplicateCheck).filter(date => 
      date >= yesterdayStr
    )
  );
  
  const cleaned = {
    dailyStats: oldDailyStats - sentAlerts.dailyStats.size,
    creativeAlert: oldCreativeAlerts - sentAlerts.creativeAlert.size,
    weeklyReport: oldWeeklyReports - sentAlerts.weeklyReport.size,
    campaignAnalysis: oldCampaignAnalysis - sentAlerts.campaignAnalysis.size,
    duplicateCheck: oldDuplicateCheck - sentAlerts.duplicateCheck.size
  };
  
  logger.info('✅ Alert records cleaned', {
    after: {
      dailyStats: sentAlerts.dailyStats.size,
      creativeAlert: sentAlerts.creativeAlert.size,
      weeklyReport: sentAlerts.weeklyReport.size,
      campaignAnalysis: sentAlerts.campaignAnalysis.size,
      duplicateCheck: sentAlerts.duplicateCheck.size
    },
    cleaned: cleaned,
    totalCleaned: cleaned.dailyStats + cleaned.creativeAlert + cleaned.weeklyReport + cleaned.campaignAnalysis + cleaned.duplicateCheck,
    timestamp: new Date().toISOString()
  });
}

// Retry logic for external APIs
async function fetchWithRetry(fn, retries = 3, delay = 1000) {
  const timerId = metrics.startTimer('api_call', { operation: fn.name || 'external' });
  const startTime = Date.now();
  const operationName = fn.name || 'external API call';
  
  for (let i = 0; i < retries; i++) {
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      
      metrics.endTimer(timerId);
      metrics.increment('api_call', 1, { operation: operationName, success: true });
      metrics.histogram('api_response_time', duration, { operation: operationName });
      
      if (i > 0) {
        metrics.increment('api_retry', 1, { operation: operationName, retries: i });
        logger.info(`✅ ${operationName} succeeded after ${i} retries`, {
          retries: i,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      if (i === retries - 1) {
        const duration = Date.now() - startTime;
        metrics.endTimer(timerId);
        metrics.increment('api_error', 1, { operation: operationName, error: error.message });
        metrics.histogram('api_response_time', duration, { operation: operationName, error: true });
        
        logger.error(`❌ ${operationName} failed after ${retries} attempts`, {
          error: error.message,
          retries: retries,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
      
      const retryDelay = delay * (i + 1);
      metrics.increment('api_retry_attempt', 1, { operation: operationName, attempt: i + 1 });
      
      logger.warn(`Retry ${i + 1}/${retries} after error:`, {
        operation: operationName,
        error: error.message,
        retryDelay: `${retryDelay}ms`,
        timestamp: new Date().toISOString()
      });
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Load existing purchases from Google Sheets into memory
async function loadExistingPurchases() {
  const timerId = metrics.startTimer('load_existing_purchases');
  const startTime = Date.now();
  try {
    metrics.increment('load_existing_started');
    logger.info('🔄 Loading existing purchases...', {
      timestamp: new Date().toISOString(),
      startTime: startTime
    });
    
    await purchaseCache.reload();
    
    // Also refresh duplicate checker cache
    await duplicateChecker.refreshCache();
    
    const duration = Date.now() - startTime;
    metrics.endTimer(timerId);
    metrics.increment('load_existing_success');
    metrics.gauge('existing_purchases_count', purchaseCache.size());
    metrics.histogram('load_existing_duration', duration);
    
    // Record performance metrics
    performanceMonitor.recordOperation('loadExistingPurchases', duration, {
      count: purchaseCache.size(),
      success: true
    });
    
    logger.info('✅ Existing purchases loaded successfully', {
      count: purchaseCache.size(),
      duration: `${duration}ms`,
      durationSeconds: Math.round(duration / 1000),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.endTimer(timerId);
    metrics.increment('load_existing_failed');
    metrics.histogram('load_existing_duration', duration);
    
    // Record performance metrics for failed operation
    performanceMonitor.recordOperation('loadExistingPurchases', duration, {
      success: false,
      error: error.message
    });
    
    logger.error('❌ Ошибка загрузки существующих покупок:', {
      error: error.message,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  }
}

// Protected sync function to prevent overlapping synchronizations
async function runSync() {
  const timerId = metrics.startTimer('sync_operation');
  const startTime = Date.now();
  let lockId = null;
  
  if (emergencyStop) {
    metrics.increment('sync_skipped', 1, { reason: 'emergency_stop' });
    logger.warn('⛔ Sync blocked by emergency stop', {
      timestamp: new Date().toISOString()
    });
    return { success: false, message: 'Emergency stop active' };
  }
  
  // 🔒 Используем распределенную блокировку для sync
  const SYNC_TIMEOUT = 5 * 60 * 1000; // 5 минут максимум
  const syncTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Sync timeout exceeded')), SYNC_TIMEOUT);
  });

  logger.info('🔒 Attempting to acquire sync lock...', {
    timestamp: new Date().toISOString(),
    isSyncing: isSyncing,
    emergencyStop: emergencyStop
  });

  try {
    lockId = await Promise.race([
      distributedLock.acquire('sync_operation', 10, 200),
      syncTimeoutPromise
    ]);
    logger.info('✅ Sync lock acquired successfully', {
      lockId: lockId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    if (error.message === 'Sync timeout exceeded') {
      logger.error('⏰ Sync acquisition timeout - forcing cleanup');
      distributedLock.forceRelease('sync_operation');
    }
    metrics.increment('sync_skipped', 1, { reason: 'lock_failed' });
    logger.warn('⚠️ Failed to acquire sync lock, skipping this cycle...', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    return { success: false, message: 'Failed to acquire sync lock' };
  }
  
  if (isSyncing) {
    metrics.increment('sync_skipped', 1, { reason: 'already_in_progress' });
    logger.warn('⚠️ Sync already in progress, skipping this cycle...', {
      timestamp: new Date().toISOString(),
      duration: `${Date.now() - startTime}ms`
    });
    distributedLock.release('sync_operation', lockId);
    return { success: false, message: 'Sync already in progress' };
  }
  
  isSyncing = true;
  try {
    metrics.increment('sync_started');
    logger.info('🔄 Starting protected sync...', {
      timestamp: new Date().toISOString(),
      startTime: startTime
    });
    
    // Call the actual sync logic directly (not via HTTP to avoid localhost issues on Railway)
    const result = await performSyncLogic();
    const duration = Date.now() - startTime;
    
    metrics.endTimer(timerId);
    metrics.increment('sync_success');
    metrics.histogram('sync_duration', duration);
    
    logger.info('✅ Protected sync completed:', {
      ...result,
      duration: `${duration}ms`,
      durationSeconds: Math.round(duration / 1000),
      timestamp: new Date().toISOString()
    });
    
    // Записываем время последней синхронизации
    global.lastSyncTime = Date.now();
    
    // Record performance metrics
    const syncDuration = Date.now() - startTime;
    performanceMonitor.recordOperation('sync', syncDuration, {
      processed: result.processed || 0,
      failed: result.failed || 0,
      success: true
    });
    
    return result;
  } catch (error) {
    const errorDuration = Date.now() - startTime;
    metrics.endTimer(timerId);
    metrics.increment('sync_failed');
    metrics.histogram('sync_duration', errorDuration);
    
    // Record performance metrics for failed sync
    performanceMonitor.recordOperation('sync', errorDuration, {
      success: false,
      error: error.message
    });
    
    logger.error('❌ Protected sync failed:', {
      error: error.message,
      duration: `${errorDuration}ms`,
      timestamp: new Date().toISOString()
    });
    return { success: false, message: 'Sync failed', error: error.message };
  } finally {
    isSyncing = false;
    
    // 🔓 Освобождаем распределенную блокировку
    if (lockId) {
      distributedLock.release('sync_operation', lockId);
    }
    
    const totalDuration = Date.now() - startTime;
    logger.info('🔓 Sync lock released', {
      totalDuration: `${totalDuration}ms`,
      timestamp: new Date().toISOString()
    });
  }
}

// Middleware
app.use(express.json());
app.use(cors());
app.use('/api', rateLimit);

// Use route modules
app.use('/', healthRoutes);

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  message: 'Stripe Ops API is running!',
  status: 'ok',
  timestamp: new Date().toISOString(),
  endpoints: [
    '/api/test',
    '/api/sync-payments',
    '/api/geo-alert',
    '/api/creative-alert',
    '/api/daily-stats',
    '/api/weekly-report',
    '/api/anomaly-check',
    '/api/smart-alerts',
    '/api/memory-status',
    '/api/cache-stats',
    '/api/sync-status',
    '/api/clean-alerts',
    '/api/load-existing',
    '/api/check-duplicates',
    '/api/fix-duplicates',
    '/api/campaigns/analyze',
    '/api/campaigns/:campaignName/analyze',
    '/api/campaigns/report',
    '/api/campaigns/list',
    '/api/test-batch-operations',
    '/api/duplicate-checker/stats',
    '/api/duplicate-checker/refresh',
    '/api/duplicate-checker/customer/:customerId',
    '/api/duplicate-checker/payment-intent/:paymentIntentId',
    '/api/duplicates/cache-stats',
    '/api/duplicates/refresh-cache',
    '/api/duplicates/find',
    '/api/duplicates/find-by-customer',
    '/api/duplicates/fix-customer/:customerId',
    '/api/sync-locks',
    '/api/metrics',
    '/api/metrics/summary',
    '/api/metrics/reset',
    '/api/alerts/history',
    '/api/alerts/dashboard',
    '/api/alerts/cooldown-stats',
    '/api/performance-stats',
    '/api/status',
    '/api/emergency-stop',
    '/api/emergency-resume',
    '/api/force-notifications',
    '/api/export-all-purchases',
    '/api/export-today-purchases',
    '/api/notification-queue/stats',
    '/api/notification-queue/clear',
    '/api/notification-queue/pause',
    '/api/notification-queue/resume',
    '/api/distributed-locks/stats',
    '/api/distributed-locks/cleanup',
    '/api/distributed-locks/active',
    '/api/distributed-locks/release/:lockKey',
    '/api/sync-diagnostics',
    '/api/force-unlock-sync',
    '/api/force-sync',
    '/api/restart-auto-sync',
    '/api/intervals-status',
    '/api/test-notification',
    '/api/check-recent-payments',
    '/auto-sync',
    '/ping',
    '/health'
  ]
}));

// Health check
app.get('/health', async (_req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    // Test external services
    const serviceChecks = {
      stripe: await checkStripeConnection(),
      googleSheets: await checkGoogleSheetsConnection(),
      telegram: await checkTelegramConnection()
    };
    
    const allServicesHealthy = Object.values(serviceChecks).every(check => check.status === 'healthy');
    
    const healthStatus = {
      status: allServicesHealthy ? 'healthy' : 'degraded',
      emergencyStop: emergencyStop,
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
      },
      memory: {
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
      },
      services: serviceChecks,
      intervals: {
        sync: syncInterval ? 'active' : 'inactive',
        geoAlert: geoAlertInterval ? 'active' : 'inactive',
        dailyStats: dailyStatsInterval ? 'active' : 'inactive',
        creativeAlert: creativeAlertInterval ? 'active' : 'inactive',
        weeklyReport: weeklyReportInterval ? 'active' : 'inactive',
        campaignAnalysis: campaignAnalysisInterval ? 'active' : 'inactive',
        campaignReport: campaignReportInterval ? 'active' : 'inactive',
        alertCleanup: alertCleanupInterval ? 'active' : 'inactive'
      },
      cache: {
        purchases: purchaseCache.size(),
        processedPurchases: purchaseCache.processedPurchaseIds.size,
        duplicateChecker: duplicateChecker.getStats()
      },
      locks: {
        distributed: distributedLock.getStats()
      },
      alerts: {
        cooldowns: alertCooldown.getStats(),
        historySize: alertHistory.length
      },
      performance: performanceMonitor.getStats(),
      metrics: metrics.getSummary(),
      notificationQueue: notificationQueue.getStats()
    };
    
    const statusCode = allServicesHealthy ? 200 : 503;
    res.status(statusCode).json(healthStatus);
    
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions for health checks
async function checkStripeConnection() {
  try {
    const startTime = Date.now();
    await stripe.customers.list({ limit: 1 });
    return {
      status: 'healthy',
      responseTime: `${Date.now() - startTime}ms`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

async function checkGoogleSheetsConnection() {
  try {
    const startTime = Date.now();
    await googleSheets.getAllRows(); // cached
    return {
      status: 'healthy',
      responseTime: `${Date.now() - startTime}ms`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

async function checkTelegramConnection() {
  try {
    const startTime = Date.now();
    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/getMe`);
    const isHealthy = response.ok;
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      responseTime: `${Date.now() - startTime}ms`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

// Endpoint для внешних систем мониторинга (UptimeRobot, Pingdom)
app.get('/api/status', async (_req, res) => {
  const isHealthy = !isSyncing && syncInterval && purchaseCache.size() > 0;
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    sync: {
      active: !isSyncing,
      scheduled: !!syncInterval
    },
    cache: {
      loaded: purchaseCache.size() > 0,
      size: purchaseCache.size()
    },
    timestamp: new Date().toISOString()
  });
});

// Emergency stop endpoint
app.post('/api/emergency-stop', (req, res) => {
  const { reason } = req.body;
  
  emergencyStop = true;
  logger.error('🚨 EMERGENCY STOP ACTIVATED', {
    reason: reason || 'Manual activation',
    timestamp: new Date().toISOString(),
    activatedBy: req.ip
  });
  
  // Stop all intervals
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (geoAlertInterval) {
    clearInterval(geoAlertInterval);
    geoAlertInterval = null;
  }
  if (dailyStatsInterval) {
    clearInterval(dailyStatsInterval);
    dailyStatsInterval = null;
  }
  if (creativeAlertInterval) {
    clearInterval(creativeAlertInterval);
    creativeAlertInterval = null;
  }
  if (weeklyReportInterval) {
    clearInterval(weeklyReportInterval);
    weeklyReportInterval = null;
  }
  if (campaignAnalysisInterval) {
    clearInterval(campaignAnalysisInterval);
    campaignAnalysisInterval = null;
  }
  if (campaignReportInterval) {
    clearInterval(campaignReportInterval);
    campaignReportInterval = null;
  }
  if (alertCleanupInterval) {
    clearInterval(alertCleanupInterval);
    alertCleanupInterval = null;
  }
  
  saveAlertHistory('emergency_stop', 'sent', 'Emergency stop activated', {
    reason,
    ip: req.ip
  });
  
  res.json({
    success: true,
    message: 'Emergency stop activated. All automatic operations halted.',
    timestamp: new Date().toISOString()
  });
});

// Resume endpoint
app.post('/api/emergency-resume', (req, res) => {
  emergencyStop = false;
  logger.info('✅ Emergency stop deactivated', {
    timestamp: new Date().toISOString()
  });
  
  saveAlertHistory('emergency_resume', 'sent', 'Emergency stop deactivated', {
    ip: req.ip
  });
  
  res.json({
    success: true,
    message: 'Emergency stop deactivated. Restart server to resume operations.',
    timestamp: new Date().toISOString()
  });
});

// Force send notifications for specific customers
app.post('/api/force-notifications', async (req, res) => {
  try {
    const { customerIds } = req.body;
    
    if (!customerIds || !Array.isArray(customerIds)) {
      return res.status(400).json({
        success: false,
        error: 'customerIds array is required'
      });
    }
    
    const results = [];
    
    for (const customerId of customerIds) {
      try {
        // Get customer data from Stripe
        const customer = await fetchWithRetry(() => getCustomer(customerId));
        if (!customer) {
          results.push({
            customerId,
            success: false,
            error: 'Customer not found in Stripe'
          });
          continue;
        }
        
        // Get customer payments
        const payments = await fetchWithRetry(() => getCustomerPayments(customerId));
        const successfulPayments = payments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        if (successfulPayments.length === 0) {
          results.push({
            customerId,
            success: false,
            error: 'No successful payments found'
          });
          continue;
        }
        
        // Get customer data from Google Sheets
        const sheetRows = await fetchWithRetry(() => 
          googleSheets.findRows({ 'Customer ID': customerId })
        );
        
        if (sheetRows.length === 0) {
          results.push({
            customerId,
            success: false,
            error: 'Customer not found in Google Sheets'
          });
          continue;
        }
        
        const sheetRow = sheetRows[0];
        const latestPayment = successfulPayments[successfulPayments.length - 1];
        
        // Prepare sheet data
        const sheetData = {
          'Ad Name': sheetRow.get('Ad Name') || 'N/A',
          'Adset Name': sheetRow.get('Adset Name') || 'N/A',
          'Campaign Name': sheetRow.get('Campaign Name') || 'N/A',
          'Creative Link': sheetRow.get('Creative Link') || 'N/A',
          'Total Amount': sheetRow.get('Total Amount') || '0',
          'Payment Count': sheetRow.get('Payment Count') || '0',
          'Payment Intent IDs': sheetRow.get('Payment Intent IDs') || 'N/A'
        };
        
        // Force send notification (bypass duplicate checks)
        const amount = parseFloat(sheetData['Total Amount'] || 0);
        
        // VIP purchase alert
        if (amount >= alertConfig.vipPurchaseThreshold) {
          const alertType = `vip_${customer.id}`;
          
          if (alertCooldown.canSend(alertType, alertConfig.cooldownMinutes.vip)) {
            const vipAlert = `💎 VIP PURCHASE ALERT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Amount: $${amount.toFixed(2)}
👤 Customer: ${customer.email || 'N/A'}
🆔 ID: ${customer.id}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 High-value customer detected!`;
            
            await notificationQueue.add({
              type: 'vip_purchase',
              channel: 'telegram',
              message: vipAlert,
              metadata: { 
                amount, 
                customerId: customer.id,
                customerEmail: customer.email 
              }
            });
            
            alertCooldown.markSent(alertType);
            saveAlertHistory('vip_purchase', 'sent', vipAlert, { 
              amount, 
              customerId: customer.id,
              customerEmail: customer.email 
            });
          }
        }
        
        // Regular notification
        const notificationMessage = await formatTelegramNotification(latestPayment, customer, sheetData);
        
        await notificationQueue.add({
          type: 'new_purchase',
          channel: 'telegram',
          message: notificationMessage,
          metadata: {
            paymentId: latestPayment.id,
            customerId: customer.id,
            amount: amount
          }
        });
        
        results.push({
          customerId,
          success: true,
          message: 'Notification sent successfully',
          amount: amount,
          email: customer.email
        });
        
      } catch (error) {
        results.push({
          customerId,
          success: false,
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      message: `Processed ${customerIds.length} customers`,
      results
    });
    
  } catch (error) {
    logger.error('Error in force notifications', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export all purchases from Google Sheets to Telegram and Slack
app.post('/api/export-all-purchases', async (req, res) => {
  try {
    logger.info('Starting manual export of all purchases from Google Sheets');
    
    // Get all rows from Google Sheets
    const allRows = await googleSheets.getAllRows();
    logger.info(`Found ${allRows.length} rows in Google Sheets`);
    
    const results = {
      total: allRows.length,
      processed: 0,
      failed: 0,
      errors: [],
      notifications: []
    };
    
    // Process each row
    for (const row of allRows) {
      try {
        const customerId = row.get('Customer ID');
        if (!customerId) {
          results.failed++;
          results.errors.push({
            row: row.rowNumber,
            error: 'No Customer ID found'
          });
          continue;
        }
        
        // Get customer data from Stripe
        const customer = await fetchWithRetry(() => getCustomer(customerId));
        if (!customer) {
          results.failed++;
          results.errors.push({
            customerId,
            row: row.rowNumber,
            error: 'Customer not found in Stripe'
          });
          continue;
        }
        
        // Get customer payments
        const payments = await fetchWithRetry(() => getCustomerPayments(customerId));
        const successfulPayments = payments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        if (successfulPayments.length === 0) {
          results.failed++;
          results.errors.push({
            customerId,
            row: row.rowNumber,
            error: 'No successful payments found'
          });
          continue;
        }
        
        const latestPayment = successfulPayments[successfulPayments.length - 1];
        
        // Prepare sheet data
        const sheetData = {
          'Ad Name': row.get('Ad Name') || 'N/A',
          'Adset Name': row.get('Adset Name') || 'N/A',
          'Campaign Name': row.get('UTM Campaign') || 'N/A', // Use UTM Campaign field
          'UTM Campaign': row.get('UTM Campaign') || 'N/A', // Also include UTM Campaign directly
          'Creative Link': row.get('Creative Link') || 'N/A',
          'Total Amount': row.get('Total Amount') || '0',
          'Payment Count': row.get('Payment Count') || '1',
          'Payment Intent IDs': row.get('Payment Intent IDs') || latestPayment.id
        };
        
        const amount = parseFloat(sheetData['Total Amount'] || 0);
        
        // Send VIP alert if applicable
        if (amount >= alertConfig.vipPurchaseThreshold) {
          await sendVipPurchaseAlert(latestPayment, customer, sheetData);
        }
        
        // Send regular notification
        const notificationMessage = await formatTelegramNotification(latestPayment, customer, sheetData);
        
        await notificationQueue.add({
          type: 'export_purchase',
          channel: 'telegram',
          message: notificationMessage,
          metadata: {
            paymentId: latestPayment.id,
            customerId: customer.id,
            amount: amount,
            source: 'manual_export'
          }
        });
        
        results.notifications.push({
          customerId,
          email: customer.email,
          amount: amount,
          paymentId: latestPayment.id,
          row: row.rowNumber
        });
        
        results.processed++;
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          customerId: row.get('Customer ID'),
          row: row.rowNumber,
          error: error.message
        });
        logger.error('Error processing row for export', {
          row: row.rowNumber,
          customerId: row.get('Customer ID'),
          error: error.message
        });
      }
    }
    
    logger.info('Manual export completed', {
      total: results.total,
      processed: results.processed,
      failed: results.failed
    });
    
    res.json({
      success: true,
      message: `Export completed! Processed ${results.processed}/${results.total} purchases`,
      results
    });
    
  } catch (error) {
    logger.error('Error in export all purchases', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export today's purchases from Google Sheets to Telegram and Slack
app.post('/api/export-today-purchases', async (req, res) => {
  try {
    logger.info('Starting manual export of today\'s purchases from Google Sheets');
    
    // Get today's date in UTC+1
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
    
    logger.info(`Looking for purchases on ${todayStr} (UTC+1)`);
    
    // Get all rows from Google Sheets
    const allRows = await googleSheets.getAllRows();
    
    // Filter today's purchases
    const todayPurchases = allRows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      return createdLocal.includes(todayStr);
    });
    
    logger.info(`Found ${todayPurchases.length} purchases for today`);
    
    if (todayPurchases.length === 0) {
      return res.json({
        success: true,
        message: 'No purchases found for today',
        results: {
          total: 0,
          processed: 0,
          failed: 0,
          errors: [],
          notifications: []
        }
      });
    }
    
    const results = {
      total: todayPurchases.length,
      processed: 0,
      failed: 0,
      errors: [],
      notifications: []
    };
    
    // Process each today's purchase
    for (const row of todayPurchases) {
      try {
        const customerId = row.get('Customer ID');
        if (!customerId) {
          results.failed++;
          results.errors.push({
            row: row.rowNumber,
            error: 'No Customer ID found'
          });
          continue;
        }
        
        // Get customer data from Stripe
        const customer = await fetchWithRetry(() => getCustomer(customerId));
        if (!customer) {
          results.failed++;
          results.errors.push({
            customerId,
            row: row.rowNumber,
            error: 'Customer not found in Stripe'
          });
          continue;
        }
        
        // Get customer payments
        const payments = await fetchWithRetry(() => getCustomerPayments(customerId));
        const successfulPayments = payments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        if (successfulPayments.length === 0) {
          results.failed++;
          results.errors.push({
            customerId,
            row: row.rowNumber,
            error: 'No successful payments found'
          });
          continue;
        }
        
        const latestPayment = successfulPayments[successfulPayments.length - 1];
        
        // Prepare sheet data
        const sheetData = {
          'Ad Name': row.get('Ad Name') || 'N/A',
          'Adset Name': row.get('Adset Name') || 'N/A',
          'Campaign Name': row.get('UTM Campaign') || 'N/A', // Use UTM Campaign field
          'UTM Campaign': row.get('UTM Campaign') || 'N/A', // Also include UTM Campaign directly
          'Creative Link': row.get('Creative Link') || 'N/A',
          'Total Amount': row.get('Total Amount') || '0',
          'Payment Count': row.get('Payment Count') || '1',
          'Payment Intent IDs': row.get('Payment Intent IDs') || latestPayment.id
        };
        
        const amount = parseFloat(sheetData['Total Amount'] || 0);
        
        // Send VIP alert if applicable
        if (amount >= alertConfig.vipPurchaseThreshold) {
          await sendVipPurchaseAlert(latestPayment, customer, sheetData);
        }
        
        // Send regular notification
        const notificationMessage = await formatTelegramNotification(latestPayment, customer, sheetData);
        
        await notificationQueue.add({
          type: 'today_export',
          channel: 'telegram',
          message: notificationMessage,
          metadata: {
            paymentId: latestPayment.id,
            customerId: customer.id,
            amount: amount,
            source: 'today_export',
            date: todayStr
          }
        });
        
        results.notifications.push({
          customerId,
          email: customer.email,
          amount: amount,
          paymentId: latestPayment.id,
          row: row.rowNumber,
          createdLocal: row.get('Created Local (UTC+1)')
        });
        
        results.processed++;
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          customerId: row.get('Customer ID'),
          row: row.rowNumber,
          error: error.message
        });
        logger.error('Error processing today\'s purchase for export', {
          row: row.rowNumber,
          customerId: row.get('Customer ID'),
          error: error.message
        });
      }
    }
    
    logger.info('Today\'s purchases export completed', {
      date: todayStr,
      total: results.total,
      processed: results.processed,
      failed: results.failed
    });
    
    res.json({
      success: true,
      message: `Today's export completed! Processed ${results.processed}/${results.total} purchases for ${todayStr}`,
      date: todayStr,
      results
    });
    
  } catch (error) {
    logger.error('Error in export today purchases', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Notification queue management endpoints
app.get('/api/notification-queue/stats', (req, res) => {
  try {
    const stats = notificationQueue.getStats();
    res.json({
      success: true,
      message: 'Notification queue statistics',
      ...stats
    });
  } catch (error) {
    logger.error('Error getting notification queue stats', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/notification-queue/clear', (req, res) => {
  try {
    notificationQueue.clear();
    res.json({
      success: true,
      message: 'Notification queue cleared'
    });
  } catch (error) {
    logger.error('Error clearing notification queue', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/notification-queue/pause', (req, res) => {
  try {
    notificationQueue.pause();
    res.json({
      success: true,
      message: 'Notification queue processing paused'
    });
  } catch (error) {
    logger.error('Error pausing notification queue', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/notification-queue/resume', (req, res) => {
  try {
    notificationQueue.resume();
    res.json({
      success: true,
      message: 'Notification queue processing resumed'
    });
  } catch (error) {
    logger.error('Error resuming notification queue', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check and fix duplicates endpoint
app.get('/api/check-duplicates', async (req, res) => {
  try {
    logger.info('🔍 Starting duplicate check...');
    
    // Use the new DuplicateChecker service
    const result = await duplicateChecker.findAllDuplicates();
    
    res.json({
      success: true,
      message: `Found ${result.duplicatesFound} customers with duplicate entries`,
      ...result
    });
    
  } catch (error) {
    logger.error('Error checking duplicates', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Fix duplicates endpoint
app.post('/api/fix-duplicates', async (req, res) => {
  try {
    logger.info('🔧 Starting aggressive duplicate fix...');
    
    // Clear Google Sheets cache first
    clearSheetsCache();
    
    const rows = await googleSheets.getAllRows();
    const customerGroups = new Map();
    let fixedCount = 0;
    let deletedCount = 0;
    
    // Group rows by Customer ID
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(row);
    }
    
    // Fix each customer with duplicates
    for (const [customerId, customerRows] of customerGroups.entries()) {
      if (customerRows.length > 1) {
        logger.info(`Fixing duplicates for customer ${customerId} (${customerRows.length} rows)`);
        
        // Get all payments for this customer from Stripe
        const allPayments = await fetchWithRetry(() => getCustomerPayments(customerId));
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
        
        // Sort rows by row number to keep the first one
        customerRows.sort((a, b) => a.rowNumber - b.rowNumber);
        const keepRow = customerRows[0];
        const deleteRows = customerRows.slice(1);
        
        // Delete duplicate rows (in reverse order to avoid row number shifts)
        deleteRows.sort((a, b) => b.rowNumber - a.rowNumber);
        for (const row of deleteRows) {
          try {
            await fetchWithRetry(() => row.delete());
            deletedCount++;
            logger.info(`Deleted duplicate row ${row.rowNumber} for customer ${customerId}`);
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            logger.warn(`Could not delete row ${row.rowNumber}:`, error.message);
          }
        }
        
        // Update the kept row with correct data
        try {
          await fetchWithRetry(() => googleSheets.updateRow(keepRow, {
            'Purchase ID': `purchase_${customerId}`,
            'Total Amount': (totalAmountAll / 100).toFixed(2),
            'Payment Count': paymentCountAll.toString(),
            'Payment Intent IDs': paymentIdsAll.join(', ')
          }));
          
          fixedCount++;
          logger.info(`Updated row ${keepRow.rowNumber} for customer ${customerId} with ${paymentCountAll} payments`);
        } catch (error) {
          logger.warn(`Could not update row ${keepRow.rowNumber}:`, error.message);
        }
      }
    }
    
    // Clear cache again after all operations
    clearSheetsCache();
    
    logger.info(`Fixed ${fixedCount} customers, deleted ${deletedCount} duplicate rows`);
    
    res.json({
      success: true,
      message: `Fixed ${fixedCount} customers with duplicates`,
      fixedCustomers: fixedCount,
      deletedRows: deletedCount
    });
    
  } catch (error) {
    logger.error('Error fixing duplicates', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Campaign analysis endpoints
app.get('/api/campaigns/analyze', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || 'today'; // today, yesterday, week, month
    
    const analysis = await campaignAnalyzer.analyzeCampaigns(timeframe);
    
    if (!analysis) {
      return res.json({
        success: true,
        message: 'No data available for analysis',
        timeframe
      });
    }
    
    res.json({
      success: true,
      message: 'Campaign analysis completed',
      ...analysis
    });
    
  } catch (error) {
    logger.error('Error in campaign analysis endpoint', error);
    res.status(500).json({
      success: false,
      message: 'Campaign analysis failed',
      error: error.message
    });
  }
});

// Single campaign analysis endpoint
app.get('/api/campaigns/:campaignName/analyze', async (req, res) => {
  try {
    const { campaignName } = req.params;
    const timeframe = req.query.timeframe || 'week';
    
    const analysis = await campaignAnalyzer.analyzeSingleCampaign(
      decodeURIComponent(campaignName),
      timeframe
    );
    
    res.json({
      success: true,
      message: 'Single campaign analysis completed',
      ...analysis
    });
    
  } catch (error) {
    logger.error('Error in single campaign analysis', error);
    res.status(500).json({
      success: false,
      message: 'Single campaign analysis failed',
      error: error.message
    });
  }
});

// Campaign report endpoint - sends to Telegram
app.post('/api/campaigns/report', async (req, res) => {
  try {
    const timeframe = req.body.timeframe || 'today';
    
    const analysis = await campaignAnalyzer.analyzeCampaigns(timeframe);
    
    if (!analysis) {
      return res.json({
        success: true,
        message: 'No data for campaign report'
      });
    }
    
    const report = campaignAnalyzer.formatReport(analysis);
    await sendTextNotifications(report);
    
    saveAlertHistory('campaign_report', 'sent', 'Campaign report sent', {
      timeframe,
      scaleRecommendations: analysis.recommendations.scale.length,
      pauseRecommendations: analysis.recommendations.pause.length
    });
    
    res.json({
      success: true,
      message: 'Campaign report sent successfully',
      recommendations: {
        scale: analysis.recommendations.scale.length,
        pause: analysis.recommendations.pause.length,
        optimize: analysis.recommendations.optimize.length
      }
    });
    
  } catch (error) {
    logger.error('Error sending campaign report', error);
    res.status(500).json({
      success: false,
      message: 'Campaign report failed',
      error: error.message
    });
  }
});

// List all campaigns endpoint
app.get('/api/campaigns/list', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || 'week';
    
    const rows = await googleSheets.getAllRows();
    const purchases = campaignAnalyzer.filterByTimeframe(rows, timeframe);
    
    // Get unique campaigns with basic stats
    const campaignMap = new Map();
    
    for (const purchase of purchases) {
      const name = purchase.get('UTM Campaign') || purchase.get('Campaign Name') || 'Unknown';
      
      if (!campaignMap.has(name)) {
        campaignMap.set(name, {
          name,
          purchases: 0,
          revenue: 0
        });
      }
      
      const campaign = campaignMap.get(name);
      campaign.purchases++;
      campaign.revenue += parseFloat(purchase.get('Total Amount') || 0);
    }
    
    const campaigns = Array.from(campaignMap.values())
      .map(c => ({
        ...c,
        aov: c.revenue / c.purchases
      }))
      .sort((a, b) => b.revenue - a.revenue);
    
    res.json({
      success: true,
      message: `Found ${campaigns.length} campaigns`,
      timeframe,
      campaigns
    });
    
  } catch (error) {
    logger.error('Error listing campaigns', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list campaigns',
      error: error.message
    });
  }
});

// Duplicate checker cache management endpoints
app.get('/api/duplicate-checker/stats', (req, res) => {
  try {
    const stats = duplicateChecker.getStats();
    res.json({
      success: true,
      message: 'Duplicate checker statistics',
      ...stats
    });
  } catch (error) {
    logger.error('Error getting duplicate checker stats', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Distributed lock management endpoints
app.get('/api/distributed-locks/stats', (req, res) => {
  try {
    const stats = distributedLock.getStats();
    res.json({
      success: true,
      message: 'Distributed lock statistics',
      ...stats
    });
  } catch (error) {
    logger.error('Error getting distributed lock stats', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/distributed-locks/cleanup', (req, res) => {
  try {
    const cleaned = distributedLock.cleanup();
    res.json({
      success: true,
      message: `Cleaned ${cleaned} stale locks`,
      cleaned
    });
  } catch (error) {
    logger.error('Error cleaning distributed locks', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get detailed information about active locks
app.get('/api/distributed-locks/active', (req, res) => {
  try {
    const activeLocks = distributedLock.getActiveLocks();
    res.json({
      success: true,
      message: `Found ${activeLocks.length} active locks`,
      activeLocks,
      count: activeLocks.length
    });
  } catch (error) {
    logger.error('Error getting active locks', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force release a specific lock
app.post('/api/distributed-locks/release/:lockKey', (req, res) => {
  try {
    const { lockKey } = req.params;
    const released = distributedLock.forceRelease(lockKey);
    
    if (released) {
      res.json({
        success: true,
        message: `Successfully released lock: ${lockKey}`,
        lockKey
      });
    } else {
      res.status(404).json({
        success: false,
        message: `Lock not found: ${lockKey}`,
        lockKey
      });
    }
  } catch (error) {
    logger.error('Error releasing lock', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/duplicate-checker/refresh', async (req, res) => {
  try {
    logger.info('🔄 Refreshing duplicate checker cache...');
    const count = await duplicateChecker.refreshCache();
    
    res.json({
      success: true,
      message: 'Duplicate checker cache refreshed',
      customersInCache: count
    });
  } catch (error) {
    logger.error('Error refreshing duplicate checker cache', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/duplicate-checker/customer/:customerId', (req, res) => {
  try {
    const { customerId } = req.params;
    
    if (duplicateChecker.customerExists(customerId)) {
      const info = duplicateChecker.getCustomerInfo(customerId);
      res.json({
        success: true,
        message: 'Customer found in cache',
        customerId,
        info
      });
    } else {
      res.json({
        success: true,
        message: 'Customer not found in cache',
        customerId,
        exists: false
      });
    }
  } catch (error) {
    logger.error('Error checking customer in duplicate checker', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/duplicate-checker/payment-intent/:paymentIntentId', (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    const result = duplicateChecker.paymentIntentExists(paymentIntentId);
    
    res.json({
      success: true,
      message: result.exists ? 'Payment intent found' : 'Payment intent not found',
      paymentIntentId,
      ...result
    });
  } catch (error) {
    logger.error('Error checking payment intent in duplicate checker', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Duplicate checker stats
app.get('/api/duplicates/cache-stats', (req, res) => {
  try {
    const stats = duplicateChecker.getStats();
    res.json({
      success: true,
      message: 'Duplicate checker cache statistics',
      ...stats
    });
  } catch (error) {
    logger.error('Error getting cache stats', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Refresh duplicate cache manually
app.post('/api/duplicates/refresh-cache', async (req, res) => {
  try {
    const count = await duplicateChecker.refreshCache();
    res.json({
      success: true,
      message: 'Duplicate checker cache refreshed',
      customers: count
    });
  } catch (error) {
    logger.error('Error refreshing cache', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Find all duplicates
app.get('/api/duplicates/find', async (req, res) => {
  try {
    const result = await duplicateChecker.findAllDuplicates();
    res.json({
      success: true,
      message: `Found ${result.duplicatesFound} customers with duplicates`,
      ...result
    });
  } catch (error) {
    logger.error('Error finding duplicates', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Find duplicates by Customer ID (more comprehensive check)
app.get('/api/duplicates/find-by-customer', async (req, res) => {
  try {
    logger.info('🔍 Starting comprehensive duplicate check by Customer ID...');
    
    const rows = await googleSheets.getAllRows();
    logger.info(`📋 Checking ${rows.length} rows for duplicates by Customer ID...`);
    
    // Group rows by Customer ID
    const customerMap = new Map();
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, []);
      }
      customerMap.get(customerId).push(row);
    }
    
    // Find customers with multiple rows
    const duplicates = [];
    for (const [customerId, customerRows] of customerMap.entries()) {
      if (customerRows.length > 1) {
        duplicates.push({
          customerId,
          rowCount: customerRows.length,
          rows: customerRows.map((row, index) => ({
            rowNumber: row.rowNumber,
            purchaseId: row.get('Purchase ID'),
            email: row.get('Email'),
            amount: row.get('Total Amount'),
            paymentIntentIds: row.get('Payment Intent IDs'),
            created: row.get('Created Local (UTC+1)')
          }))
        });
      }
    }
    
    logger.info(`🔍 Found ${duplicates.length} customers with duplicate rows`);
    
    res.json({
      success: true,
      message: `Found ${duplicates.length} customers with duplicate rows`,
      totalCustomers: customerMap.size,
      totalRows: rows.length,
      duplicatesFound: duplicates.length,
      duplicates: duplicates.slice(0, 10) // Show first 10
    });
    
  } catch (error) {
    logger.error('Error finding duplicates by customer', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Fix specific duplicate by Customer ID
app.post('/api/duplicates/fix-customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    logger.info(`🔧 Fixing duplicates for customer ${customerId}...`);
    
    // Get all rows from Google Sheets
    const allRows = await googleSheets.getAllRows();
    
    // Find rows for this customer
    const rows = allRows.filter(row => row.get('Customer ID') === customerId);
    
    if (rows.length <= 1) {
      return res.json({
        success: true,
        message: `No duplicates found for customer ${customerId}`,
        rowsFound: rows.length
      });
    }
    
    logger.info(`Found ${rows.length} rows for customer ${customerId}, keeping first one...`);
    
    // Sort by row number to keep the first one
    rows.sort((a, b) => a.rowNumber - b.rowNumber);
    const keepRow = rows[0];
    const rowsToDelete = rows.slice(1);
    let deletedCount = 0;
    
    // Delete duplicate rows using direct row.delete() method
    rowsToDelete.sort((a, b) => b.rowNumber - a.rowNumber);
    for (const row of rowsToDelete) {
      try {
        await row.delete();
        deletedCount++;
        logger.info(`Deleted duplicate row ${row.rowNumber} for customer ${customerId}`);
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Error deleting row ${row.rowNumber}:`, error);
      }
    }
    
    // Refresh caches
    await Promise.all([
      duplicateChecker.refreshCache(),
      purchaseCache.reload()
    ]);
    
    res.json({
      success: true,
      message: `Fixed duplicates for customer ${customerId}`,
      customerId,
      totalRows: rows.length,
      deletedRows: deletedCount,
      keptRow: keepRow.rowNumber
    });
    
  } catch (error) {
    logger.error('Error fixing customer duplicates', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync locks monitoring
app.get('/api/sync-locks', (req, res) => {
  const now = Date.now();
  const locks = [];
  
  for (const [customerId, timestamp] of syncLock.entries()) {
    locks.push({
      customerId,
      lockedFor: `${Math.round((now - timestamp) / 1000)}s`,
      lockedAt: new Date(timestamp).toISOString()
    });
  }
  
  res.json({
    success: true,
    message: 'Current sync locks',
    activeLocks: locks.length,
    locks: locks.sort((a, b) => b.timestamp - a.timestamp)
  });
});

// Debug endpoint to check UTM Campaign data
app.get('/api/debug/utm-campaigns', async (req, res) => {
  try {
    const rows = await googleSheets.getAllRows();
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0];
    
    // Get today's purchases
    const todayPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      return createdLocal.startsWith(todayStr);
    });
    
    // Check UTM Campaign values
    const utmCampaigns = todayPurchases.map(row => ({
      utmCampaign: row.get('UTM Campaign'),
      campaignName: row.get('Campaign Name'),
      email: row.get('Email'),
      amount: row.get('Total Amount')
    }));
    
    // Get unique values
    const uniqueUtmCampaigns = [...new Set(utmCampaigns.map(p => p.utmCampaign))];
    const uniqueCampaignNames = [...new Set(utmCampaigns.map(p => p.campaignName))];
    
    res.json({
      success: true,
      message: 'UTM Campaign debug data',
      totalPurchases: todayPurchases.length,
      uniqueUtmCampaigns,
      uniqueCampaignNames,
      sampleData: utmCampaigns.slice(0, 5)
    });
    
  } catch (error) {
    logger.error('Error in UTM Campaign debug', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Load existing purchases endpoint
app.get('/api/load-existing', async (req, res) => {
  try {
    await loadExistingPurchases();
    res.json({
      success: true,
      message: `Loaded ${purchaseCache.size()} existing purchases`,
      count: purchaseCache.size(),
      purchases: purchaseCache.getSample(10) // Показываем первые 10
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
    message: `Memory contains ${purchaseCache.size()} purchases`,
    count: purchaseCache.size(),
    purchases: purchaseCache.getSample(20),
    auto_sync_disabled: ENV.AUTO_SYNC_DISABLED,
    notifications_disabled: ENV.NOTIFICATIONS_DISABLED
  });
});

// Purchase cache statistics endpoint
app.get('/api/cache-stats', (req, res) => {
  try {
    const stats = purchaseCache.getStats();
    res.json({
      success: true,
      message: 'Purchase cache statistics',
      ...stats
    });
  } catch (error) {
    logger.error('Error getting cache stats', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync status endpoint
app.get('/api/sync-status', (req, res) => {
  res.json({
    success: true,
    message: 'Sync status',
    isSyncing: isSyncing,
    status: isSyncing ? 'in_progress' : 'idle',
    timestamp: new Date().toISOString()
  });
});

// Clean old alerts endpoint
app.post('/api/clean-alerts', (req, res) => {
  try {
    cleanOldAlerts();
    res.json({
      success: true,
      message: 'Old alert records cleaned successfully',
      currentSizes: {
        dailyStats: sentAlerts.dailyStats.size,
        creativeAlert: sentAlerts.creativeAlert.size,
        weeklyReport: sentAlerts.weeklyReport.size
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error cleaning alerts', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
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
      existingPurchases: purchaseCache.size(),
      processedPurchases: purchaseCache.processedPurchaseIds.size
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
    
    const result = await runSync();
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: `Auto-sync completed! ${result.processed || 0} NEW purchases processed`,
        processed: result.processed || 0,
        total_groups: result.total_groups || 0
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: result.message || 'Auto-sync failed'
      });
    }
    
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
  const startTime = Date.now();
  try {
    logger.info('Starting full resync...', {
      timestamp: new Date().toISOString(),
      startTime: startTime
    });
    
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
    
    // Collect all updates for batch processing
    const batchUpdates = [];
    const rowsToDelete = [];
    
    // Process each customer
    for (const [customerId, customerRows] of customerMap) {
      try {
        // Get all payments for this customer from Stripe
        const allPayments = await fetchWithRetry(() => getCustomerPayments(customerId));
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
        
        // Mark duplicate rows for deletion (keep only the first one)
        if (customerRows.length > 1) {
          for (let i = 1; i < customerRows.length; i++) {
            rowsToDelete.push(customerRows[i]);
            fixedCount++;
          }
        }
        
        // Get fresh row data after marking duplicates for deletion
        const freshCustomers = await fetchWithRetry(() => googleSheets.findRows({ 'Customer ID': customerId }));
        if (freshCustomers.length === 0) continue;
        
        const freshCustomer = freshCustomers[0];
        
        // Add to batch updates
        batchUpdates.push({
          row: freshCustomer,
          data: {
            'Purchase ID': `purchase_${customerId}`,
            'Total Amount': (totalAmountAll / 100).toFixed(2),
            'Payment Count': paymentCountAll.toString(),
            'Payment Intent IDs': paymentIdsAll.join(', ')
          }
        });
        
        processedCount++;
        
      } catch (error) {
        logger.error(`Error processing customer ${customerId}:`, error);
      }
    }
    
    // Execute batch operations
    logger.info('Executing batch operations', {
      updates: batchUpdates.length,
      deletions: rowsToDelete.length
    });
    
    // Batch delete duplicate rows
    if (rowsToDelete.length > 0) {
      const deletePromises = rowsToDelete.map(row => 
        fetchWithRetry(() => row.delete()).catch(error => {
          logger.warn(`Could not delete duplicate row:`, error.message);
          return { success: false, error: error.message };
        })
      );
      await Promise.all(deletePromises);
    }
    
    // Batch update all rows
    if (batchUpdates.length > 0) {
      const updateResults = await fetchWithRetry(() => googleSheets.batchUpdate(batchUpdates));
      const successCount = updateResults.filter(r => r.success).length;
      const failureCount = updateResults.filter(r => !r.success).length;
      
      logger.info('Batch update results', {
        total: batchUpdates.length,
        success: successCount,
        failures: failureCount
      });
    }
    
    const duration = Date.now() - startTime;
    logger.info('Full resync completed', {
      processed_customers: processedCount,
      fixed_duplicates: fixedCount,
      duration: `${duration}ms`,
      durationSeconds: Math.round(duration / 1000),
      timestamp: new Date().toISOString(),
      performance: {
        customersPerSecond: processedCount > 0 ? Math.round(processedCount / (duration / 1000)) : 0,
        avgTimePerCustomer: processedCount > 0 ? Math.round(duration / processedCount) : 0
      }
    });
    
    res.json({
      success: true,
      message: `Full resync completed! Processed ${processedCount} customers, fixed ${fixedCount} duplicates`,
      processed_customers: processedCount,
      fixed_duplicates: fixedCount,
      duration: `${duration}ms`
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
    
    // Collect all duplicate rows for batch deletion
    const rowsToDelete = [];
    
    for (const [customerId, customerRows] of customerMap) {
      if (customerRows.length > 1) {
        logger.info(`Found ${customerRows.length} duplicates for customer ${customerId}`);
        
        // Keep the first row, mark the rest for deletion
        for (let i = 1; i < customerRows.length; i++) {
          rowsToDelete.push(customerRows[i]);
          duplicatesRemoved++;
        }
      }
    }
    
    // Batch delete all duplicate rows
    if (rowsToDelete.length > 0) {
      logger.info(`Batch deleting ${rowsToDelete.length} duplicate rows`);
      
      const deletePromises = rowsToDelete.map(row => 
        fetchWithRetry(() => row.delete()).catch(error => {
          logger.warn(`Could not delete duplicate row:`, error.message);
          return { success: false, error: error.message };
        })
      );
      
      const deleteResults = await Promise.all(deletePromises);
      const successCount = deleteResults.filter(r => r.success).length;
      const failureCount = deleteResults.filter(r => !r.success).length;
      
      logger.info('Batch delete results', {
        total: rowsToDelete.length,
        success: successCount,
        failures: failureCount
      });
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
    
    // Collect test rows for batch deletion
    const testRowsToDelete = [];
    
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      // Mark test data for removal
      if (customerId === 'cus_test_123456789' || 
          email === 'test@example.com' ||
          customerId?.includes('test') ||
          email?.includes('test@')) {
        testRowsToDelete.push(row);
        removedCount++;
        logger.info(`Marked test row for deletion: ${customerId} - ${email}`);
      }
    }
    
    // Batch delete all test rows
    if (testRowsToDelete.length > 0) {
      logger.info(`Batch deleting ${testRowsToDelete.length} test rows`);
      
      const deletePromises = testRowsToDelete.map(row => 
        fetchWithRetry(() => row.delete()).catch(error => {
          logger.warn(`Could not delete test row:`, error.message);
          return { success: false, error: error.message };
        })
      );
      
      const deleteResults = await Promise.all(deletePromises);
      const successCount = deleteResults.filter(r => r.success).length;
      const failureCount = deleteResults.filter(r => !r.success).length;
      
      logger.info('Batch delete test data results', {
        total: testRowsToDelete.length,
        success: successCount,
        failures: failureCount
      });
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

// Metrics endpoint
app.get('/api/metrics', (req, res) => {
  try {
    const allMetrics = metrics.getAll();
    res.json({
      success: true,
      message: 'Application metrics',
      metrics: allMetrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting metrics', error);
    res.status(500).json({
      success: false,
      message: 'Error getting metrics',
      error: error.message
    });
  }
});

// Metrics summary endpoint
app.get('/api/metrics/summary', (req, res) => {
  try {
    const summary = metrics.getSummary();
    res.json({
      success: true,
      message: 'Application metrics summary',
      summary: summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting metrics summary', error);
    res.status(500).json({
      success: false,
      message: 'Error getting metrics summary',
      error: error.message
    });
  }
});

// Reset metrics endpoint
app.post('/api/metrics/reset', (req, res) => {
  try {
    metrics.reset();
    res.json({
      success: true,
      message: 'Metrics reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error resetting metrics', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting metrics',
      error: error.message
    });
  }
});

// Test batch operations endpoint
app.post('/api/test-batch-operations', async (req, res) => {
  try {
    logger.info('Testing batch operations...');
    
    // Get a few rows for testing
    const rows = await googleSheets.getAllRows();
    const testRows = rows.slice(0, 3); // Take first 3 rows for testing
    
    if (testRows.length === 0) {
      return res.json({
        success: false,
        message: 'No rows available for testing batch operations'
      });
    }
    
    // Test batch update
    const batchUpdates = testRows.map((row, index) => ({
      row: row,
      data: {
        'Test Field': `Batch Update ${index + 1}`,
        'Test Timestamp': new Date().toISOString()
      }
    }));
    
    const startTime = Date.now();
    const updateResults = await googleSheets.batchUpdate(batchUpdates);
    const duration = Date.now() - startTime;
    
    const successCount = updateResults.filter(r => r.success).length;
    const failureCount = updateResults.filter(r => !r.success).length;
    
    logger.info('Batch operations test completed', {
      totalUpdates: batchUpdates.length,
      successCount: successCount,
      failureCount: failureCount,
      duration: `${duration}ms`
    });
    
    res.json({
      success: true,
      message: 'Batch operations test completed',
      results: {
        totalUpdates: batchUpdates.length,
        successCount: successCount,
        failureCount: failureCount,
        duration: `${duration}ms`,
        avgTimePerUpdate: Math.round(duration / batchUpdates.length)
      },
      updateResults: updateResults
    });
    
  } catch (error) {
    logger.error('Error testing batch operations', error);
    res.status(500).json({
      success: false,
      message: 'Error testing batch operations',
      error: error.message
    });
  }
});

// Extract sync logic into reusable function
async function performSyncLogic() {
  const startTime = Date.now();
  const results = {
    processed: 0,
    failed: 0,
    errors: [],
    newPurchases: 0,
    updatedPurchases: 0,
    skipped: 0,
    duplicatesAvoided: 0,
    lockWaitTime: 0
  };
  
  try {
    logger.info('🔄 Starting payment sync with MAXIMUM duplicate protection...', { 
      timestamp: new Date().toISOString()
    });
    
    // ✅ БЛОКИРОВКА УЖЕ ПОЛУЧЕНА В runSync() - не получаем повторно
    // const syncLockId = await distributedLock.acquire('sync_operation', 100, 200);
    
    try {
      // 🔄 КРИТИЧЕСКИ ВАЖНО: Обновляем ВСЕ кэши ПЕРЕД началом
      logger.info('📦 Refreshing ALL caches before sync...');
      await Promise.all([
        duplicateChecker.refreshCache(),
        purchaseCache.reload()
      ]);
    
      // Get recent payments from Stripe
      const payments = await fetchWithRetry(() => getRecentPayments(100));
      
      // Filter successful payments
      const successfulPayments = payments.filter(p => {
        if (p.status !== 'succeeded' || !p.customer) return false;
        if (p.description && p.description.toLowerCase().includes('subscription update')) {
          return false;
        }
        return true;
      });
      
      logger.info(`📊 Found ${successfulPayments.length} successful payments to process`);
      
      // 🔍 Фильтруем платежи используя ОСНОВНУЮ систему purchaseCache
      const newPayments = successfulPayments.filter(p => {
        // Проверяем в основной системе purchaseCache
        if (purchaseCache.has(p.id)) {
          logger.info(`Payment Intent ${p.id} already processed (purchaseCache)`, {
            paymentId: p.id,
            reason: 'already_in_purchase_cache'
          });
          results.duplicatesAvoided++;
          return false;
        }
        
        // Дополнительная проверка в duplicateChecker
        const check = duplicateChecker.paymentIntentExists(p.id);
        if (check.exists) {
          logger.info(`Payment Intent ${p.id} already processed (duplicateChecker)`, {
            paymentId: p.id,
            customerId: check.customerId,
            reason: 'already_in_duplicate_checker'
          });
          results.duplicatesAvoided++;
          return false;
        }
        return true;
      });
      
      logger.info(`🆕 Processing ${newPayments.length} new payments, avoided ${results.duplicatesAvoided} duplicates`);
      
      // Group payments by customer
      const customerGroups = new Map();
      for (const payment of newPayments) {
        const customerId = payment.customer;
        if (!customerGroups.has(customerId)) {
          customerGroups.set(customerId, []);
        }
        customerGroups.get(customerId).push(payment);
      }
      
      // Process each customer group
      for (const [customerId, payments] of customerGroups.entries()) {
        // 🔒 Получаем блокировку для этого клиента
        const customerLockKey = `customer_${customerId}`;
        let customerLockId = null;
        try {
          customerLockId = await distributedLock.acquire(customerLockKey, 5, 100);
          logger.debug(`🔒 Customer lock acquired for ${customerId}`, { customerLockId });
        } catch (error) {
          logger.warn(`⚠️ Failed to acquire customer lock for ${customerId}, skipping payment group`, {
            error: error.message,
            customerId,
            paymentCount: payments.length
          });
          results.duplicatesAvoided += payments.length;
          continue;
        }
        
        try {
          const customer = await fetchWithRetry(() => getCustomer(customerId));
          if (!customer) {
            logger.warn(`Customer ${customerId} not found in Stripe`);
            results.skipped += payments.length;
            continue;
          }
          
          // Sort payments by creation date
          payments.sort((a, b) => a.created - b.created);
          const firstPayment = payments[0];
          const latestPayment = payments[payments.length - 1];
          
          // 🔍 ТРОЙНАЯ ПРОВЕРКА перед обработкой (критично!)
          const existingCustomers = await fetchWithRetry(() => 
            googleSheets.findRows({ 'Customer ID': customerId })
          );
          
          if (existingCustomers.length > 0) {
            // Customer exists - UPDATE
            logger.info(`Updating existing customer ${customerId}`);
            
            const allPayments = await fetchWithRetry(() => getCustomerPayments(customerId));
            const allSuccessfulPayments = allPayments.filter(p => {
              if (p.status !== 'succeeded' || !p.customer) return false;
              if (p.description && p.description.toLowerCase().includes('subscription update')) {
                return false;
              }
              return true;
            });
            
            let totalAmountAll = 0;
            let paymentCountAll = 0;
            const paymentIdsAll = [];
            
            for (const p of allSuccessfulPayments) {
              totalAmountAll += p.amount;
              paymentCountAll++;
              paymentIdsAll.push(p.id);
            }
            
            await fetchWithRetry(() => 
              googleSheets.updateRow(existingCustomers[0], {
                'Purchase ID': `purchase_${customerId}`,
                'Total Amount': (totalAmountAll / 100).toFixed(2),
                'Payment Count': paymentCountAll.toString(),
                'Payment Intent IDs': paymentIdsAll.join(', ')
              })
            );
            
            // 🔄 КРИТИЧЕСКИ ВАЖНО: Добавляем новые платежи в ОСНОВНУЮ систему purchaseCache
            for (const paymentId of paymentIdsAll) {
              if (!purchaseCache.has(paymentId)) {
                purchaseCache.add(paymentId);
              }
            }
            
            // 🔄 Обновляем кэш дубликатов
            duplicateChecker.updateCache(customerId, {
              purchaseId: `purchase_${customerId}`,
              paymentIntentIds: paymentIdsAll,
              totalAmount: (totalAmountAll / 100).toFixed(2),
              paymentCount: paymentCountAll.toString()
            });
            
            // Send notification
            const sheetData = {
              'Ad Name': existingCustomers[0].get('Ad Name') || 'N/A',
              'Adset Name': existingCustomers[0].get('Adset Name') || 'N/A',
              'Campaign Name': existingCustomers[0].get('Campaign Name') || 'N/A',
              'Creative Link': existingCustomers[0].get('Creative Link') || 'N/A',
              'Total Amount': (totalAmountAll / 100).toFixed(2),
              'Payment Count': paymentCountAll.toString(),
              'Payment Intent IDs': paymentIdsAll.join(', ')
            };
            
            const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];
            
            // Send VIP alert if applicable
            await sendVipPurchaseAlert(latestPayment, customer, sheetData);
            
            // Send regular notification
            await sendPurchaseNotification(latestPayment, customer, sheetData, 'upsell');
            
            results.updatedPurchases++;
            results.processed++;
            
          } else {
            // ADD NEW customer (используем атомарную операцию)
            logger.info(`Adding new customer ${customerId} (with lock and atomic operation)`);
            
            const rowData = formatPaymentForSheets(firstPayment, customer);
            
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
            
            // 🔒 АТОМАРНОЕ добавление с внутренней блокировкой
            const addResult = await googleSheets.addRowIfNotExists(rowData, 'Customer ID');
            
            if (addResult.exists) {
              // Кто-то добавил строку между нашими проверками!
              logger.warn(`⚠️ Row appeared during atomic add for ${customerId} - converting to update`);
              results.duplicatesAvoided++;
              
              // Обновляем существующую строку
              await fetchWithRetry(() => 
                googleSheets.updateRow(addResult.row, {
                  'Total Amount': rowData['Total Amount'],
                  'Payment Count': rowData['Payment Count'],
                  'Payment Intent IDs': rowData['Payment Intent IDs']
                })
              );
              
              results.updatedPurchases++;
            } else {
              // Успешно добавили
              results.newPurchases++;
            }
            
            // ✅ Обновляем ОБЕ системы кэширования СРАЗУ
            for (const paymentId of paymentIds) {
              purchaseCache.add(paymentId);
            }
            duplicateChecker.addToCache(customerId, {
              purchaseId: rowData['Purchase ID'],
              paymentIntentIds: paymentIds,
              totalAmount: rowData['Total Amount'],
              paymentCount: rowData['Payment Count']
            });
            
            // Send notification
            const sheetData = {
              'Ad Name': rowData['Ad Name'] || 'N/A',
              'Adset Name': rowData['Adset Name'] || 'N/A',
              'Campaign Name': rowData['Campaign Name'] || 'N/A',
              'Creative Link': rowData['Creative Link'] || 'N/A',
              'Total Amount': rowData['Total Amount'],
              'Payment Count': rowData['Payment Count'],
              'Payment Intent IDs': rowData['Payment Intent IDs']
            };
            
            // Send VIP alert if applicable
            await sendVipPurchaseAlert(firstPayment, customer, sheetData);
            
            // Send regular notification
            await sendPurchaseNotification(firstPayment, customer, sheetData, 'new_purchase');
            
            results.processed++;
          }
          
        } catch (error) {
          results.failed++;
          results.errors.push({
            customerId,
            error: error.message,
            errorType: error.name || 'UnknownError'
          });
          logger.error('Failed to process customer group', { 
            customerId,
            error: error.message,
            stack: error.stack
          });
        } finally {
          // 🔓 Освобождаем блокировку клиента
          if (customerLockId) {
            distributedLock.release(customerLockKey, customerLockId);
            logger.debug(`🔓 Customer lock released for ${customerId}`, { customerLockId });
          }
        }
      }
      
      // 🔄 ФИНАЛЬНОЕ обновление кэшей после всех операций
      await Promise.all([
        duplicateChecker.refreshCache(),
        purchaseCache.reload()
      ]);
      
    } finally {
      // ✅ БЛОКИРОВКА ОСВОБОЖДАЕТСЯ В runSync() - не освобождаем здесь
      // distributedLock.release('sync_operation', syncLockId);
    }
    
    const duration = Date.now() - startTime;
    
    logger.info('✅ Sync completed with maximum protection', {
      processed: results.processed,
      newPurchases: results.newPurchases,
      updatedPurchases: results.updatedPurchases,
      duplicatesAvoided: results.duplicatesAvoided,
      failed: results.failed,
      duration: `${duration}ms`
    });
    
    return {
      success: true,
      message: `Sync completed! Processed ${results.processed}, avoided ${results.duplicatesAvoided} duplicates`,
      ...results,
      duration: `${duration}ms`
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Critical sync error', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      results: results
    });
    
    return {
      success: false,
      message: 'Critical sync error occurred',
      error: error.message,
      partialResults: results,
      duration: `${duration}ms`
    };
  }
}

// Sync payments endpoint - MAXIMUM DUPLICATE PROTECTION
app.post('/api/sync-payments', async (req, res) => {
  try {
    const result = await performSyncLogic();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Sync endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Sync endpoint error',
      error: error.message
    });
  }
});

// Weekly report endpoint - ТОЛЬКО ОДИН РАЗ!
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
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    const currentHour = utcPlus1.getUTCHours();
    const currentMinute = utcPlus1.getUTCMinutes();
    
    // Защита от спама: не отправляем GEO алерт чаще чем раз в 30 минут
    const geoAlertKey = `geo_${today}_${currentHour}_${Math.floor(currentMinute / 30)}`;
    
    if (sentAlerts.geoAlert && sentAlerts.geoAlert.has(geoAlertKey)) {
      logger.info('🌍 GEO alert already sent for this 30-minute window, skipping');
      return res.json({
        success: true,
        message: 'GEO alert already sent for this time window'
      });
    }
    
    const alert = await analytics.generateGeoAlert();
    
    if (alert) {
      await sendTextNotifications(alert);
      
      // Отмечаем, что GEO алерт был отправлен
      sentAlerts.geoAlert.add(geoAlertKey);
      
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
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    const currentHour = utcPlus1.getUTCHours();
    
    // Защита от спама: не отправляем Creative алерт чаще чем раз в час
    const creativeAlertKey = `creative_${today}_${currentHour}`;
    
    if (sentAlerts.creativeAlert && sentAlerts.creativeAlert.has(creativeAlertKey)) {
      logger.info('🎨 Creative alert already sent for this hour, skipping');
      return res.json({
        success: true,
        message: 'Creative alert already sent for this hour'
      });
    }
    
    const alert = await analytics.generateCreativeAlert();
    
    if (alert) {
      await sendTextNotifications(alert);
      
      // Отмечаем, что Creative алерт был отправлен
      sentAlerts.creativeAlert.add(creativeAlertKey);
      
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

// Alert history endpoint
app.get('/api/alerts/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const type = req.query.type; // filter by type
  
  let filtered = alertHistory;
  
  if (type) {
    filtered = alertHistory.filter(entry => entry.type === type);
  }
  
  res.json({
    success: true,
    message: 'Alert history',
    total: filtered.length,
    history: filtered.slice(0, limit)
  });
});

// Alert dashboard endpoint
app.get('/api/alerts/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    const currentHour = utcPlus1.getUTCHours();
    
    // Какие алерты уже отправлены сегодня
    const alertStatus = {
      today: today,
      currentTime: utcPlus1.toISOString(),
      sentToday: {
        dailyStats: sentAlerts.dailyStats.has(today),
        creativeAlertMorning: sentAlerts.creativeAlert.has(`${today}_10`),
        creativeAlertEvening: sentAlerts.creativeAlert.has(`${today}_22`),
        geoAlerts: Array.from(sentAlerts.dailyStats).filter(d => d === today).length
      },
      upcoming: {
        nextDailyStats: currentHour < 7 ? 'Today at 7:00 UTC+1' : 'Tomorrow at 7:00 UTC+1',
        nextCreativeAlert: currentHour < 10 ? 'Today at 10:00 UTC+1' : 
                          currentHour < 22 ? 'Today at 22:00 UTC+1' : 
                          'Tomorrow at 10:00 UTC+1',
        nextWeeklyReport: 'Next Monday at 9:00 UTC+1'
      },
      memoryStatus: {
        dailyStatsCache: sentAlerts.dailyStats.size,
        creativeAlertCache: sentAlerts.creativeAlert.size,
        weeklyReportCache: sentAlerts.weeklyReport.size
      }
      
    };
    
    res.json({
      success: true,
      message: 'Alert dashboard status',
      ...alertStatus
    });
    
  } catch (error) {
    logger.error('Error getting alert dashboard', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Smart alerts endpoint
app.get('/api/smart-alerts', async (req, res) => {
  try {
    const results = await smartAlerts.runAllChecks();
    
    res.json({
      success: true,
      message: 'Smart alerts check completed',
      results,
      alertsSent: Object.values(results).filter(Boolean).length
    });
    
  } catch (error) {
    logger.error('Error running smart alerts', error);
    res.status(500).json({
      success: false,
      message: 'Smart alerts failed',
      error: error.message
    });
  }
});

// Alert cooldown stats endpoint
app.get('/api/alerts/cooldown-stats', (req, res) => {
  try {
    const stats = alertCooldown.getStats();
    
    res.json({
      success: true,
      message: 'Alert cooldown statistics',
      stats,
      config: {
        cooldownMinutes: alertConfig.cooldownMinutes
      }
    });
  } catch (error) {
    logger.error('Error getting cooldown stats', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Performance monitor stats endpoint
app.get('/api/performance-stats', (req, res) => {
  try {
    const stats = performanceMonitor.getStats();
    
    res.json({
      success: true,
      message: 'Performance monitoring statistics',
      ...stats
    });
  } catch (error) {
    logger.error('Error getting performance stats', error);
    res.status(500).json({
      success: false,
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

// Check last Google Sheets entries
app.get('/api/last-sheets-entries', async (req, res) => {
  try {
    const allRows = await googleSheets.getAllRows();
    
    // Get last 5 rows
    const lastRows = allRows.slice(-5);
    
    const formattedRows = lastRows.map(row => ({
      rowNumber: row.rowNumber,
      customerId: row.get('Customer ID'),
      currency: row.get('Currency'),
      status: row.get('Status'),
      paymentStatus: row.get('Payment Status'),
      totalAmount: row.get('Total Amount'),
      email: row.get('Email'),
      createdUTC: row.get('Created UTC'),
      createdLocal: row.get('Created Local (UTC+1)')
    }));
    
    res.json({
      success: true,
      message: `Found ${formattedRows.length} last Google Sheets entries`,
      count: formattedRows.length,
      entries: formattedRows
    });
    
  } catch (error) {
    logger.error('Error fetching last Google Sheets entries', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch last Google Sheets entries',
      error: error.message
    });
  }
});

// Check Google Sheets structure
app.get('/api/sheets-structure', async (req, res) => {
  try {
    const allRows = await googleSheets.getAllRows();
    
    if (allRows.length === 0) {
      return res.json({
        success: true,
        message: 'No rows found in Google Sheets',
        columns: []
      });
    }
    
    // Get the first row to see all available columns
    const firstRow = allRows[0];
    const columns = [];
    
    // Get all properties from the row object
    for (const key in firstRow._rawData) {
      if (firstRow._rawData.hasOwnProperty(key)) {
        columns.push({
          name: key,
          value: firstRow._rawData[key],
          sampleValue: firstRow.get(key)
        });
      }
    }
    
    res.json({
      success: true,
      message: `Found ${columns.length} columns in Google Sheets`,
      totalRows: allRows.length,
      columns: columns
    });
    
  } catch (error) {
    logger.error('Error fetching Google Sheets structure', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Google Sheets structure',
      error: error.message
    });
  }
});

// Test formatPaymentForSheets function
app.get('/api/test-format', async (req, res) => {
  try {
    // Get a recent payment from Stripe
    const payments = await getRecentPayments(1);
    if (payments.length === 0) {
      return res.json({
        success: false,
        message: 'No payments found in Stripe'
      });
    }
    
    const payment = payments[0];
    const customer = await getCustomer(payment.customer);
    
    // Test the formatPaymentForSheets function
    const formattedData = formatPaymentForSheets(payment, customer);
    
    res.json({
      success: true,
      message: 'formatPaymentForSheets test completed',
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        customer: payment.customer
      },
      customer: {
        id: customer?.id,
        email: customer?.email
      },
      formattedData: formattedData
    });
    
  } catch (error) {
    logger.error('Error testing formatPaymentForSheets', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test formatPaymentForSheets',
      error: error.message
    });
  }
});

// Add missing columns to Google Sheets
app.post('/api/add-missing-columns', async (req, res) => {
  try {
    logger.info('🔧 Adding missing columns to Google Sheets...');
    
    // Get the sheet
    await googleSheets.initialize();
    const sheet = googleSheets.sheet;
    
    // Define the missing columns we need to add
    const missingColumns = [
      'Currency',
      'Status', 
      'UTM Source',
      'UTM Medium',
      'UTM Campaign',
      'UTM Content',
      'UTM Term',
      'Payment Status'
    ];
    
    // Get current header row
    const headerRow = await sheet.getRows({ limit: 1 });
    const currentHeaders = headerRow.length > 0 ? Object.keys(headerRow[0]._rawData) : [];
    
    logger.info('Current headers:', currentHeaders);
    
    // Find missing columns
    const columnsToAdd = missingColumns.filter(col => !currentHeaders.includes(col));
    
    if (columnsToAdd.length === 0) {
      return res.json({
        success: true,
        message: 'All required columns already exist',
        existingColumns: currentHeaders,
        missingColumns: []
      });
    }
    
    logger.info('Adding missing columns:', columnsToAdd);
    
    // Add missing columns by updating the header row
    const headerData = {};
    columnsToAdd.forEach(col => {
      headerData[col] = col; // Set header name as initial value
    });
    
    // Update the first row (header row) with new columns
    if (headerRow.length > 0) {
      const firstRow = headerRow[0];
      Object.keys(headerData).forEach(key => {
        firstRow.set(key, headerData[key]);
      });
      await firstRow.save();
    }
    
    logger.info('✅ Successfully added missing columns to Google Sheets');
    
    res.json({
      success: true,
      message: `Added ${columnsToAdd.length} missing columns`,
      addedColumns: columnsToAdd,
      allColumns: [...currentHeaders, ...columnsToAdd]
    });
    
  } catch (error) {
    logger.error('Error adding missing columns', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add missing columns',
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
    const batchUpdates = [];
    
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      if (!customerId || customerId === 'N/A') continue;
      
      logger.info(`Checking customer: ${email} (${customerId})`);
      
      // Get customer data from Stripe
      const customer = await fetchWithRetry(() => getCustomer(customerId));
      if (!customer) {
        logger.warn(`Customer not found in Stripe: ${customerId}`);
        continue;
      }
      
      // Get customer's payments to find metadata
      const payments = await fetchWithRetry(() => getCustomerPayments(customerId));
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
        logger.info(`Marking for update: ${email}`, {
          adName: `${currentAdName} → ${newAdName}`,
          adsetName: `${currentAdsetName} → ${newAdsetName}`,
          campaignName: `${currentCampaignName} → ${newCampaignName}`,
          creativeLink: `${currentCreativeLink} → ${newCreativeLink}`
        });
        
        // Add to batch updates
        batchUpdates.push({
          row: row,
          data: {
            'Ad Name': newAdName,
            'Adset Name': newAdsetName,
            'Campaign Name': newCampaignName,
            'Creative Link': newCreativeLink
          }
        });
        
        fixedCount++;
      }
    }
    
    // Execute batch updates
    if (batchUpdates.length > 0) {
      logger.info(`Executing batch updates for ${batchUpdates.length} rows`);
      
      const updateResults = await fetchWithRetry(() => googleSheets.batchUpdate(batchUpdates));
      const successCount = updateResults.filter(r => r.success).length;
      const failureCount = updateResults.filter(r => !r.success).length;
      
      logger.info('Batch update results', {
        total: batchUpdates.length,
        success: successCount,
        failures: failureCount
      });
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
    const sheetRows = await fetchWithRetry(() => googleSheets.findRows({ 'Customer ID': customerId }));
    
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

// Sync diagnostics endpoint
app.get('/api/sync-diagnostics', async (req, res) => {
  try {
    const now = Date.now();
    const lockStats = distributedLock.getStats();
    const activeSyncLock = distributedLock.getActiveLocks()
      .find(lock => lock.key === 'sync_operation');
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      sync: {
        isSyncing: isSyncing,
        syncInterval: syncInterval ? 'active' : 'inactive',
        emergencyStop: emergencyStop
      },
      locks: {
        activeLocks: lockStats.activeLocks,
        syncLockActive: !!activeSyncLock,
        syncLockDetails: activeSyncLock || null
      },
      intervals: {
        sync: !!syncInterval,
        geoAlert: !!geoAlertInterval,
        dailyStats: !!dailyStatsInterval,
        creativeAlert: !!creativeAlertInterval,
        weeklyReport: !!weeklyReportInterval,
        campaignAnalysis: !!campaignAnalysisInterval
      },
      cache: {
        purchases: purchaseCache.size(),
        duplicateChecker: duplicateChecker.getStats()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Force unlock sync endpoint
app.post('/api/force-unlock-sync', async (req, res) => {
  try {
    // Очистка всех sync locks
    const released = distributedLock.forceRelease('sync_operation');
    
    // Сброс флага isSyncing
    isSyncing = false;
    
    // Очистка customer locks
    syncLock.clear();
    
    logger.info('🔓 Force unlocked all sync operations', {
      syncOperationReleased: released,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'All sync locks forcefully released',
      released: {
        syncOperation: released,
        customerLocks: 'cleared',
        isSyncing: false
      }
    });
  } catch (error) {
    logger.error('Error force unlocking', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Force sync endpoint - принудительный запуск синхронизации
app.post('/api/force-sync', async (req, res) => {
  try {
    logger.info('🔄 Force sync requested...');
    
    // Сбрасываем флаг синхронизации если он застрял
    if (isSyncing) {
      logger.warn('⚠️ Sync was stuck, resetting...');
      isSyncing = false;
      distributedLock.forceRelease('sync_operation');
    }
    
    const result = await runSync();
    
    res.json({
      success: true,
      message: 'Force sync completed',
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error in force sync', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Restart automatic sync endpoint
app.post('/api/restart-auto-sync', async (req, res) => {
  try {
    logger.info('🔄 Restarting automatic sync...');
    
    // Очищаем все блокировки
    isSyncing = false;
    distributedLock.forceRelease('sync_operation');
    syncLock.clear();
    
    // Сбрасываем время последней синхронизации
    global.lastSyncTime = 0;
    
    // Запускаем синхронизацию сразу
    const result = await runSync();
    
    res.json({
      success: true,
      message: 'Automatic sync restarted',
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error restarting auto sync', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check intervals status endpoint
app.get('/api/intervals-status', (req, res) => {
  try {
    const now = Date.now();
    const lastSync = global.lastSyncTime || 0;
    const timeSinceLastSync = now - lastSync;
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      intervals: {
        sync: !!syncInterval,
        geoAlert: !!geoAlertInterval,
        dailyStats: !!dailyStatsInterval,
        creativeAlert: !!creativeAlertInterval,
        weeklyReport: !!weeklyReportInterval,
        campaignAnalysis: !!campaignAnalysisInterval
      },
      syncStatus: {
        isSyncing: isSyncing,
        lastSyncTime: lastSync ? new Date(lastSync).toISOString() : null,
        timeSinceLastSync: timeSinceLastSync,
        timeSinceLastSyncMinutes: Math.round(timeSinceLastSync / 60000),
        syncIntervalMinutes: alertConfig.syncInterval,
        shouldHaveRun: timeSinceLastSync > (alertConfig.syncInterval * 60 * 1000)
      },
      emergencyStop: emergencyStop
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test notification endpoint
app.post('/api/test-notification', async (req, res) => {
  try {
    logger.info('🧪 Testing notification system...');
    
    // Create a test notification
    const testMessage = `🧪 TEST NOTIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Amount: $9.99
👤 Customer: test@example.com
🆔 ID: cus_test123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Notification system is working!`;
    
    // Add to notification queue
    await notificationQueue.add({
      type: 'test',
      channel: 'telegram',
      message: testMessage,
      metadata: { 
        test: true,
        timestamp: new Date().toISOString()
      }
    });
    
    res.json({
      success: true,
      message: 'Test notification added to queue',
      queueSize: notificationQueue.getStats().queueSize
    });
  } catch (error) {
    logger.error('Error testing notification', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check recent Stripe payments endpoint
app.get('/api/check-recent-payments', async (req, res) => {
  try {
    logger.info('🔍 Checking recent Stripe payments...');
    
    // Get recent payments from Stripe
    const payments = await getRecentPayments(50);
    
    // Filter successful payments
    const successfulPayments = payments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (p.description && p.description.toLowerCase().includes('subscription update')) {
        return false;
      }
      return true;
    });
    
    // Check which ones are in cache
    const paymentsWithStatus = successfulPayments.map(payment => {
      const inCache = purchaseCache.has(payment.id);
      const inDuplicateChecker = duplicateChecker.paymentIntentExists(payment.id).exists;
      
      return {
        id: payment.id,
        amount: payment.amount,
        customer: payment.customer,
        created: new Date(payment.created * 1000).toISOString(),
        inPurchaseCache: inCache,
        inDuplicateChecker: inDuplicateChecker,
        shouldBeProcessed: !inCache && !inDuplicateChecker
      };
    });
    
    const shouldBeProcessed = paymentsWithStatus.filter(p => p.shouldBeProcessed);
    
    res.json({
      success: true,
      message: `Found ${successfulPayments.length} successful payments`,
      totalPayments: successfulPayments.length,
      shouldBeProcessed: shouldBeProcessed.length,
      payments: paymentsWithStatus.slice(0, 10), // Show first 10
      shouldBeProcessedList: shouldBeProcessed.slice(0, 5) // Show first 5 that should be processed
    });
    
  } catch (error) {
    logger.error('Error checking recent payments', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check for missed alerts function
async function checkMissedAlerts() {
  if (emergencyStop) {
    logger.warn('⛔ Missed alerts check blocked by emergency stop');
    return;
  }
  
  const now = new Date();
  const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
  const currentHour = utcPlus1.getUTCHours();
  const currentMinute = utcPlus1.getUTCMinutes();
  const today = utcPlus1.toISOString().split('T')[0];
  
  // Проверяем Daily Stats только если мы в правильном временном окне (7:00-7:05 UTC+1)
  // и только если это не первый запуск в течение дня
  if (currentHour === alertConfig.dailyStatsHour && currentMinute <= 5 && !sentAlerts.dailyStats.has(today)) {
    logger.info('📊 Sending missed daily stats alert...');
    try {
      // ✅ ПРЯМОЙ ВЫЗОВ ВМЕСТО FETCH
      const stats = await analytics.generateDailyStats();
      if (stats) {
        await sendTextNotifications(stats);
        sentAlerts.dailyStats.add(today);
        logger.info('✅ Missed daily stats sent successfully');
      }
    } catch (error) {
      logger.error('❌ Failed to send missed daily stats:', error.message);
    }
  } else if (currentHour > alertConfig.dailyStatsHour && !sentAlerts.dailyStats.has(today)) {
    // Если уже позже 7:00 и daily stats не отправлен, логируем но не отправляем
    logger.info('📊 Daily stats already missed for today, will not send late report', {
      currentHour,
      dailyStatsHour: alertConfig.dailyStatsHour,
      today
    });
  }
  
  // GEO Alert будет отправлен через scheduleGeoAlert (через 30 секунд)
  // Не отправляем здесь, чтобы избежать дублирования
  
  // Проверяем Creative Alert (должен отправиться в настроенное время)
  if (currentHour >= alertConfig.creativeAlertHours[0] && currentHour < alertConfig.creativeAlertHours[1]) {
    const morning = `${today}_${alertConfig.creativeAlertHours[0]}`;
    if (!sentAlerts.creativeAlert.has(morning)) {
      logger.info('🎨 Sending missed morning creative alert...');
      try {
        // ✅ ПРЯМОЙ ВЫЗОВ ВМЕСТО FETCH
        const alert = await analytics.generateCreativeAlert();
        if (alert) {
          await sendTextNotifications(alert);
          sentAlerts.creativeAlert.add(morning);
          logger.info('✅ Missed morning creative alert sent');
        }
      } catch (error) {
        logger.error('❌ Failed to send missed creative alert:', error.message);
      }
    }
  }
}

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
      console.log(`✅ Loaded ${purchaseCache.size()} existing purchases into memory`);
    } catch (error) {
      console.error('❌ Failed to load existing purchases:', error.message);
    }
  }, 5000); // Load after 5 seconds

  // Загрузка кэша дубликатов при старте
  setTimeout(async () => {
    try {
      console.log('🔍 Initializing duplicate checker cache...');
      await duplicateChecker.refreshCache();
      console.log(`✅ Duplicate checker ready with ${duplicateChecker.getStats().customersInCache} customers`);
    } catch (error) {
      console.error('❌ Failed to initialize duplicate checker:', error.message);
    }
  }, 7000); // После загрузки existing purchases

  // Автоматическое обновление кэша каждые 5 минут
  setInterval(async () => {
    try {
      if (duplicateChecker.isCacheStale()) {
        console.log('🔄 Refreshing duplicate checker cache...');
        await duplicateChecker.refreshCache();
      }
    } catch (error) {
      console.error('❌ Failed to refresh duplicate cache:', error.message);
    }
  }, 5 * 60 * 1000);

  // Автоматическая проверка и исправление дубликатов каждый день в 3:00 UTC+1
  setInterval(async () => {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const hour = utcPlus1.getUTCHours();
    const minute = utcPlus1.getUTCMinutes();
    
    if (hour === 3 && minute >= 0 && minute <= 5) {
      const today = utcPlus1.toISOString().split('T')[0];
      
      if (!sentAlerts.duplicateCheck.has(today)) {
        try {
          console.log('🔍 Running automatic duplicate check...');
          
          const duplicates = await duplicateChecker.findAllDuplicates();
          
          if (duplicates.duplicatesFound > 0) {
            console.log(`⚠️ Found ${duplicates.duplicatesFound} duplicates, fixing...`);
            
            // ✅ ПРЯМОЙ ВЫЗОВ ВМЕСТО FETCH - используем уже существующую логику
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
            
            // Remove duplicates
            for (const [customerId, customerRows] of customerMap) {
              if (customerRows.length > 1) {
                console.log(`Found ${customerRows.length} duplicates for customer ${customerId}`);
                for (let i = 1; i < customerRows.length; i++) {
                  await googleSheets.deleteRow(customerRows[i].rowNumber);
                  duplicatesRemoved++;
                }
              }
            }
            
            if (duplicatesRemoved > 0) {
              const alert = `🔧 AUTOMATIC DUPLICATE CLEANUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Fixed: ${customerMap.size} customers
🗑️ Deleted: ${duplicatesRemoved} rows
📅 ${new Date().toLocaleDateString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
              
              await sendTextNotifications(alert);
              
              // Refresh caches
              await Promise.all([
                duplicateChecker.refreshCache(),
                purchaseCache.reload()
              ]);
            }
          }
          
          sentAlerts.duplicateCheck.add(today);
        } catch (error) {
          console.error('❌ Automatic duplicate check failed:', error.message);
        }
      }
    }
  }, 5 * 60 * 1000);

  // Check for missed alerts on startup
  setTimeout(async () => {
    try {
      console.log('🔍 Checking for missed alerts...');
      await checkMissedAlerts();
    } catch (error) {
      console.error('❌ Failed to check missed alerts:', error.message);
    }
  }, 10000); // После 10 секунд

  // Start automatic synchronization
  if (!ENV.AUTO_SYNC_DISABLED) {
    console.log('🔄 Starting automatic sync every 5 minutes...');
    
    // First sync after 30 seconds - use direct function call instead of HTTP
    setTimeout(async () => {
      try {
        console.log('🚀 Running initial sync...');
        const result = await runSync();
        if (result.success) {
          console.log(`✅ Initial sync completed: ${result.processed || 0} payments processed`);
        } else {
          console.log(`⚠️ Initial sync skipped: ${result.message}`);
        }
      } catch (error) {
        console.error('❌ Initial sync failed:', error.message);
      }
    }, 30000);
    
    // Then every 5 minutes - более надежная система
    syncInterval = setInterval(async () => {
      try {
        console.log('🔄 Running scheduled sync...');
        const result = await runSync();
        if (result.success) {
          console.log(`✅ Scheduled sync completed: ${result.total_payments || 0} payments processed`);
        } else {
          console.log(`⚠️ Scheduled sync skipped: ${result.message}`);
        }
      } catch (error) {
        console.error('❌ Scheduled sync failed:', error.message);
      }
    }, alertConfig.syncInterval * 60 * 1000); // Configurable sync interval
    
    // Дополнительная система проверки каждую минуту (fallback)
    const syncCheckInterval = setInterval(async () => {
      const now = Date.now();
      const lastSync = global.lastSyncTime || 0;
      const timeSinceLastSync = now - lastSync;
      const syncIntervalMs = alertConfig.syncInterval * 60 * 1000;
      
      // Если прошло больше времени чем интервал синхронизации + 1 минута
      if (timeSinceLastSync > syncIntervalMs + 60000) {
        console.log('🔄 Fallback sync triggered - too much time since last sync');
        try {
          const result = await runSync();
          if (result.success) {
            console.log(`✅ Fallback sync completed: ${result.total_payments || 0} payments processed`);
          }
        } catch (error) {
          console.error('❌ Fallback sync failed:', error.message);
        }
      }
    }, 60000); // Проверяем каждую минуту
    
    // Еще более агрессивная система проверки каждые 30 секунд
    const aggressiveSyncCheck = setInterval(async () => {
      const now = Date.now();
      const lastSync = global.lastSyncTime || 0;
      const timeSinceLastSync = now - lastSync;
      const syncIntervalMs = alertConfig.syncInterval * 60 * 1000;
      
      // Если прошло больше времени чем интервал синхронизации
      if (timeSinceLastSync > syncIntervalMs && !isSyncing) {
        console.log('🔄 Aggressive sync triggered - interval exceeded');
        try {
          const result = await runSync();
          if (result.success) {
            console.log(`✅ Aggressive sync completed: ${result.total_payments || 0} payments processed`);
          }
        } catch (error) {
          console.error('❌ Aggressive sync failed:', error.message);
        }
      }
    }, 30000); // Проверяем каждые 30 секунд
    
    // Автоматическая очистка дубликатов каждые 30 минут
    const duplicateCleanupInterval = setInterval(async () => {
      try {
        console.log('🧹 Running automatic duplicate cleanup...');
        // Используем прямой вызов функции вместо HTTP запроса
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
        
        // Remove duplicates
        for (const [customerId, customerRows] of customerMap) {
          if (customerRows.length > 1) {
            console.log(`Found ${customerRows.length} duplicates for customer ${customerId}`);
            for (let i = 1; i < customerRows.length; i++) {
              await googleSheets.deleteRow(customerRows[i].rowNumber);
              duplicatesRemoved++;
            }
          }
        }
        
        if (duplicatesRemoved > 0) {
          console.log(`✅ Automatic cleanup completed: removed ${duplicatesRemoved} duplicate rows`);
          // Refresh caches
          await Promise.all([
            duplicateChecker.refreshCache(),
            purchaseCache.reload()
          ]);
        }
      } catch (error) {
        console.error('❌ Automatic duplicate cleanup failed:', error.message);
      }
    }, 30 * 60 * 1000); // Каждые 30 минут
    
    // GEO Alert every hour (scheduled only, no initial run)
    const scheduleGeoAlert = () => {
      console.log('🌍 Starting hourly GEO alerts...');
      
      geoAlertInterval = setInterval(async () => {
        try {
          const now = new Date();
          const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
          const today = utcPlus1.toISOString().split('T')[0];
          const currentHour = utcPlus1.getUTCHours();
          const currentMinute = utcPlus1.getUTCMinutes();
          
          const geoAlertKey = `geo_${today}_${currentHour}_${Math.floor(currentMinute / 30)}`;
          
          if (!sentAlerts.geoAlert || !sentAlerts.geoAlert.has(geoAlertKey)) {
            console.log('🌍 Running scheduled GEO alert...');
            // ✅ ПРЯМОЙ ВЫЗОВ
            const alert = await analytics.generateGeoAlert();
            if (alert) {
              await sendTextNotifications(alert);
              sentAlerts.geoAlert.add(geoAlertKey);
              console.log('✅ GEO alert completed');
            }
          }
        } catch (error) {
          console.error('❌ GEO alert failed:', error.message);
        }
      }, alertConfig.geoAlertInterval * 60 * 60 * 1000);
    };
    
    // Weekly Report every Monday at 9 AM UTC+1 (8 AM UTC)
    const scheduleWeeklyReport = () => {
      const now = new Date();
      const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
      const currentDay = utcPlus1.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const currentHour = utcPlus1.getUTCHours();
      
      // Calculate next Monday
      const daysUntilMonday = (1 + 7 - currentDay) % 7;
      const nextMonday = new Date(utcPlus1);
      nextMonday.setDate(utcPlus1.getDate() + daysUntilMonday);
      nextMonday.setHours(8, 0, 0, 0); // 9 AM UTC+1 = 8 AM UTC
      
      // If today is Monday and it's past 9 AM UTC+1, schedule for next Monday
      if (currentDay === 1 && currentHour >= 9) {
        nextMonday.setDate(nextMonday.getDate() + 7);
      }
      
      const timeUntilMonday = nextMonday.getTime() - utcPlus1.getTime();
      
      console.log(`📊 Weekly Report scheduled for: ${nextMonday.toLocaleString('en-US', { timeZone: 'Europe/Berlin' })} (UTC+1)`);
      
      setTimeout(async () => {
        const now = new Date();
        const utcPlus1Now = new Date(now.getTime() + 60 * 60 * 1000);
        const weekKey = utcPlus1Now.toISOString().split('T')[0]; // YYYY-MM-DD
        
        if (!sentAlerts.weeklyReport.has(weekKey)) {
          try {
            console.log('📊 Running weekly report...');
            // ✅ ПРЯМОЙ ВЫЗОВ ВМЕСТО FETCH
            const report = await analytics.generateWeeklyReport();
            if (report) {
              await sendTextNotifications(report);
              console.log('✅ Weekly report completed');
              sentAlerts.weeklyReport.add(weekKey);
            }
          } catch (error) {
            console.error('❌ Weekly report failed:', error.message);
          }
        }
      }, timeUntilMonday);
      
      // Schedule weekly interval after first run
      setTimeout(() => {
        weeklyReportInterval = setInterval(async () => {
          const now = new Date();
          const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
          const weekKey = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
          
          if (!sentAlerts.weeklyReport.has(weekKey)) {
            try {
              console.log('📊 Running weekly report...');
              // ✅ ПРЯМОЙ ВЫЗОВ ВМЕСТО FETCH
              const report = await analytics.generateWeeklyReport();
              if (report) {
                await sendTextNotifications(report);
                console.log('✅ Weekly report completed');
                sentAlerts.weeklyReport.add(weekKey);
              }
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
      
      dailyStatsInterval = setInterval(async () => {
        const now = new Date();
        const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
        const hour = utcPlus1.getUTCHours();
        const minute = utcPlus1.getUTCMinutes();
        
        if (hour === alertConfig.dailyStatsHour && minute >= 0 && minute <= 1) {
          const today = utcPlus1.toISOString().split('T')[0];
          if (!sentAlerts.dailyStats.has(today)) {
            try {
              console.log('📊 Running daily stats alert...');
              // ✅ ПРЯМОЙ ВЫЗОВ ВМЕСТО FETCH
              const stats = await analytics.generateDailyStats();
              if (stats) {
                await sendTextNotifications(stats);
                sentAlerts.dailyStats.add(today);
                console.log('✅ Daily stats completed');
              }
            } catch (error) {
              console.error('❌ Daily stats failed:', error.message);
            }
          }
        }
      }, 60 * 1000);
    };
    
    // Creative Alert at 10:00 and 22:00 UTC+1
    const scheduleCreativeAlert = () => {
      console.log('🎨 Starting creative alerts...');
      
      creativeAlertInterval = setInterval(async () => {
        const now = new Date();
        const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
        const hour = utcPlus1.getUTCHours();
        const minute = utcPlus1.getUTCMinutes();
        
        if ((hour === 10 && minute >= 0 && minute <= 2) || 
            (hour === 22 && minute >= 0 && minute <= 2)) {
          const today = utcPlus1.toISOString().split('T')[0];
          const alertKey = `${today}_${hour}`;
          if (!sentAlerts.creativeAlert.has(alertKey)) {
            try {
              console.log('🎨 Running creative alert...');
              // ✅ ПРЯМОЙ ВЫЗОВ
              const alert = await analytics.generateCreativeAlert();
              if (alert) {
                await sendTextNotifications(alert);
                sentAlerts.creativeAlert.add(alertKey);
                console.log('✅ Creative alert completed');
              }
            } catch (error) {
              console.error('❌ Creative alert failed:', error.message);
            }
          }
        }
      }, 2 * 60 * 1000);
    };
    
    // Campaign Analysis at 11:00 UTC+1 (after creative alert)
    const scheduleCampaignAnalysis = () => {
      console.log('📊 Starting campaign analysis...');
      
      // Check every 2 minutes for 11:00 UTC+1
      campaignAnalysisInterval = setInterval(async () => {
        const now = new Date();
        const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
        const hour = utcPlus1.getUTCHours();
        const minute = utcPlus1.getUTCMinutes();
        
        // Check for 11:00 UTC+1 (with ±2 minutes tolerance)
        if (hour === 11 && minute >= 0 && minute <= 2) {
          const today = utcPlus1.toISOString().split('T')[0];
          
          if (!sentAlerts.campaignAnalysis || !sentAlerts.campaignAnalysis.has(today)) {
            try {
              console.log('📊 Running campaign analysis...');
              const result = await campaignAnalyzer.sendDailyReport();
              
              if (result) {
                sentAlerts.campaignAnalysis.add(today);
                console.log('✅ Campaign analysis completed and sent');
              } else {
                console.log('ℹ️ No actionable recommendations found');
              }
            } catch (error) {
              console.error('❌ Campaign analysis failed:', error.message);
            }
          }
        }
      }, 2 * 60 * 1000); // Check every 2 minutes
    };
    
    // Campaign Analysis Report every day at 16:00 UTC+1
    const scheduleCampaignReport = () => {
      console.log('📊 Starting campaign analysis reports...');
      
      // Check every 5 minutes for 16:00 UTC+1
      campaignReportInterval = setInterval(async () => {
        const now = new Date();
        const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
        const hour = utcPlus1.getUTCHours();
        const minute = utcPlus1.getUTCMinutes();
        
        // Check for 16:00 UTC+1 (with ±5 minutes tolerance)
        if (hour === 16 && minute >= 0 && minute <= 5) {
          const today = utcPlus1.toISOString().split('T')[0];
          const alertKey = `campaign_report_${today}`;
          
          if (!sentAlerts.campaignAnalysis || !sentAlerts.campaignAnalysis.has(alertKey)) {
            try {
              console.log('📊 Running daily campaign analysis...');
              const result = await campaignAnalyzer.sendDailyReport();
              
              if (result) {
                sentAlerts.campaignAnalysis.add(alertKey);
                console.log('✅ Campaign analysis completed');
              } else {
                console.log('ℹ️ No actionable recommendations found');
              }
            } catch (error) {
              console.error('❌ Campaign analysis failed:', error.message);
            }
          }
        }
      }, 5 * 60 * 1000); // 5 minutes
    };
    
    // Start all alert scheduling
    scheduleGeoAlert();
    scheduleWeeklyReport();
    scheduleDailyStats();
    scheduleCreativeAlert();
    scheduleCampaignAnalysis();
    scheduleCampaignReport();
    
    // Start automatic alert cleanup (every 24 hours)
    alertCleanupInterval = setInterval(cleanOldAlerts, 24 * 60 * 60 * 1000);
    
    // Run initial cleanup after 10 seconds
    setTimeout(cleanOldAlerts, 10000);
    
    console.log('🤖 AUTOMATIC SYSTEM ENABLED:');
    console.log('   ✅ Checks Stripe every 5 minutes');
    console.log('   ✅ Adds new purchases to Google Sheets');
    console.log('   ✅ Sends notifications to Telegram and Slack');
    console.log('   ✅ GEO alerts every hour (scheduled only)');
    console.log('   ✅ Daily stats every morning at 7:00 UTC+1');
    console.log('   ✅ Creative alerts at 10:00 and 22:00 UTC+1');
    console.log('   ✅ Campaign analysis at 11:00 UTC+1');
    console.log('   ✅ Campaign reports at 16:00 UTC+1');
    console.log('   ✅ Weekly reports every Monday at 9 AM UTC+1');
    console.log('   ✅ Automatic memory cleanup every 24 hours');
    console.log('   ✅ Works WITHOUT manual intervention');
  } else {
    console.log('⏸️ Automatic sync is DISABLED (AUTO_SYNC_DISABLED=true)');
  }
});

// Graceful shutdown handling

// Graceful shutdown function
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`, {
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
  
  try {
    // Stop all intervals
    if (syncInterval) {
      clearInterval(syncInterval);
      logger.info('Stopped sync interval');
    }
    
    if (geoAlertInterval) {
      clearInterval(geoAlertInterval);
      logger.info('Stopped GEO alert interval');
    }
    
    if (dailyStatsInterval) {
      clearInterval(dailyStatsInterval);
      logger.info('Stopped daily stats interval');
    }
    
    if (creativeAlertInterval) {
      clearInterval(creativeAlertInterval);
      logger.info('Stopped creative alert interval');
    }
    
    if (weeklyReportInterval) {
      clearInterval(weeklyReportInterval);
      logger.info('Stopped weekly report interval');
    }
    
    if (campaignAnalysisInterval) {
      clearInterval(campaignAnalysisInterval);
      logger.info('Stopped campaign analysis interval');
    }
    
    if (campaignReportInterval) {
      clearInterval(campaignReportInterval);
      logger.info('Stopped campaign report interval');
    }
    
    if (alertCleanupInterval) {
      clearInterval(alertCleanupInterval);
      logger.info('Stopped alert cleanup interval');
    }
    
    // Clear any pending timeouts
    // Note: We can't easily track all setTimeout calls, but this is a start
    
    // Close any database connections if they exist
    // await googleSheets.disconnect(); // Uncomment if disconnect method exists
    
    // Final cleanup
    logger.info('Graceful shutdown completed', {
      timestamp: new Date().toISOString(),
      finalUptime: process.uptime()
    });
    
    // Give a moment for logs to flush
    setTimeout(() => {
      process.exit(0);
    }, 1000);
    
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
      logger.error('Forcing exit after graceful shutdown timeout');
      process.exit(1);
    }, 5000);
  }
}

// Handle different shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason,
    promise: promise,
    timestamp: new Date().toISOString()
  });
  
  gracefulShutdown('UNHANDLED_REJECTION');
});

export default app;
