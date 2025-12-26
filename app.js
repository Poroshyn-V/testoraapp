// Refactored Stripe Ops API - Modular Architecture
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { ENV } from './src/config/env.js';
import { logger } from './src/utils/logging.js';
import { rateLimit, getRateLimitStats } from './src/middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import { getCacheStats } from './src/utils/cache.js';
import { stripe, getRecentPayments, getCustomerPayments, getCustomer, stripeLowPrice, getRecentPaymentsLowPrice, getAllPaymentsLowPrice, getCustomerPaymentsLowPrice, getCustomerLowPrice } from './src/services/stripe.js';
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
import { formatPaymentForSheets, formatPaymentForSheetsLowPrice, formatPaymentForSheetsPrimer, formatTelegramNotification } from './src/utils/formatting.js';
import { getRecentPaymentsPrimer, getAllPaymentsPrimer, getCustomerPaymentsPrimer, getCustomerPrimer, normalizePrimerPayment, isPrimerConfigured } from './src/services/primer.js';
import healthRoutes from './src/routes/health.js';
import { google } from 'googleapis';

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
let hourlyReportInterval = null;
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
          customerEmail: customer.email,
          paymentId: payment.id  // Add paymentId to use same duplicate key as regular notifications
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
  hourlyReport: new Set(),
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
    
    // ✅ Проверяем оперативные алерты после успешной синхронизации
    if (result.success && (result.newPurchases > 0 || result.updatedPurchases > 0)) {
      try {
        const realTimeAlerts = await smartAlerts.checkAllRealTimeAlerts();
        if (realTimeAlerts) {
          await sendTextNotifications(realTimeAlerts);
          logger.info('⚡ Real-time alerts sent after sync', {
            newPurchases: result.newPurchases,
            updatedPurchases: result.updatedPurchases
          });
        }
      } catch (alertError) {
        logger.error('❌ Real-time alerts check failed', {
          error: alertError.message,
          stack: alertError.stack
        });
        // Не прерываем синхронизацию из-за ошибки алертов
      }
    }
    
    // Also sync Low Price account (async, don't wait for it)
    // ✅ КРИТИЧЕСКИ ВАЖНО: Синхронизируем LowPrice с проверкой ВСЕХ существующих клиентов
    performSyncLogicLowPrice().then(async (lowPriceResult) => {
      // ✅ Проверяем оперативные алерты после успешной синхронизации LowPrice
      if (lowPriceResult && lowPriceResult.success && (lowPriceResult.newPurchases > 0 || lowPriceResult.updatedPurchases > 0)) {
        try {
          const realTimeAlerts = await smartAlerts.checkAllRealTimeAlerts();
          if (realTimeAlerts) {
            await sendTextNotifications(realTimeAlerts);
            logger.info('⚡ Real-time alerts sent after LowPrice sync', {
              newPurchases: lowPriceResult.newPurchases,
              updatedPurchases: lowPriceResult.updatedPurchases
            });
          }
        } catch (alertError) {
          logger.error('❌ Real-time alerts check failed after LowPrice sync', {
            error: alertError.message
          });
          // Не прерываем синхронизацию из-за ошибки алертов
        }
      }
    }).catch(error => {
      logger.error('Low Price sync failed', {
        error: error.message,
        stack: error.stack
      });
    });
    
    // ✅ Синхронизация Primer платежей (PayPal) - параллельно с LowPrice
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔄 PRIMER SYNC: Starting Primer payment sync check...', {
      isPrimerConfigured: isPrimerConfigured(),
      hasApiKey: !!ENV.PRIMER_API_KEY,
      apiKeyPrefix: ENV.PRIMER_API_KEY ? `${ENV.PRIMER_API_KEY.substring(0, 10)}...` : 'NOT SET',
      primerSheetName: ENV.PRIMER_SHEET_NAME || 'Primer',
      timestamp: new Date().toISOString()
    });
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // ✅ Явное логирование запуска синхронизации Primer
    if (isPrimerConfigured()) {
      logger.info('✅ PRIMER SYNC: Primer API is configured, proceeding with sync...');
      performSyncLogicPrimer().then(async (primerResult) => {
      logger.info('✅ Primer sync completed', {
        success: primerResult?.success,
        processed: primerResult?.processed || 0,
        newPurchases: primerResult?.newPurchases || 0,
        updatedPurchases: primerResult?.updatedPurchases || 0,
        message: primerResult?.message
      });
      // ✅ Проверяем оперативные алерты после успешной синхронизации Primer
      if (primerResult && primerResult.success && (primerResult.newPurchases > 0 || primerResult.updatedPurchases > 0)) {
        try {
          const realTimeAlerts = await smartAlerts.checkAllRealTimeAlerts();
          if (realTimeAlerts) {
            await sendTextNotifications(realTimeAlerts);
            logger.info('⚡ Real-time alerts sent after Primer sync', {
              newPurchases: primerResult.newPurchases,
              updatedPurchases: primerResult.updatedPurchases
            });
          }
        } catch (alertError) {
          logger.error('❌ Real-time alerts check failed after Primer sync', {
            error: alertError.message
          });
          // Не прерываем синхронизацию из-за ошибки алертов
        }
      }
    }).catch(error => {
      logger.error('❌ PRIMER SYNC: Primer sync failed', {
        error: error.message,
        stack: error.stack
      });
    });
    } else {
      logger.warn('⚠️ PRIMER SYNC: Primer API not configured, skipping sync', {
        hasApiKey: !!ENV.PRIMER_API_KEY,
        primerApiKey: ENV.PRIMER_API_KEY ? `${ENV.PRIMER_API_KEY.substring(0, 10)}...` : 'null'
      });
    }
    
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
    '/api/hourly-report',
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
        // ✅ OPTIMIZATION: Get customer data and payments in parallel (safe - they're independent)
        const [customer, payments] = await Promise.all([
          fetchWithRetry(() => getCustomer(customerId)),
          fetchWithRetry(() => getCustomerPayments(customerId))
        ]);
        
        if (!customer) {
          results.push({
            customerId,
            success: false,
            error: 'Customer not found in Stripe'
          });
          continue;
        }
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
                customerEmail: customer.email,
                paymentId: latestPayment.id  // ✅ Fixed: add paymentId to use same duplicate key as regular notifications
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
        
        // ✅ OPTIMIZATION: Get customer data and payments in parallel (safe - they're independent)
        const [customer, payments] = await Promise.all([
          fetchWithRetry(() => getCustomer(customerId)),
          fetchWithRetry(() => getCustomerPayments(customerId))
        ]);
        
        if (!customer) {
          results.failed++;
          results.errors.push({
            customerId,
            row: row.rowNumber,
            error: 'Customer not found in Stripe'
          });
          continue;
        }
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
        
        // ✅ ОПТИМИЗАЦИЯ: Загружаем customer и payments параллельно (они независимы)
        // Используем Promise.allSettled для надежности - если один запрос упадет, другой все равно выполнится
        const [customerResult, paymentsResult] = await Promise.allSettled([
          fetchWithRetry(() => getCustomer(customerId)),
          fetchWithRetry(() => getCustomerPayments(customerId))
        ]);
        
        // Проверяем результаты
        if (customerResult.status === 'rejected' || paymentsResult.status === 'rejected') {
          results.failed++;
          results.errors.push({
            customerId,
            row: row.rowNumber,
            error: customerResult.status === 'rejected' 
              ? `Customer fetch failed: ${customerResult.reason?.message}`
              : `Payments fetch failed: ${paymentsResult.reason?.message}`
          });
          continue;
        }
        
        const customer = customerResult.value;
        const payments = paymentsResult.value;
        
        if (!customer) {
          results.failed++;
          results.errors.push({
            customerId,
            row: row.rowNumber,
            error: 'Customer not found in Stripe'
          });
          continue;
        }
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

// Force export all payments from Stripe to Google Sheets
app.get('/api/force-export-all', async (req, res) => {
  try {
    logger.info('🚀 Starting force export of all payments to Google Sheets');
    
    // Get all payments from Stripe
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
    
    logger.info(`📊 Found ${allPayments.length} total payments`);
    
    const successfulPayments = allPayments.filter(p => p.status === 'succeeded' && p.customer);
    logger.info(`✅ Found ${successfulPayments.length} successful payments with customers`);
    
    // Group purchases by customer and date
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      const customer = await getCustomer(payment.customer);
      if (!customer) continue;
      
      const customerId = customer.id;
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
    
    logger.info(`📊 Grouped into ${groupedPurchases.size} purchases`);
    
    // Sort by date (oldest first)
    const sortedGroups = Array.from(groupedPurchases.entries()).sort((a, b) => {
      const dateA = new Date(a[1].firstPayment.created * 1000);
      const dateB = new Date(b[1].firstPayment.created * 1000);
      return dateA - dateB;
    });
    
    // Prepare data for export
    const exportData = [
      ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
    ];
    
    for (const [dateKey, group] of sortedGroups) {
      const customer = group.customer;
      const firstPayment = group.firstPayment;
      
      // Format GEO data
      let geoData = 'N/A';
      if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
        geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
      } else if (customer?.metadata?.geo_country) {
        geoData = customer.metadata.geo_country;
      }
      
      const utcTime = new Date(firstPayment.created * 1000).toISOString();
      const localTime = new Date(firstPayment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
      
      const purchaseId = `purchase_${customer.id}_${dateKey.split('_')[1]}`;
      
      const row = [
        purchaseId,
        (group.totalAmount / 100).toFixed(2),
        firstPayment.currency.toUpperCase(),
        'succeeded',
        utcTime,
        localTime,
        customer.id || 'N/A',
        customer.email || 'N/A',
        geoData,
        customer.metadata?.utm_source || 'N/A',
        customer.metadata?.utm_medium || 'N/A',
        customer.metadata?.utm_campaign || 'N/A',
        customer.metadata?.utm_content || 'N/A',
        customer.metadata?.utm_term || 'N/A',
        customer.metadata?.ad_name || 'N/A',
        customer.metadata?.adset_name || 'N/A',
        group.payments.length
      ];
      
      exportData.push(row);
    }
    
    // Use direct Google Sheets API
    // Create JWT token
    const header = { "alg": "RS256", "typ": "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: ENV.GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .replace(/"/g, '');
    
    const signature = crypto.createSign('RSA-SHA256')
      .update(`${encodedHeader}.${encodedPayload}`)
      .sign(privateKey, 'base64url');
    
    const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Get access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Failed to get Google OAuth token: ${errorText}`);
    }
    
    const tokenData = await tokenResponse.json();
    
    // Clear the sheet
    const clearResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ENV.GOOGLE_SHEETS_DOC_ID}/values/A:Z:clear`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (clearResponse.ok) {
      logger.info('🧹 Google Sheets cleared');
    }
    
    // Write all data
    const range = `A1:Q${exportData.length}`;
    const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ENV.GOOGLE_SHEETS_DOC_ID}/values/${range}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: exportData })
    });
    
    if (sheetsResponse.ok) {
      logger.info(`✅ Successfully exported ${exportData.length - 1} purchases to Google Sheets`);
      res.json({
        success: true,
        message: `Exported ${exportData.length - 1} purchases to Google Sheets`,
        totalPayments: allPayments.length,
        successfulPayments: successfulPayments.length,
        groupedPurchases: groupedPurchases.size,
        exportedPurchases: exportData.length - 1,
        sheet_url: `https://docs.google.com/spreadsheets/d/${ENV.GOOGLE_SHEETS_DOC_ID}`
      });
    } else {
      const errorText = await sheetsResponse.text();
      logger.error(`Failed to write to Google Sheets: ${errorText}`);
      res.status(500).json({
        success: false,
        error: 'Failed to write to Google Sheets',
        details: errorText
      });
    }
  } catch (error) {
    logger.error('Error in force export all', error);
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
    
    // ✅ КРИТИЧЕСКИ ВАЖНО: Используем лист "payments" для первого Stripe аккаунта
    const MAIN_SHEET_NAME = ENV.STRIPE_SHEET_NAME || 'payments';
    const mainSheet = await googleSheets.getSheetByName(MAIN_SHEET_NAME);
    await mainSheet.loadHeaderRow();
    
    // ✅ БЛОКИРОВКА УЖЕ ПОЛУЧЕНА В runSync() - не получаем повторно
    // const syncLockId = await distributedLock.acquire('sync_operation', 100, 200);
    
    try {
      // 🔄 КРИТИЧЕСКИ ВАЖНО: Обновляем ВСЕ кэши ПЕРЕД началом
      logger.info('📦 Refreshing ALL caches before sync...');
      await Promise.all([
        duplicateChecker.refreshCache(),
        purchaseCache.reload()
      ]);
    
      // Get recent payments from Stripe (ПЕРВЫЙ аккаунт - W2W)
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
      if (!customerId) {
        logger.warn(`⚠️ Payment ${payment.id} has no customer ID, skipping`);
        results.skipped++;
        continue;
      }
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    logger.info(`👥 Grouped ${newPayments.length} payments into ${customerGroups.size} customer groups`);
      
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
          // ✅ ОПТИМИЗАЦИЯ: Загружаем customer и rows параллельно (они независимы)
          // Используем Promise.allSettled для надежности - если один запрос упадет, другой все равно выполнится
          const [customerResult, rowsResult] = await Promise.allSettled([
            fetchWithRetry(() => getCustomer(customerId)),
            mainSheet.getRows()
          ]);
          
          // Проверяем результаты
          if (customerResult.status === 'rejected') {
            logger.error(`Failed to fetch customer ${customerId}`, { error: customerResult.reason?.message });
            results.failed++;
            results.errors.push({ customerId, error: customerResult.reason?.message });
            continue;
          }
          
          if (rowsResult.status === 'rejected') {
            logger.error(`Failed to fetch rows from sheet`, { error: rowsResult.reason?.message });
            results.failed++;
            results.errors.push({ customerId, error: 'Failed to load sheet rows' });
            continue;
          }
          
          const customer = customerResult.value;
          const allMainRows = rowsResult.value;
          
          if (!customer) {
            logger.warn(`Customer ${customerId} not found in Stripe`);
            results.skipped += payments.length;
            continue;
          }
          
          // Sort payments by creation date
          payments.sort((a, b) => a.created - b.created);
          const firstPayment = payments[0];
          const latestPayment = payments[payments.length - 1];
          
          // ✅ КРИТИЧЕСКИ ВАЖНО: Используем уже загруженные строки
          const existingCustomers = allMainRows.filter(row => row.get('Customer ID') === customerId);
          
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
            
            // Get latest payment for updated timestamp
            const latestPaymentForUpdate = allSuccessfulPayments[allSuccessfulPayments.length - 1];
            const updatedRowData = formatPaymentForSheets(latestPaymentForUpdate, customer);
            
            // ✅ Обновляем строку в листе "payments" напрямую
            await fetchWithRetry(() => 
              existingCustomers[0].save({
                'Purchase ID': `purchase_${customerId}`,
                'Total Amount': (totalAmountAll / 100).toFixed(2),
                'Payment Count': paymentCountAll.toString(),
                'Payment Intent IDs': paymentIdsAll.join(', '),
                'Created UTC': updatedRowData['Created UTC'],
                'Created Local (UTC+1)': updatedRowData['Created Local (UTC+1)'],
                'Created Local (LA Time)': updatedRowData['Created Local (LA Time)']
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
            
            // ❌ УБРАЛИ УВЕДОМЛЕНИЯ ПРИ ОБНОВЛЕНИИ - это вызывало спам!
            // Уведомления отправляются ТОЛЬКО для новых покупок, не для обновлений существующих
            logger.info(`✅ Updated existing customer ${customerId} - no notification sent (to prevent spam)`);
            
            results.updatedPurchases++;
            results.processed++;
            
          } else {
            // ADD NEW customer - load ALL payments from Stripe (including all upsells)
            logger.info(`Adding new customer ${customerId} (loading ALL payments from Stripe)`);
            
            // ✅ КРИТИЧЕСКИ ВАЖНО: Загружаем ВСЕ платежи клиента из Stripe (не только новые из группы)
            // Это гарантирует, что основная покупка + все апселлы будут суммированы вместе
            const allPayments = await fetchWithRetry(() => getCustomerPayments(customerId));
            const allSuccessfulPayments = allPayments.filter(p => {
              if (p.status !== 'succeeded' || !p.customer) return false;
              if (p.description && p.description.toLowerCase().includes('subscription update')) {
                return false;
              }
              return true;
            });
            
            // Сортируем по дате создания (первая покупка)
            allSuccessfulPayments.sort((a, b) => a.created - b.created);
            const firstPayment = allSuccessfulPayments[0];
            
            const rowData = formatPaymentForSheets(firstPayment, customer);
            
            // ✅ Суммируем ВСЕ платежи клиента (основная покупка + все апселлы)
            let totalAmount = 0;
            const paymentIds = [];
            for (const p of allSuccessfulPayments) {
              totalAmount += p.amount;
              paymentIds.push(p.id);
            }
            
            rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
            rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
            rowData['Payment Count'] = allSuccessfulPayments.length.toString();
            rowData['Payment Intent IDs'] = paymentIds.join(', ');
            
            // ✅ КРИТИЧЕСКИ ВАЖНО: Добавляем НАПРЯМУЮ в mainSheet, без использования googleSheets.sheet
            // Проверяем существование напрямую в mainSheet
            const existingInMain = allMainRows.filter(row => {
              const rowCustomerId = row.get('Customer ID');
              return rowCustomerId === customerId;
            });
            
            let addResult;
            if (existingInMain.length > 0) {
              // Клиент уже существует - обновляем
              addResult = {
                success: false,
                exists: true,
                action: 'skipped',
                row: existingInMain[0]
              };
              logger.info(`📊 Customer ${customerId} already exists in payments sheet (row ${existingInMain[0].rowNumber})`);
            } else {
              // Добавляем новую строку НАПРЯМУЮ в mainSheet
              const newRow = await mainSheet.addRow(rowData);
              addResult = {
                success: true,
                exists: false,
                action: 'added',
                row: newRow
              };
              logger.info(`📊 Successfully added customer ${customerId} to payments sheet (row ${newRow.rowNumber})`);
            }
            
            // ✅ КРИТИЧЕСКИ ВАЖНО: Проверяем успешность операции
            if (!addResult.success) {
              // Ошибка при добавлении - НЕ отправляем уведомление
              logger.error(`❌ Failed to add customer ${customerId} to payments sheet`, {
                exists: addResult.exists,
                action: addResult.action,
                reason: addResult.reason
              });
              results.failed++;
              // Пропускаем дальнейшую обработку для этого клиента
            } else if (addResult.exists) {
              // Кто-то добавил строку между нашими проверками!
              logger.warn(`⚠️ Row appeared during atomic add for ${customerId} - converting to update`);
              results.duplicatesAvoided++;
              
              // Обновляем существующую строку (включая время) в листе "payments"
              await fetchWithRetry(() => 
                addResult.row.save({
                  'Total Amount': rowData['Total Amount'],
                  'Payment Count': rowData['Payment Count'],
                  'Payment Intent IDs': rowData['Payment Intent IDs'],
                  'Created UTC': rowData['Created UTC'],
                  'Created Local (UTC+1)': rowData['Created Local (UTC+1)'],
                  'Created Local (LA Time)': rowData['Created Local (LA Time)']
                })
              );
              
              results.updatedPurchases++;
            } else {
              // Успешно добавили - ТОЛЬКО ТЕПЕРЬ отправляем уведомление
              results.newPurchases++;
            }
            
            // ✅ Обновляем ОБЕ системы кэширования СРАЗУ (все платежи клиента)
            for (const paymentId of paymentIds) {
              purchaseCache.add(paymentId);
            }
            duplicateChecker.addToCache(customerId, {
              purchaseId: rowData['Purchase ID'],
              paymentIntentIds: paymentIds,
              totalAmount: rowData['Total Amount'],
              paymentCount: rowData['Payment Count']
            });
            
            logger.info(`✅ Added customer ${customerId} with ALL payments: ${allSuccessfulPayments.length} payments (${payments.length} new + ${allSuccessfulPayments.length - payments.length} existing), total $${rowData['Total Amount']}`);
            
            // Send notification ONLY if successfully added (not if it existed)
            if (!addResult.exists) {
              const sheetData = {
                'Ad Name': rowData['Ad Name'] || 'N/A',
                'Adset Name': rowData['Adset Name'] || 'N/A',
                'Campaign Name': rowData['Campaign Name'] || 'N/A',
                'Creative Link': rowData['Creative Link'] || 'N/A',
                'Total Amount': rowData['Total Amount'],
                'Payment Count': rowData['Payment Count'],
                'Payment Intent IDs': rowData['Payment Intent IDs']
              };
              
              // Send notification via queue (VIP alert will be included if applicable)
              const notificationMessage = await formatTelegramNotification(firstPayment, customer, {
                ...sheetData,
                accountSource: 'W2W' // Main Stripe account (payments sheet)
              });
              const amount = parseFloat(sheetData['Total Amount'] || 0);
              const isVip = amount >= alertConfig.vipPurchaseThreshold;
              
              await notificationQueue.add({
                type: isVip ? 'vip_new_purchase' : 'new_purchase',
                channel: 'telegram',
                message: notificationMessage,
                payment: firstPayment,
                customer: customer,
                sheetData: sheetData,
                metadata: {
                  paymentId: firstPayment.id,
                  customerId: customer.id,
                  amount: sheetData['Total Amount'],
                  type: 'new_purchase',
                  isVip: isVip,
                  accountSource: 'W2W'
                }
              });
            }
            
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

// Helper function to export upsells to separate "LowPrice Upsells" sheet
async function exportUpsellsToSeparateSheet(customerId, customer, allPayments, latestPayment) {
  try {
    const UPSELLS_SHEET_NAME = 'LowPrice Upsells';
    const upsellsSheet = await googleSheets.getSheetByName(UPSELLS_SHEET_NAME);
    
    // Try to load headers, if they don't exist, create them
    try {
      await upsellsSheet.loadHeaderRow();
    } catch (error) {
      // Headers don't exist, create them
      logger.info(`Creating headers for ${UPSELLS_SHEET_NAME} sheet...`);
      const headers = [
        'Customer ID',
        'Email',
        'First Payment Date',
        'Latest Payment Date',
        'Total Payments',
        'Payment Intent IDs',
        'Total Amount',
        'Currency',
        'First Payment Amount',
        'Upsells Count',
        'Upsells Total',
        'Created UTC',
        'Created Local (LA Time)'
      ];
      await upsellsSheet.setHeaderRow(headers);
      logger.info(`Headers created for ${UPSELLS_SHEET_NAME} sheet`);
    }
    
    // Check if customer already exists in upsells sheet
    const existingRows = await upsellsSheet.getRows();
    const existingCustomerRow = existingRows.find(row => {
      const rowCustomerId = row.get('Customer ID');
      return rowCustomerId === customerId;
    });
    
    // Сортируем платежи по дате
    allPayments.sort((a, b) => a.created - b.created);
    const firstPayment = allPayments[0];
    
    // Вычисляем сумму апселлов (все платежи кроме первого)
    let upsellsTotal = 0;
    const upsellsCount = allPayments.length - 1;
    for (let i = 1; i < allPayments.length; i++) {
      upsellsTotal += allPayments[i].amount;
    }
    
    // Суммируем все платежи
    let totalAmount = 0;
    const paymentIds = [];
    for (const p of allPayments) {
      totalAmount += p.amount;
      paymentIds.push(p.id);
    }
    
    // Форматируем данные
    const firstPaymentDate = new Date(firstPayment.created * 1000);
    const latestPaymentDate = new Date(latestPayment.created * 1000);
    
    // Форматируем LA time для последнего платежа
    const laFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const laParts = laFormatter.formatToParts(latestPaymentDate);
    const laYear = laParts.find(p => p.type === 'year').value;
    const laMonth = laParts.find(p => p.type === 'month').value;
    const laDay = laParts.find(p => p.type === 'day').value;
    const laHours = laParts.find(p => p.type === 'hour').value;
    const laMinutes = laParts.find(p => p.type === 'minute').value;
    const laSeconds = laParts.find(p => p.type === 'second').value;
    const createdLATime = `${laYear}-${laMonth.padStart(2, '0')}-${laDay.padStart(2, '0')} ${laHours.padStart(2, '0')}:${laMinutes.padStart(2, '0')}:${laSeconds.padStart(2, '0')}.000 LA Time`;
    
    const upsellData = {
      'Customer ID': customerId,
      'Email': customer.email || 'N/A',
      'First Payment Date': firstPaymentDate.toISOString(),
      'Latest Payment Date': latestPaymentDate.toISOString(),
      'Total Payments': allPayments.length.toString(),
      'Payment Intent IDs': paymentIds.join(', '),
      'Total Amount': (totalAmount / 100).toFixed(2),
      'Currency': latestPayment.currency || 'USD',
      'First Payment Amount': (firstPayment.amount / 100).toFixed(2),
      'Upsells Count': upsellsCount.toString(),
      'Upsells Total': (upsellsTotal / 100).toFixed(2),
      'Created UTC': latestPaymentDate.toISOString(),
      'Created Local (LA Time)': createdLATime
    };
    
    if (existingCustomerRow) {
      // Обновляем существующую запись
      await existingCustomerRow.save(upsellData);
      logger.debug(`Updated upsells for customer ${customerId} in ${UPSELLS_SHEET_NAME}`);
    } else {
      // Добавляем новую запись
      await upsellsSheet.addRow(upsellData);
      logger.info(`Added upsells for customer ${customerId} to ${UPSELLS_SHEET_NAME}: ${upsellsCount} upsells, $${(upsellsTotal / 100).toFixed(2)} total`);
    }
    
  } catch (error) {
    logger.warn(`Failed to export upsells for customer ${customerId}`, {
      error: error.message,
      stack: error.stack
    });
  }
}

// Helper function to add LA time formula to column G in Primer sheet (UTC-8)
async function addLaTimeFormulaToPrimerSheet(rowNumber, utcColumnIndex = null) {
  try {
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const sheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await sheet.loadHeaderRow();
    
    // Find UTC column dynamically
    if (utcColumnIndex === null) {
      utcColumnIndex = sheet.headerValues.indexOf('Created UTC');
      if (utcColumnIndex === -1) {
        logger.warn('UTC column not found in Primer sheet headers');
        return false;
      }
    }
    
    const utcColumnLetter = String.fromCharCode(65 + utcColumnIndex);
    const columnGIndex = sheet.headerValues.indexOf('Created Local (UTC-8)');
    if (columnGIndex === -1) {
      logger.warn('Created Local (UTC-8) column not found in Primer sheet headers');
      return false;
    }
    const columnGLetter = String.fromCharCode(65 + columnGIndex);
    
    // Formula to convert UTC to LA time (UTC-8) - формат как в других листах
    const formula = `=IF(${utcColumnLetter}${rowNumber}="","",TEXT(DATEVALUE(LEFT(${utcColumnLetter}${rowNumber},10))+TIMEVALUE(MID(${utcColumnLetter}${rowNumber},12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" UTC-8")`;
    
    // Use googleapis to add formula
    const { JWT } = await import('google-auth-library');
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: ENV.GOOGLE_SHEETS_DOC_ID,
      range: `${PRIMER_SHEET_NAME}!${columnGLetter}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[formula]]
      }
    });
    
    logger.debug(`Added LA time formula to ${PRIMER_SHEET_NAME} row ${rowNumber}, column ${columnGLetter}`);
    return true;
  } catch (error) {
    logger.warn(`Failed to add LA time formula to Primer row ${rowNumber}`, {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

// Helper function to add LA time formula to column G in LowPrice sheet
async function addLaTimeFormulaToLowPriceSheet(rowNumber, utcColumnIndex = null) {
  try {
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    const sheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await sheet.loadHeaderRow();
    
    // Find UTC column dynamically
    if (utcColumnIndex === null) {
      utcColumnIndex = sheet.headerValues.indexOf('Created UTC');
      if (utcColumnIndex === -1) {
        logger.warn('UTC column not found in LowPrice sheet headers');
        return false;
      }
    }
    
    const utcColumnLetter = String.fromCharCode(65 + utcColumnIndex);
    const columnGIndex = 6; // G column (A=0, B=1, C=2, D=3, E=4, F=5, G=6)
    const columnGLetter = 'G';
    
    // Formula to convert UTC to LA time (UTC-8)
    const formula = `=IF(${utcColumnLetter}${rowNumber}="","",TEXT(DATEVALUE(LEFT(${utcColumnLetter}${rowNumber},10))+TIMEVALUE(MID(${utcColumnLetter}${rowNumber},12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" LA Time")`;
    
    // Use googleapis to add formula
    const { JWT } = await import('google-auth-library');
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: ENV.GOOGLE_SHEETS_DOC_ID,
      range: `${LOW_PRICE_SHEET_NAME}!${columnGLetter}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[formula]]
      }
    });
    
    logger.debug(`Added LA time formula to ${LOW_PRICE_SHEET_NAME} row ${rowNumber}, column ${columnGLetter}`);
    return true;
  } catch (error) {
    logger.warn(`Failed to add LA time formula to row ${rowNumber}`, {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

// Sync logic for Low Price Stripe account
async function performSyncLogicLowPrice(exportAll = false) {
  // Skip if not configured
  if (!stripeLowPrice || !ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
    logger.info('Low Price Stripe account not configured, skipping sync');
    return { success: true, message: 'Low Price account not configured', processed: 0 };
  }

  const startTime = Date.now();
  const results = {
    processed: 0,
    failed: 0,
    errors: [],
    newPurchases: 0,
    updatedPurchases: 0,
    skipped: 0,
    duplicatesAvoided: 0
  };

  const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
  
  try {
    logger.info(`🔄 Starting Low Price payment sync to sheet "${LOW_PRICE_SHEET_NAME}"...`);
    
    // ✅ КРИТИЧЕСКИ ВАЖНО: Получаем лист LowPrice для выгрузки
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    logger.info(`✅ Using LowPrice sheet: "${lowPriceSheet.title}" (ID: ${lowPriceSheet.sheetId})`);
    
    // ✅ Заголовки уже созданы - просто пытаемся загрузить их
    // Если не получается - продолжаем работу без заголовков (они уже есть в таблице)
    try {
      await lowPriceSheet.loadHeaderRow();
      logger.info(`✅ LowPrice sheet headers loaded successfully`);
    } catch (error) {
      // Заголовки могут не загрузиться из-за размера листа, но они уже есть
      // Продолжаем работу - заголовки уже созданы вручную
      logger.warn(`⚠️ Could not load headers (may be due to sheet size), but headers already exist. Continuing... (error: ${error.message})`);
    }
    
    // Load existing Payment Intent IDs from LowPrice sheet
    let existingRows;
    try {
      existingRows = await lowPriceSheet.getRows();
      logger.info(`✅ Loaded ${existingRows.length} existing rows from LowPrice sheet`);
    } catch (error) {
      logger.error('❌ Failed to load rows from LowPrice sheet', {
        error: error.message,
        stack: error.stack,
        sheetName: LOW_PRICE_SHEET_NAME
      });
      throw new Error(`Failed to load rows from LowPrice sheet: ${error.message}`);
    }
    
    const existingPaymentIds = new Set();
    
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || row.get('Payment Intent ID') || '';
      if (paymentIdsField) {
        // Payment Intent IDs can contain multiple IDs separated by comma
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    logger.info(`📋 Found ${existingPaymentIds.size} existing payments in LowPrice sheet`);
    
    // Get payments from Low Price Stripe account (all or recent)
    const payments = exportAll 
      ? await fetchWithRetry(() => getAllPaymentsLowPrice())
      : await fetchWithRetry(() => getRecentPaymentsLowPrice(100));
    
    // Filter successful payments (same logic as main account)
    // ✅ КРИТИЧЕСКИ ВАЖНО: Исключаем тестовые платежи $0.60 (они возвращаются)
    // ✅ Также исключаем reversed/refunded/canceled платежи
    const successfulPayments = payments.filter(p => {
      // Сначала исключаем все неподходящие статусы
      if (p.status !== 'succeeded' || !p.customer) return false;
      // Исключаем reversed/refunded/canceled платежи (они возвращены или отменены)
      if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
      // Проверяем charges на наличие refunded/reversed
      if (p.charges && p.charges.data) {
        const hasRefunded = p.charges.data.some(charge => 
          charge.refunded || charge.status === 'refunded' || charge.status === 'reversed'
        );
        if (hasRefunded) return false;
      }
      // ✅ НЕ исключаем subscription update для LowPrice - это апселлы, их нужно включать!
      // Исключаем только тестовые платежи $0.60 (60 центов = 60 в Stripe API) - они всегда возвращаются
      if (p.amount === 60) return false;
      return true;
    });
    
    logger.info(`📊 Found ${successfulPayments.length} successful payments from Low Price account (including upsells)`);
    
    // Filter out existing payments by payment ID
    const newPayments = successfulPayments.filter(p => {
      if (existingPaymentIds.has(p.id)) {
        results.duplicatesAvoided++;
        logger.debug(`⏭️ Payment ${p.id} already exists in sheet, skipping`);
        return false;
      }
      return true;
    });
    
    logger.info(`🆕 Processing ${newPayments.length} new Low Price payments (out of ${successfulPayments.length} total), avoided ${results.duplicatesAvoided} duplicates`);
    
    if (newPayments.length === 0) {
      logger.info(`ℹ️ No new payments to process for LowPrice account`);
      return {
        success: true,
        message: `No new payments to process`,
        ...results,
        duration: `${Date.now() - startTime}ms`,
        sheetName: LOW_PRICE_SHEET_NAME
      };
    }
    
    // Group payments by customer
    const customerGroups = new Map();
    for (const payment of newPayments) {
      const customerId = payment.customer;
      if (!customerId) {
        logger.warn(`⚠️ Payment ${payment.id} has no customer ID, skipping`);
        results.skipped++;
        continue;
      }
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    logger.info(`📦 Grouped ${newPayments.length} payments into ${customerGroups.size} customer groups`);
    
    // Process each customer group
    for (const [customerId, payments] of customerGroups.entries()) {
      // 🔒 Получаем блокировку для этого клиента
      const customerLockKey = `customer_lowprice_${customerId}`;
      let customerLockId = null;
      try {
        customerLockId = await distributedLock.acquire(customerLockKey, 5, 100);
        logger.debug(`🔒 Low Price customer lock acquired for ${customerId}`, { customerLockId });
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
        // ✅ ОПТИМИЗАЦИЯ: Загружаем customer и rows параллельно (они независимы)
        logger.info(`🔍 Checking if customer ${customerId} exists in LowPrice sheet "${lowPriceSheet.title}"...`);
        // Используем Promise.allSettled для надежности - если один запрос упадет, другой все равно выполнится
        const [customerResult, rowsResult] = await Promise.allSettled([
          fetchWithRetry(() => getCustomerLowPrice(customerId)),
          lowPriceSheet.getRows()
        ]);
        
        // Проверяем результаты
        if (customerResult.status === 'rejected') {
          logger.error(`Failed to fetch Low Price customer ${customerId}`, { error: customerResult.reason?.message });
          results.failed++;
          results.errors.push({ customerId, error: customerResult.reason?.message });
          continue;
        }
        
        if (rowsResult.status === 'rejected') {
          logger.error(`Failed to fetch rows from LowPrice sheet`, { error: rowsResult.reason?.message });
          results.failed++;
          results.errors.push({ customerId, error: 'Failed to load LowPrice sheet rows' });
          continue;
        }
        
        const customer = customerResult.value;
        const allLowPriceRows = rowsResult.value;
        
        if (!customer) {
          logger.warn(`Low Price customer ${customerId} not found in Stripe`);
          results.skipped += payments.length;
          continue;
        }
        
        // Sort payments by creation date
        payments.sort((a, b) => a.created - b.created);
        const firstPayment = payments[0];
        const latestPayment = payments[payments.length - 1];
        
        // ✅ КРИТИЧЕСКИ ВАЖНО: Используем уже загруженные строки
        const existingCustomers = allLowPriceRows.filter(row => {
          const rowCustomerId = row.get('Customer ID');
          return rowCustomerId === customerId;
        });
        
        logger.info(`🔍 Found ${existingCustomers.length} existing rows for customer ${customerId} in LowPrice sheet "${lowPriceSheet.title}"`);
        
        if (existingCustomers.length > 0) {
          // Customer exists - UPDATE
          logger.info(`Updating existing Low Price customer ${customerId}`);
          
          // ✅ КРИТИЧЕСКИ ВАЖНО: Загружаем ВСЕ платежи клиента из Stripe для обновления суммы
          // Это гарантирует, что основная покупка + все апселлы будут суммированы вместе
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
          const allSuccessfulPayments = allPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            // ✅ Исключаем reversed/refunded/canceled платежи (они возвращены или отменены)
            if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
            // Проверяем charges на наличие refunded/reversed
            if (p.charges && p.charges.data) {
              const hasRefunded = p.charges.data.some(charge => 
                charge.refunded || charge.status === 'refunded' || charge.status === 'reversed'
              );
              if (hasRefunded) return false;
            }
            // ✅ НЕ исключаем subscription update для LowPrice - это апселлы!
            // Исключаем только тестовые платежи $0.60 (они возвращаются)
            if (p.amount === 60) return false;
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
          
          // Get latest payment for updated timestamp
          const latestPaymentForUpdate = allSuccessfulPayments[allSuccessfulPayments.length - 1];
          const updatedRowData = formatPaymentForSheetsLowPrice(latestPaymentForUpdate, customer);
          
          // ✅ КРИТИЧЕСКИ ВАЖНО: Обновление существующей строки в листе LowPrice
          logger.debug(`📝 Updating row in LowPrice sheet: "${lowPriceSheet.title}"`);
          await fetchWithRetry(() => 
            existingCustomers[0].save({
              'Purchase ID': `purchase_${customerId}`,
              'Total Amount': (totalAmountAll / 100).toFixed(2),
              'Payment Count': paymentCountAll.toString(),
              'Payment Intent IDs': paymentIdsAll.join(', '),
              'Created UTC': updatedRowData['Created UTC'],
              'Created Local (LA Time)': updatedRowData['Created Local (LA Time)']
            })
          );
          
          // Add LA time formula
          await addLaTimeFormulaToLowPriceSheet(existingCustomers[0].rowNumber);
          
          // ❌ УБРАЛИ УВЕДОМЛЕНИЯ ПРИ ОБНОВЛЕНИИ - это вызывало спам!
          // Уведомления отправляются ТОЛЬКО для новых покупок, не для обновлений существующих
          logger.info(`✅ Updated existing Low Price customer ${customerId} - no notification sent (to prevent spam)`);
          
          results.updatedPurchases++;
          results.processed++;
          
        } else {
          // ADD NEW customer - load ALL payments from Stripe (including all upsells)
          logger.info(`Adding new Low Price customer ${customerId} (loading ALL payments from Stripe)`);
          
          // ✅ КРИТИЧЕСКИ ВАЖНО: Загружаем ВСЕ платежи клиента из Stripe (не только новые из группы)
          // Это гарантирует, что основная покупка + все апселлы будут суммированы вместе
          let allPayments;
          try {
            allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
            logger.info(`📥 Loaded ${allPayments.length} total payments for customer ${customerId} from Stripe`);
          } catch (paymentsError) {
            logger.error(`❌ Failed to load payments for customer ${customerId}`, {
              error: paymentsError.message,
              customerId
            });
            results.failed++;
            continue;
          }
          
          const allSuccessfulPayments = allPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            // ✅ НЕ исключаем subscription update для LowPrice - это апселлы, их нужно включать!
            // Исключаем только тестовые платежи $0.60 (они возвращаются)
            if (p.amount === 60) return false;
            return true;
          });
          
          logger.info(`✅ Filtered to ${allSuccessfulPayments.length} successful payments for customer ${customerId} (including upsells, excluded $0.6 test payments)`);
          
          if (allSuccessfulPayments.length === 0) {
            logger.warn(`⚠️ No successful payments for customer ${customerId}, skipping`);
            results.skipped++;
            continue;
          }
          
          // Сортируем по дате создания (первая покупка)
          allSuccessfulPayments.sort((a, b) => a.created - b.created);
          const firstPayment = allSuccessfulPayments[0];
          
          logger.info(`📝 Formatting row data for customer ${customerId}, first payment: ${firstPayment.id}`);
          
          let rowData;
          try {
            rowData = formatPaymentForSheetsLowPrice(firstPayment, customer);
          } catch (formatError) {
            logger.error(`❌ Failed to format payment data for customer ${customerId}`, {
              error: formatError.message,
              customerId,
              paymentId: firstPayment.id
            });
            results.failed++;
            continue;
          }
          
          // ✅ Суммируем ВСЕ платежи клиента (основная покупка + все апселлы)
          let totalAmount = 0;
          const paymentIds = [];
          for (const p of allSuccessfulPayments) {
            totalAmount += p.amount;
            paymentIds.push(p.id);
          }
          
          rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
          rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
          rowData['Payment Count'] = allSuccessfulPayments.length.toString();
          rowData['Payment Intent IDs'] = paymentIds.join(', ');
          
          logger.info(`💰 Customer ${customerId}: ${allSuccessfulPayments.length} payments, total $${rowData['Total Amount']}`);
          
          // ✅ КРИТИЧЕСКИ ВАЖНО: Добавляем НАПРЯМУЮ в lowPriceSheet, без использования googleSheets.sheet
          logger.info(`📝 Adding customer ${customerId} DIRECTLY to LowPrice sheet: "${lowPriceSheet.title}"`);
          
          let addResult;
          let rowSaved = false;
          try {
            // Проверяем существование напрямую в lowPriceSheet
            const existingInLowPrice = allLowPriceRows.filter(row => {
              const rowCustomerId = row.get('Customer ID');
              return rowCustomerId === customerId;
            });
            
            if (existingInLowPrice.length > 0) {
              // Клиент уже существует - обновляем
              addResult = {
                success: false,
                exists: true,
                action: 'skipped',
                row: existingInLowPrice[0]
              };
              logger.info(`📊 Customer ${customerId} already exists in LowPrice sheet (row ${existingInLowPrice[0].rowNumber})`);
            } else {
              // Добавляем новую строку НАПРЯМУЮ в lowPriceSheet
              const newRow = await lowPriceSheet.addRow(rowData);
              addResult = {
                success: true,
                exists: false,
                action: 'added',
                row: newRow
              };
              logger.info(`📊 Successfully added customer ${customerId} to LowPrice sheet (row ${newRow.rowNumber})`);
            }
          } catch (addError) {
            logger.error(`❌ CRITICAL: Failed to add Low Price customer ${customerId} to sheet`, {
              error: addError.message,
              stack: addError.stack,
              customerId,
              sheetName: lowPriceSheet.title
            });
            results.failed++;
            continue; // Пропускаем этого клиента, НЕ отправляем уведомление
          }
          
          if (!addResult.success) {
            if (addResult.exists) {
              // Строка уже существует - обновляем БЕЗ уведомления
              logger.warn(`⚠️ Low Price customer ${customerId} already exists - updating without notification`);
              results.duplicatesAvoided++;
              
              try {
                // Обновляем существующую строку НАПРЯМУЮ в lowPriceSheet
                await fetchWithRetry(() => 
                  addResult.row.save({
                    'Total Amount': rowData['Total Amount'],
                    'Payment Count': rowData['Payment Count'],
                    'Payment Intent IDs': rowData['Payment Intent IDs'],
                    'Created UTC': rowData['Created UTC'],
                    'Created Local (LA Time)': rowData['Created Local (LA Time)']
                  })
                );
                rowSaved = true;
                await addLaTimeFormulaToLowPriceSheet(addResult.row.rowNumber);
                logger.info(`✅ Updated existing Low Price customer ${customerId} in "${lowPriceSheet.title}" sheet - NO notification sent`);
                results.updatedPurchases++;
              } catch (saveError) {
                logger.error(`❌ Failed to update existing Low Price customer ${customerId}`, {
                  error: saveError.message,
                  customerId,
                  sheetName: lowPriceSheet.title
                });
                results.failed++;
              }
            } else {
              // Ошибка при добавлении - НЕ отправляем уведомление
              logger.error(`❌ Failed to add Low Price customer ${customerId}`, {
                exists: addResult.exists,
                action: addResult.action,
                reason: addResult.reason,
                customerId
              });
              results.failed++;
            }
          } else if (addResult.success && !addResult.exists) {
            // ✅ УСПЕШНО ДОБАВЛЕНО - проверяем, что строка действительно в таблице
            try {
              await addLaTimeFormulaToLowPriceSheet(addResult.row.rowNumber);
              
              // Дополнительная проверка: убеждаемся, что строка сохранена
              const verifyRows = await lowPriceSheet.getRows();
              const verifyRow = verifyRows.find(r => r.get('Customer ID') === customerId);
              
              if (!verifyRow) {
                logger.error(`❌ CRITICAL: Row for ${customerId} not found in sheet after add! NOT sending notification.`);
                results.failed++;
                rowSaved = false;
              } else {
                rowSaved = true;
                results.newPurchases++;
                logger.info(`✅ VERIFIED: Low Price customer ${customerId} successfully added to sheet (row ${verifyRow.rowNumber})`);
              }
            } catch (verifyError) {
              logger.error(`❌ CRITICAL: Error verifying row for ${customerId}`, {
                error: verifyError.message,
                customerId
              });
              results.failed++;
              rowSaved = false;
            }
            
            // ✅ ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ ТОЛЬКО ЕСЛИ СТРОКА УСПЕШНО СОХРАНЕНА В ТАБЛИЦУ
            if (rowSaved) {
              const sheetData = {
                'Ad Name': rowData['Ad Name'] || 'N/A',
                'Adset Name': rowData['Adset Name'] || 'N/A',
                'Campaign Name': rowData['Campaign Name'] || 'N/A',
                'Creative Link': rowData['Creative Link'] || 'N/A',
                'Total Amount': rowData['Total Amount'],
                'Payment Count': rowData['Payment Count'],
                'Payment Intent IDs': rowData['Payment Intent IDs']
              };
              
              const notificationMessage = await formatTelegramNotification(firstPayment, customer, {
                ...sheetData,
                accountSource: 'FL' // LowPrice Stripe account
              });
              const amount = parseFloat(sheetData['Total Amount'] || 0);
              const isVip = amount >= alertConfig.vipPurchaseThreshold;
              
              logger.info(`📬 Sending notification for NEW Low Price purchase: ${customerId} (${rowData['Total Amount']} USD)`);
              
              await notificationQueue.add({
                type: isVip ? 'vip_new_purchase' : 'new_purchase',
                channel: 'telegram',
                message: notificationMessage,
                payment: firstPayment,
                customer: customer,
                sheetData: sheetData,
                metadata: {
                  paymentId: firstPayment.id,
                  customerId: customer.id,
                  amount: sheetData['Total Amount'],
                  type: 'new_purchase',
                  isVip: isVip,
                  accountSource: 'FL'
                }
              });
            } else {
              logger.error(`❌ NOT sending notification for ${customerId} - row not saved to sheet!`);
            }
          }
          
          results.processed++;
        }
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          customerId,
          error: error.message,
          errorType: error.name || 'UnknownError'
        });
        logger.error('Failed to process Low Price customer group', {
          customerId,
          error: error.message,
          stack: error.stack
        });
      } finally {
        // 🔓 Освобождаем блокировку клиента
        if (customerLockId) {
          distributedLock.release(customerLockKey, customerLockId);
          logger.debug(`🔓 Low Price customer lock released for ${customerId}`, { customerLockId });
        }
      }
    }
    
    const duration = Date.now() - startTime;
    logger.info(`✅ Low Price sync completed: ${results.processed} processed, ${results.duplicatesAvoided} duplicates avoided`, {
      processed: results.processed,
      newPurchases: results.newPurchases,
      duplicatesAvoided: results.duplicatesAvoided,
      duration: `${duration}ms`
    });
    
    return {
      success: true,
      message: `Low Price sync completed! Processed ${results.processed}, avoided ${results.duplicatesAvoided} duplicates`,
      ...results,
      duration: `${duration}ms`,
      sheetName: LOW_PRICE_SHEET_NAME
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Critical Low Price sync error', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
      errorName: error.name,
      errorType: error.constructor?.name,
      sheetName: LOW_PRICE_SHEET_NAME,
      hasStripeLowPrice: !!stripeLowPrice,
      hasEnvKey: !!ENV.STRIPE_SECRET_KEY_LOW_PRICE
    });
    
    // Логируем детали ошибки для отладки
    console.error('❌ LowPrice sync error details:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      sheetName: LOW_PRICE_SHEET_NAME
    });
    
    return {
      success: false,
      message: `Critical Low Price sync error: ${error.message}`,
      error: error.message,
      errorName: error.name,
      partialResults: results,
      duration: `${duration}ms`,
      sheetName: LOW_PRICE_SHEET_NAME
    };
  }
}

// Sync Primer payments (PayPal via Primer API)
async function performSyncLogicPrimer(exportAll = false) {
  // ✅ Явное логирование начала синхронизации Primer
  logger.info('🔄 Starting Primer sync check...', {
    exportAll,
    timestamp: new Date().toISOString()
  });
  
  // Skip if not configured
  logger.info('🔍 Checking Primer configuration...', {
    hasApiKey: !!ENV.PRIMER_API_KEY,
    apiKeyLength: ENV.PRIMER_API_KEY ? ENV.PRIMER_API_KEY.length : 0,
    isConfigured: isPrimerConfigured(),
    primerSheetName: ENV.PRIMER_SHEET_NAME || 'Primer'
  });
  
  if (!isPrimerConfigured()) {
    logger.warn('⚠️ Primer API not configured, skipping sync', {
      hasApiKey: !!ENV.PRIMER_API_KEY,
      primerApiKey: ENV.PRIMER_API_KEY ? `${ENV.PRIMER_API_KEY.substring(0, 10)}...` : 'null'
    });
    return { success: true, message: 'Primer API not configured', processed: 0 };
  }
  
  logger.info('✅ Primer API is configured, proceeding with sync...');

  const startTime = Date.now();
  const results = {
    processed: 0,
    failed: 0,
    errors: [],
    newPurchases: 0,
    updatedPurchases: 0,
    skipped: 0,
    duplicatesAvoided: 0
  };

  const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
  
  try {
    logger.info(`🔄 Starting Primer payment sync to sheet "${PRIMER_SHEET_NAME}"...`, {
      sheetName: PRIMER_SHEET_NAME,
      googleSheetsDocId: ENV.GOOGLE_SHEETS_DOC_ID ? `${ENV.GOOGLE_SHEETS_DOC_ID.substring(0, 10)}...` : 'not configured'
    });
    
    // Get Primer sheet
    logger.info(`📋 Attempting to get Primer sheet "${PRIMER_SHEET_NAME}"...`);
    let primerSheet;
    try {
      primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
      logger.info(`✅ Using Primer sheet: "${primerSheet.title}" (ID: ${primerSheet.sheetId})`, {
        sheetTitle: primerSheet.title,
        sheetId: primerSheet.sheetId
      });
    } catch (sheetError) {
      logger.error(`❌ Failed to get Primer sheet "${PRIMER_SHEET_NAME}"`, {
        error: sheetError.message,
        stack: sheetError.stack,
        sheetName: PRIMER_SHEET_NAME
      });
      throw sheetError;
    }
    
    // Try to load headers
    try {
      await primerSheet.loadHeaderRow();
      logger.info(`✅ Primer sheet headers loaded successfully`);
    } catch (error) {
      logger.warn(`⚠️ Could not load headers (may be due to sheet size), but headers already exist. Continuing... (error: ${error.message})`);
    }
    
    // Load existing Payment IDs from Primer sheet
    let existingRows;
    try {
      existingRows = await primerSheet.getRows();
      logger.info(`✅ Loaded ${existingRows.length} existing rows from Primer sheet`);
    } catch (error) {
      logger.error('❌ Failed to load rows from Primer sheet', {
        error: error.message,
        stack: error.stack,
        sheetName: PRIMER_SHEET_NAME
      });
      throw new Error(`Failed to load rows from Primer sheet: ${error.message}`);
    }
    
    const existingPaymentIds = new Set();
    
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || row.get('Payment ID') || '';
      if (paymentIdsField) {
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    logger.info(`📋 Found ${existingPaymentIds.size} existing payments in Primer sheet`);
    
    // Get payments from Primer API (all or recent)
    // ✅ Увеличиваем период до 30 дней для getRecentPaymentsPrimer чтобы не пропустить покупки
    const primerPayments = exportAll 
      ? await getAllPaymentsPrimer()
      : await getRecentPaymentsPrimer(100, 30); // 30 дней вместо 7 по умолчанию
    
    logger.info(`📥 Получено ${primerPayments.length} платежей из Primer API (после фильтрации по application: "testora")`);
    
    // Normalize Primer payments to Stripe-like format
    const normalizedPayments = primerPayments.map(normalizePrimerPayment);
    
    // ✅ Детальное логирование для диагностики
    if (normalizedPayments.length > 0) {
      logger.info(`📋 Пример нормализованного платежа:`, {
        id: normalizedPayments[0].id,
        status: normalizedPayments[0].status,
        customer: normalizedPayments[0].customer,
        amount: normalizedPayments[0].amount,
        currency: normalizedPayments[0].currency,
        created: normalizedPayments[0].created,
        metadata: normalizedPayments[0].metadata
      });
    }
    
    // Filter successful payments
    const successfulPayments = normalizedPayments.filter(p => {
      if (p.status !== 'succeeded') {
        logger.debug(`⏭️ Платеж ${p.id} пропущен: status=${p.status} (не succeeded)`);
        return false;
      }
      if (!p.customer) {
        logger.debug(`⏭️ Платеж ${p.id} пропущен: нет customer ID`);
        return false;
      }
      // Exclude refunded/reversed payments
      if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') {
        logger.debug(`⏭️ Платеж ${p.id} пропущен: status=${p.status} (reversed/refunded/canceled)`);
        return false;
      }
      return true;
    });
    
    logger.info(`📊 Найдено ${successfulPayments.length} успешных платежей из ${normalizedPayments.length} нормализованных (после фильтрации по статусу)`);
    
    // ✅ Детальное логирование для диагностики дубликатов
    if (successfulPayments.length > 0) {
      logger.info(`🔍 Детальная проверка платежей на дубликаты:`, {
        totalSuccessfulPayments: successfulPayments.length,
        existingPaymentIdsCount: existingPaymentIds.size,
        paymentIdsFromAPI: successfulPayments.slice(0, 5).map(p => ({
          id: p.id,
          customer: p.customer,
          amount: `${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`,
          created: new Date(p.created * 1000).toISOString(),
          isDuplicate: existingPaymentIds.has(p.id)
        }))
      });
    }
    
    // Filter out existing payments by payment ID
    const newPayments = successfulPayments.filter(p => {
      if (existingPaymentIds.has(p.id)) {
        results.duplicatesAvoided++;
        logger.info(`⏭️ Payment ${p.id} (customer: ${p.customer}, amount: ${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}) already exists in sheet, skipping`);
        return false;
      }
      return true;
    });
    
    logger.info(`🆕 Processing ${newPayments.length} new Primer payments (out of ${successfulPayments.length} total), avoided ${results.duplicatesAvoided} duplicates`);
    
    // ✅ Если есть новые платежи, логируем их детально
    if (newPayments.length > 0) {
      logger.info(`📋 Детали новых платежей для обработки:`, {
        newPaymentsCount: newPayments.length,
        paymentDetails: newPayments.slice(0, 10).map(p => ({
          id: p.id,
          customer: p.customer,
          amount: `${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`,
          created: new Date(p.created * 1000).toISOString(),
          email: p.email || 'N/A',
          country: p.country || 'N/A'
        }))
      });
    }
    
    if (newPayments.length === 0) {
      logger.info(`ℹ️ No new payments to process for Primer account`, {
        totalPaymentsFromAPI: primerPayments.length,
        normalizedPayments: normalizedPayments.length,
        successfulPayments: successfulPayments.length,
        existingPaymentIds: existingPaymentIds.size,
        duplicatesAvoided: results.duplicatesAvoided,
        message: 'All payments from API already exist in sheet. If you expect notifications, check if payments were added manually or via another process.'
      });
      
      // ✅ Если платежи уже есть в таблице, но были добавлены недавно (за последние 5 минут),
      // возможно они были добавлены вручную и уведомления не были отправлены
      // В этом случае мы не можем отправить уведомления, так как не знаем, были ли они уже отправлены
      // Но логируем это для диагностики
      if (successfulPayments.length > 0) {
        logger.info(`💡 Все ${successfulPayments.length} платежей из API уже есть в таблице. Если вы ожидали уведомления, проверьте:`, {
          suggestion1: 'Платежи были добавлены вручную в таблицу?',
          suggestion2: 'Платежи были добавлены через другой скрипт?',
          suggestion3: 'Уведомления отправляются только при добавлении НОВЫХ клиентов (новых строк)',
          note: 'Если платежи были добавлены как обновление существующего клиента, уведомления не отправляются (чтобы избежать спама)'
        });
      }
      
      return {
        success: true,
        message: `No new payments to process`,
        ...results,
        duration: `${Date.now() - startTime}ms`,
        sheetName: PRIMER_SHEET_NAME
      };
    }
    
    // Group payments by customer
    const customerGroups = new Map();
    for (const payment of newPayments) {
      const customerId = payment.customer;
      if (!customerId) {
        logger.warn(`⚠️ Payment ${payment.id} has no customer ID, skipping`);
        results.skipped++;
        continue;
      }
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    logger.info(`📦 Grouped ${newPayments.length} payments into ${customerGroups.size} customer groups`);
    
    // Process each customer group
    for (const [customerId, payments] of customerGroups.entries()) {
      // Get customer lock
      const customerLockKey = `customer_primer_${customerId}`;
      let customerLockId = null;
      try {
        customerLockId = await distributedLock.acquire(customerLockKey, 5, 100);
        logger.debug(`🔒 Primer customer lock acquired for ${customerId}`, { customerLockId });
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
        // Load customer and rows in parallel
        const [customerResult, rowsResult] = await Promise.allSettled([
          fetchWithRetry(() => getCustomerPrimer(customerId)),
          primerSheet.getRows()
        ]);
        
        if (customerResult.status === 'rejected') {
          logger.error(`Failed to fetch Primer customer ${customerId}`, { error: customerResult.reason?.message });
          results.failed++;
          results.errors.push({ customerId, error: customerResult.reason?.message });
          continue;
        }
        
        if (rowsResult.status === 'rejected') {
          logger.error(`Failed to fetch rows from Primer sheet`, { error: rowsResult.reason?.message });
          results.failed++;
          results.errors.push({ customerId, error: 'Failed to load Primer sheet rows' });
          continue;
        }
        
        let customer = customerResult.value;
        const allPrimerRows = rowsResult.value;
        
        // Извлекаем email и GEO напрямую из payment объектов если customer не найден или неполный
        const firstPayment = payments[0];
        const originalPayment = firstPayment._original;
        
        let emailFromPayment = null;
        let countryFromPayment = null;
        
        if (originalPayment) {
          emailFromPayment = originalPayment.customer?.emailAddress 
            || originalPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
            || firstPayment.email
            || null;
          
          countryFromPayment = originalPayment.order?.countryCode 
            || originalPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
            || firstPayment.country
            || null;
        }
        
        if (!customer) {
          // Создаем customer из payment данных
          customer = {
            id: customerId,
            email: emailFromPayment || null,
            country: countryFromPayment || null,
            address: countryFromPayment ? { country: countryFromPayment } : null,
            metadata: firstPayment.metadata || {}
          };
          logger.info(`✅ Создан customer из payment данных: ${customerId}, email=${customer.email || 'нет'}, country=${customer.country || 'нет'}`);
        } else {
          // Если API не вернул email/GEO, используем данные из payment
          if (!customer.email && emailFromPayment) {
            customer.email = emailFromPayment;
            logger.info(`✅ Использован email из payment для ${customerId}: ${emailFromPayment}`);
          }
          if (!customer.country && countryFromPayment) {
            customer.country = countryFromPayment;
            customer.address = countryFromPayment ? { country: countryFromPayment } : null;
            logger.info(`✅ Использован GEO из payment для ${customerId}: ${countryFromPayment}`);
          }
        }
        
        // Если все еще нет email/GEO, пробуем получить детальный payment
        if ((!customer.email || !customer.country) && originalPayment?.id) {
          try {
            const paymentDetailResponse = await fetchWithRetry(() => 
              fetch(`https://api.primer.io/payments/${originalPayment.id}`, {
                headers: {
                  'X-API-KEY': ENV.PRIMER_API_KEY,
                  'X-API-VERSION': ENV.PRIMER_API_VERSION || '2.4',
                  'Content-Type': 'application/json'
                }
              })
            );
            
            if (paymentDetailResponse.ok) {
              const paymentDetail = await paymentDetailResponse.json();
              
              if (!customer.email) {
                customer.email = paymentDetail.customer?.emailAddress 
                  || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
                  || customer.email;
              }
              
              if (!customer.country) {
                customer.country = paymentDetail.order?.countryCode 
                  || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
                  || customer.country;
                customer.address = customer.country ? { country: customer.country } : null;
              }
              
              if (customer.email || customer.country) {
                logger.info(`✅ Получен детальный payment для ${customerId}: email=${customer.email || 'нет'}, country=${customer.country || 'нет'}`);
              }
            }
          } catch (detailError) {
            logger.debug(`Не удалось получить детальный payment для ${customerId}: ${detailError.message}`);
          }
        }
        
        // Sort payments by creation date
        payments.sort((a, b) => a.created - b.created);
        
        // Check if customer exists
        const existingCustomers = allPrimerRows.filter(row => {
          const rowCustomerId = row.get('Customer ID');
          return rowCustomerId === customerId;
        });
        
        if (existingCustomers.length > 0) {
          // Customer exists - UPDATE
          // ✅ Проверяем какие платежи действительно новые (не были в existingPaymentIds)
          const trulyNewPayments = payments.filter(p => !existingPaymentIds.has(p.id));
          
          if (trulyNewPayments.length === 0) {
            logger.info(`⏭️ Все платежи клиента ${customerId} уже есть в таблице, пропускаю обновление`);
            results.duplicatesAvoided += payments.length;
            continue;
          }
          
          logger.info(`🔄 Обновляю существующего Primer клиента ${customerId} (найдено ${trulyNewPayments.length} новых платежей из ${payments.length} всего)`);
          
          // Load ALL payments for this customer
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
          const normalizedAllPayments = allPayments.map(normalizePrimerPayment);
          const allSuccessfulPayments = normalizedAllPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
            return true;
          });
          
          if (allSuccessfulPayments.length === 0) {
            logger.warn(`⚠️ No successful payments for existing customer ${customerId}, skipping update`);
            results.skipped++;
            continue;
          }
          
          let totalAmountAll = 0;
          let paymentCountAll = 0;
          const paymentIdsAll = [];
          
          for (const p of allSuccessfulPayments) {
            totalAmountAll += p.amount;
            paymentCountAll++;
            paymentIdsAll.push(p.id);
          }
          
          const latestPaymentForUpdate = allSuccessfulPayments[allSuccessfulPayments.length - 1];
          const updatedRowData = formatPaymentForSheetsPrimer(latestPaymentForUpdate, customer, { accountSource: 'primer' });
          
          // ✅ Убеждаемся что email и GEO заполнены
          if (!updatedRowData['Email'] || updatedRowData['Email'] === 'N/A') {
            updatedRowData['Email'] = customer?.email || latestPaymentForUpdate.email || 'N/A';
          }
          if (!updatedRowData['GEO'] || updatedRowData['GEO'] === 'Unknown') {
            updatedRowData['GEO'] = customer?.country || customer?.address?.country || latestPaymentForUpdate.country || 'Unknown';
          }
          
          const existingRow = existingCustomers[0];
          
          // ✅ Пересчитываем Total Amount правильно (всегда делим на 100, так как amounts в центах)
          const correctTotalAmount = (totalAmountAll / 100).toFixed(2);
          
          // Устанавливаем все поля перед сохранением
          existingRow.set('Purchase ID', `purchase_${customerId}`);
          existingRow.set('Total Amount', correctTotalAmount);
          existingRow.set('Payment Count', paymentCountAll.toString());
          existingRow.set('Payment Intent IDs', paymentIdsAll.join(', '));
          existingRow.set('Created UTC', updatedRowData['Created UTC']);
          existingRow.set('Created Local (UTC-8)', updatedRowData['Created Local (UTC-8)']);
          existingRow.set('Email', updatedRowData['Email']); // ✅ Сохраняем email при обновлении
          existingRow.set('GEO', updatedRowData['GEO']); // ✅ Сохраняем GEO при обновлении
          existingRow.set('Customer ID', customerId);
          
          logger.info(`💾 Сохраняю обновление Primer покупки: Customer=${customerId}, Email=${updatedRowData['Email']}, GEO=${updatedRowData['GEO']}, Amount=$${correctTotalAmount}, Payment IDs=${paymentIdsAll.join(', ')}`);
          
          await fetchWithRetry(() => existingRow.save());
          
          // ❌ УБРАЛИ УВЕДОМЛЕНИЯ ПРИ ОБНОВЛЕНИИ - это вызывало спам! (как в Stripe и LowPrice)
          // Уведомления отправляются ТОЛЬКО для новых покупок, не для обновлений существующих
          logger.info(`✅ Обновлен существующий Primer клиент ${customerId} (добавлено ${trulyNewPayments.length} новых платежей) - уведомление не отправлено (чтобы избежать спама)`);
          
          results.updatedPurchases++;
          results.processed++;
          
        } else {
          // ADD NEW customer - load ALL payments from Primer (как в Stripe логике)
          logger.info(`Adding new Primer customer ${customerId} (loading ALL payments from Primer)`);
          
          try {
            // ✅ КРИТИЧЕСКИ ВАЖНО: Загружаем ВСЕ платежи клиента из Primer (не только новые из группы)
            // Это гарантирует, что все платежи будут суммированы вместе (как в Stripe логике)
            const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
            const normalizedAllPayments = allPayments.map(normalizePrimerPayment);
            const allSuccessfulPayments = normalizedAllPayments.filter(p => {
              if (p.status !== 'succeeded' || !p.customer) return false;
              if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
              return true;
            });
            
            if (allSuccessfulPayments.length === 0) {
              logger.warn(`⚠️ No successful payments for customer ${customerId}, skipping`);
              results.skipped++;
              continue;
            }
            
            // Сортируем по дате создания (первая покупка)
            allSuccessfulPayments.sort((a, b) => a.created - b.created);
            const firstPayment = allSuccessfulPayments[0];
            
            // ✅ Проверяем что firstPayment существует и имеет id
            if (!firstPayment || !firstPayment.id) {
              logger.error(`❌ First payment is missing or has no ID for customer ${customerId}`, {
                customerId,
                allSuccessfulPaymentsCount: allSuccessfulPayments.length,
                firstPaymentExists: !!firstPayment,
                firstPaymentId: firstPayment?.id
              });
              results.failed++;
              continue;
            }
            
            const rowData = formatPaymentForSheetsPrimer(firstPayment, customer, { accountSource: 'primer' });
            
            // ✅ Суммируем ВСЕ платежи клиента (как в Stripe логике)
            let totalAmount = 0;
            const paymentIds = [];
            for (const p of allSuccessfulPayments) {
              totalAmount += p.amount;
              if (p.id) {
                paymentIds.push(p.id);
              }
            }
            
            rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
            // ✅ Primer amounts are always in cents, so always divide by 100
            rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
            rowData['Payment Count'] = allSuccessfulPayments.length.toString();
            rowData['Payment Intent IDs'] = paymentIds.join(', ');
            
            // ✅ Убеждаемся что email и GEO заполнены
            if (!rowData['Email'] || rowData['Email'] === 'N/A') {
              rowData['Email'] = customer?.email || firstPayment.email || 'N/A';
            }
            if (!rowData['GEO'] || rowData['GEO'] === 'Unknown') {
              rowData['GEO'] = customer?.country || customer?.address?.country || firstPayment.country || 'Unknown';
            }
            
            logger.info(`➕ Добавляю новую покупку Primer: Customer=${customerId}, Email=${rowData['Email']}, GEO=${rowData['GEO']}, Amount=$${rowData['Total Amount']}, Payments=${allSuccessfulPayments.length}, PaymentID=${firstPayment.id}`);
            
            // ✅ КРИТИЧЕСКИ ВАЖНО: Добавляем НАПРЯМУЮ в primerSheet (как в Stripe логике)
            const addResult = await primerSheet.addRow(rowData);
            
            // Add LA time formula to Created Local (UTC-8) column
            await addLaTimeFormulaToPrimerSheet(addResult.row.rowNumber);
            
            logger.info(`✅ Added new Primer customer ${customerId} to sheet (row ${addResult.row.rowNumber})`);
            
            // Send notification ONLY if successfully added (same as Stripe and LowPrice)
            const sheetData = {
              'Ad Name': rowData['Ad Name'] || 'N/A',
              'Adset Name': rowData['Adset Name'] || 'N/A',
              'Campaign Name': rowData['Campaign Name'] || 'N/A',
              'Creative Link': rowData['Creative Link'] || 'N/A',
              'Total Amount': rowData['Total Amount'],
              'Payment Count': rowData['Payment Count'],
              'Payment Intent IDs': rowData['Payment Intent IDs'],
              accountSource: 'primer' // ✅ Убеждаемся что accountSource в sheetData
            };
            
            // Send notification via queue (VIP alert will be included if applicable)
            // ✅ formatTelegramNotification is synchronous, no await needed
            const notificationMessage = formatTelegramNotification(firstPayment, customer, sheetData);
            const amount = parseFloat(sheetData['Total Amount'] || 0);
            const isVip = amount >= alertConfig.vipPurchaseThreshold;
            
            // ✅ Детальное логирование перед добавлением уведомления в очередь
            logger.info(`📬 Подготовка уведомления для Primer покупки`, {
              customerId: customer?.id,
              paymentId: firstPayment.id,
              amount: sheetData['Total Amount'],
              isVip,
              hasPayment: !!firstPayment,
              hasCustomer: !!customer,
              hasMessage: !!notificationMessage,
              messageLength: notificationMessage?.length || 0,
              accountSource: 'primer'
            });
            
            await notificationQueue.add({
              type: isVip ? 'vip_new_purchase' : 'new_purchase',
              channel: 'telegram',
              message: notificationMessage,
              payment: firstPayment,
              customer: customer,
              sheetData: sheetData,
              metadata: {
                paymentId: firstPayment.id, // ✅ Используем firstPayment.id напрямую
                customerId: customer?.id,
                amount: sheetData['Total Amount'],
                type: 'new_purchase',
                isVip: isVip,
                accountSource: 'primer' // ✅ Убеждаемся что accountSource в metadata
              }
            });
            
            logger.info(`✅ Уведомление добавлено в очередь для Primer покупки`, {
              customerId: customer?.id,
              paymentId: firstPayment.id,
              type: isVip ? 'vip_new_purchase' : 'new_purchase',
              duplicateKey: `payment_${firstPayment.id}`
            });
            
            results.newPurchases++;
            results.processed++;
            
          } catch (paymentsError) {
            logger.error(`❌ Failed to load payments for customer ${customerId}`, {
              error: paymentsError.message,
              customerId
            });
            results.failed++;
            continue;
          }
        }
        
      } catch (error) {
        logger.error(`❌ Error processing Primer customer ${customerId}`, {
          error: error.message,
          customerId
        });
        results.failed++;
      } finally {
        // Release customer lock
        if (customerLockId) {
          distributedLock.release(customerLockKey, customerLockId);
        }
      }
    }
    
    const duration = Date.now() - startTime;
    logger.info(`✅ Primer sync completed`, {
      ...results,
      duration: `${duration}ms`,
      sheetName: PRIMER_SHEET_NAME
    });
    
    return {
      success: true,
      message: `Primer sync completed successfully`,
      ...results,
      duration: `${duration}ms`,
      sheetName: PRIMER_SHEET_NAME
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('❌ Primer sync failed', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`
    });
    
    return {
      success: false,
      message: `Critical Primer sync error: ${error.message}`,
      error: error.message,
      errorName: error.name,
      partialResults: results,
      duration: `${duration}ms`,
      sheetName: PRIMER_SHEET_NAME
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

// Sync Low Price payments endpoint
app.post('/api/sync-payments-low-price', async (req, res) => {
  try {
    const result = await performSyncLogicLowPrice();
    
    // ✅ Проверяем оперативные алерты после успешной синхронизации LowPrice
    if (result.success && (result.newPurchases > 0 || result.updatedPurchases > 0)) {
      try {
        const realTimeAlerts = await smartAlerts.checkAllRealTimeAlerts();
        if (realTimeAlerts) {
          await sendTextNotifications(realTimeAlerts);
          logger.info('⚡ Real-time alerts sent after LowPrice sync', {
            newPurchases: result.newPurchases,
            updatedPurchases: result.updatedPurchases
          });
        }
      } catch (alertError) {
        logger.error('❌ Real-time alerts check failed after LowPrice sync', {
          error: alertError.message
        });
        // Не прерываем синхронизацию из-за ошибки алертов
      }
    }
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Low Price sync endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Low Price sync endpoint error',
      error: error.message
    });
  }
});

// Sync Primer payments endpoint (PayPal via Primer API)
app.post('/api/sync-primer-payments', async (req, res) => {
  try {
    const result = await performSyncLogicPrimer();
    
    // ✅ Проверяем оперативные алерты после успешной синхронизации Primer
    if (result.success && (result.newPurchases > 0 || result.updatedPurchases > 0)) {
      try {
        const realTimeAlerts = await smartAlerts.checkAllRealTimeAlerts();
        if (realTimeAlerts) {
          await sendTextNotifications(realTimeAlerts);
          logger.info('⚡ Real-time alerts sent after Primer sync', {
            newPurchases: result.newPurchases,
            updatedPurchases: result.updatedPurchases
          });
        }
      } catch (alertError) {
        logger.error('❌ Real-time alerts check failed after Primer sync', {
          error: alertError.message
        });
        // Не прерываем синхронизацию из-за ошибки алертов
      }
    }
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Primer sync endpoint error', error);
    res.status(500).json({
      success: false,
      message: 'Primer sync endpoint error',
      error: error.message
    });
  }
});

// Export ALL historical payments from Primer (PayPal via Primer API)
app.post('/api/export-all-primer-payments', async (req, res) => {
  try {
    logger.info('🚀 Starting mass export of ALL payments from Primer API...');
    
    if (!isPrimerConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Primer API not configured'
      });
    }
    
    // Call sync with exportAll=true to get ALL payments
    const result = await performSyncLogicPrimer(true);
    
    logger.info('✅ Mass export completed', result);
    res.json({
      success: true,
      message: 'Mass export completed!',
      ...result
    });
    
  } catch (error) {
    logger.error('Error in mass export', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting all payments',
      error: error.message
    });
  }
});

// Export ALL historical payments from Low Price Stripe account
app.post('/api/export-all-lowprice-payments', async (req, res) => {
  try {
    logger.info('Starting mass export of ALL payments from Low Price Stripe account...');
    
    if (!stripeLowPrice || !ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
      return res.status(400).json({
        success: false,
        message: 'Low Price Stripe account not configured'
      });
    }
    
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    
    // Load existing payment IDs to avoid duplicates
    const existingRows = await lowPriceSheet.getRows();
    const existingPaymentIds = new Set();
    
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || '';
      if (paymentIdsField) {
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    logger.info(`Found ${existingPaymentIds.size} existing payments in LowPrice sheet`);
    
    // Get ALL payments from Stripe
    const allPayments = await fetchWithRetry(() => getAllPaymentsLowPrice());
    logger.info(`Fetched ${allPayments.length} total payments from Low Price Stripe account`);
    
    // ✅ Фильтруем успешные платежи (ВКЛЮЧАЕМ subscription update - это могут быть апселлы!)
    // Исключаем только тестовые платежи $0.60
    const successfulPayments = allPayments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      // ✅ УБРАЛИ исключение subscription update - это могут быть реальные апселлы!
      // Exclude test payments of $0.60
      if (p.amount === 60) return false;
      return true;
    });
    
    logger.info(`Found ${successfulPayments.length} successful payments (excluding test payments)`);
    
    // Filter out existing payments
    const newPayments = successfulPayments.filter(p => {
      if (existingPaymentIds.has(p.id)) {
        return false;
      }
      return true;
    });
    
    logger.info(`Processing ${newPayments.length} new payments (avoided ${successfulPayments.length - newPayments.length} duplicates)`);
    
    // Group payments by customer
    const customerGroups = new Map();
    for (const payment of newPayments) {
      const customerId = payment.customer;
      if (!customerId) continue;
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    let processed = 0;
    let newPurchases = 0;
    let updatedPurchases = 0;
    let failed = 0;
    const errors = [];
    
    // Process each customer group
    for (const [customerId, payments] of customerGroups.entries()) {
      try {
        const customer = await fetchWithRetry(() => getCustomerLowPrice(customerId));
        if (!customer) {
          logger.warn(`Low Price customer ${customerId} not found in Stripe`);
          failed += payments.length;
          continue;
        }
        
        // Sort payments by creation date
        payments.sort((a, b) => a.created - b.created);
        const firstPayment = payments[0];
        
        // Check if customer exists
        const existingRows = await lowPriceSheet.getRows();
        const existingCustomerRow = existingRows.find(row => {
          const rowCustomerId = row.get('Customer ID');
          return rowCustomerId === customerId;
        });
        
        if (existingCustomerRow) {
          // Update existing customer
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
          const allSuccessfulPayments = allPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.description && p.description.toLowerCase().includes('subscription update')) {
              return false;
            }
            if (p.amount === 60) return false;
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
          
          const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];
          const updatedRowData = formatPaymentForSheetsLowPrice(latestPayment, customer);
          
          await existingCustomerRow.save({
            'Purchase ID': `purchase_${customerId}`,
            'Total Amount': (totalAmountAll / 100).toFixed(2),
            'Payment Count': paymentCountAll.toString(),
            'Payment Intent IDs': paymentIdsAll.join(', '),
            'Created UTC': updatedRowData['Created UTC'],
            'Created Local (LA Time)': updatedRowData['Created Local (LA Time)']
          });
          
          await addLaTimeFormulaToLowPriceSheet(existingCustomerRow.rowNumber);
          updatedPurchases++;
          processed++;
          
        } else {
          // Add new customer - load ALL payments from Stripe (including all upsells)
          logger.info(`Adding new Low Price customer ${customerId} (loading ALL payments from Stripe)`);
          
          // ✅ КРИТИЧЕСКИ ВАЖНО: Загружаем ВСЕ платежи клиента из Stripe (не только новые из группы)
          // Это гарантирует, что основная покупка + все апселлы будут суммированы вместе
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
          const allSuccessfulPayments = allPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.description && p.description.toLowerCase().includes('subscription update')) {
              return false;
            }
            if (p.amount === 60) return false;
            return true;
          });
          
          // Сортируем по дате создания (первая покупка)
          allSuccessfulPayments.sort((a, b) => a.created - b.created);
          const firstPayment = allSuccessfulPayments[0];
          
          const rowData = formatPaymentForSheetsLowPrice(firstPayment, customer);
          
          // ✅ Суммируем ВСЕ платежи клиента (основная покупка + все апселлы)
          let totalAmount = 0;
          const paymentIds = [];
          for (const p of allSuccessfulPayments) {
            totalAmount += p.amount;
            paymentIds.push(p.id);
          }
          
          rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
          rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
          rowData['Payment Count'] = allSuccessfulPayments.length.toString();
          rowData['Payment Intent IDs'] = paymentIds.join(', ');
          
          const newRow = await lowPriceSheet.addRow(rowData);
          await addLaTimeFormulaToLowPriceSheet(newRow.rowNumber);
          
          newPurchases++;
          processed++;
        }
        
        if (processed % 10 === 0) {
          logger.info(`Processed ${processed} customers...`);
        }
        
      } catch (error) {
        failed++;
        errors.push({
          customerId,
          error: error.message
        });
        logger.error(`Failed to process customer ${customerId}`, error);
      }
    }
    
    const result = {
      success: true,
      message: `Mass export completed!`,
      totalPayments: allPayments.length,
      successfulPayments: successfulPayments.length,
      newPayments: newPayments.length,
      duplicatesAvoided: successfulPayments.length - newPayments.length,
      customersProcessed: processed,
      newPurchases,
      updatedPurchases,
      failed,
      errors: errors.slice(0, 10) // Limit errors
    };
    
    logger.info('Mass export completed', result);
    res.json(result);
    
  } catch (error) {
    logger.error('Error in mass export', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting all payments',
      error: error.message
    });
  }
});

// Add LA time formula to all existing rows in Primer sheet
app.post('/api/add-la-formula-all-primer', async (req, res) => {
  try {
    logger.info('Adding LA time formula to all rows in Primer sheet...');
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    const rows = await primerSheet.getRows();
    logger.info(`Found ${rows.length} rows in Primer sheet`);
    
    let updated = 0;
    let failed = 0;
    
    for (const row of rows) {
      try {
        const success = await addLaTimeFormulaToPrimerSheet(row.rowNumber);
        if (success) {
          updated++;
          if (updated % 10 === 0) {
            logger.info(`Added formula to ${updated} rows...`);
          }
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
        logger.warn(`Failed to add formula to row ${row.rowNumber}`, {
          error: error.message
        });
      }
    }
    
    const result = {
      success: true,
      message: `LA time formula added to Primer sheet`,
      totalRows: rows.length,
      updated,
      failed
    };
    
    logger.info('LA time formula update completed', result);
    res.json(result);
    
  } catch (error) {
    logger.error('Error adding LA time formula to Primer sheet', error);
    res.status(500).json({
      success: false,
      message: 'Error adding LA time formula',
      error: error.message
    });
  }
});

// Add LA time formula to all existing rows in LowPrice sheet
app.post('/api/add-la-formula-all-lowprice', async (req, res) => {
  try {
    logger.info('Adding LA time formula to all rows in LowPrice sheet...');
    
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();
    
    const rows = await lowPriceSheet.getRows();
    logger.info(`Found ${rows.length} rows in LowPrice sheet`);
    
    let updated = 0;
    let failed = 0;
    
    for (const row of rows) {
      try {
        const success = await addLaTimeFormulaToLowPriceSheet(row.rowNumber);
        if (success) {
          updated++;
          if (updated % 10 === 0) {
            logger.info(`Added formula to ${updated} rows...`);
          }
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`Failed to add formula to row ${row.rowNumber}`, error);
        failed++;
      }
    }
    
    const result = {
      success: true,
      message: `LA time formula added to LowPrice sheet`,
      totalRows: rows.length,
      updated,
      failed
    };
    
    logger.info('LA time formula update completed', result);
    res.json(result);
    
  } catch (error) {
    logger.error('Error adding LA time formula to LowPrice sheet', error);
    res.status(500).json({
      success: false,
      message: 'Error adding LA time formula',
      error: error.message
    });
  }
});

// Add LA Time column and update all records endpoint
app.post('/api/add-la-time-column', async (req, res) => {
  try {
    logger.info('Adding LA Time column and updating all records...');
    
    await googleSheets.initialize();
    const sheet = googleSheets.sheet;
    await sheet.loadHeaderRow();
    
    // Check if LA Time column exists
    let hasLaTimeColumn = sheet.headerValues.includes('Created Local (LA Time)');
    
    if (!hasLaTimeColumn) {
      logger.info('LA Time column not found, adding it...');
      
      // Add new column to headers
      const currentHeaders = sheet.headerValues;
      const utcPlus1Index = currentHeaders.indexOf('Created Local (UTC+1)');
      if (utcPlus1Index >= 0) {
        currentHeaders.splice(utcPlus1Index + 1, 0, 'Created Local (LA Time)');
      } else {
        const utcIndex = currentHeaders.indexOf('Created UTC');
        if (utcIndex >= 0) {
          currentHeaders.splice(utcIndex + 1, 0, 'Created Local (LA Time)');
        } else {
          currentHeaders.push('Created Local (LA Time)');
        }
      }
      
      await sheet.setHeaderRow(currentHeaders);
      await sheet.loadHeaderRow();
      hasLaTimeColumn = true;
      logger.info('LA Time column added successfully');
    }
    
    // Get all rows and update them
    const rows = await sheet.getRows();
    logger.info(`Found ${rows.length} rows to update`);
    
    let updated = 0;
    let skipped = 0;
    const errors = [];
    
    for (const row of rows) {
      try {
        const paymentIntentIds = row.get('Payment Intent IDs') || '';
        const existingLATime = row.get('Created Local (LA Time)') || '';
        
        // Skip if LA time already filled
        if (existingLATime && existingLATime !== '' && existingLATime !== 'N/A') {
          skipped++;
          continue;
        }
        
        if (!paymentIntentIds || paymentIntentIds === 'N/A') {
          skipped++;
          continue;
        }
        
        // Get first payment intent ID
        const firstPaymentId = paymentIntentIds.split(',')[0].trim();
        
        // Get payment from Stripe
        const payment = await fetchWithRetry(() => stripe.paymentIntents.retrieve(firstPaymentId));
        const customer = payment.customer ? await fetchWithRetry(() => getCustomer(payment.customer)) : null;
        
        // Format with LA time
        const formattedData = formatPaymentForSheets(payment, customer);
        
        // Update row with LA time
        await row.save({
          'Created Local (LA Time)': formattedData['Created Local (LA Time)']
        });
        
        updated++;
        
        if (updated % 10 === 0) {
          logger.info(`Updated ${updated} rows...`);
        }
        
      } catch (error) {
        errors.push({
          rowNumber: row.rowNumber,
          error: error.message
        });
        logger.error(`Error updating row ${row.rowNumber}`, error);
        skipped++;
      }
    }
    
    const result = {
      success: true,
      message: `LA Time column added and records updated`,
      columnAdded: !hasLaTimeColumn,
      totalRows: rows.length,
      updated,
      skipped,
      errors: errors.length > 0 ? errors.slice(0, 10) : [] // Limit errors
    };
    
    logger.info('LA Time column update completed', result);
    res.json(result);
    
  } catch (error) {
    logger.error('Error adding LA Time column', error);
    res.status(500).json({
      success: false,
      message: 'Error adding LA Time column',
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
app.get('/api/hourly-report', async (req, res) => {
  try {
    logger.info('📊 Generating hourly report (manual trigger)...');
    const report = await analytics.generateHourlyReport();
    if (report) {
      // При ручном вызове тоже проверяем, не был ли уже отправлен отчет за этот час
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const currentHour = now.getUTCHours();
      const hourlyReportKey = `hourly_${today}_${currentHour}`;
      
      // Отправляем только если еще не был отправлен автоматически
      if (!sentAlerts.hourlyReport || !sentAlerts.hourlyReport.has(hourlyReportKey)) {
        await sendTextNotifications(report);
        sentAlerts.hourlyReport.add(hourlyReportKey);
        logger.info(`✅ Hourly report sent manually (key: ${hourlyReportKey})`);
        res.json({
          success: true,
          message: 'Hourly report generated and sent',
          report: report,
          sent: true
        });
      } else {
        logger.info(`⏭️ Hourly report already sent automatically for this hour (key: ${hourlyReportKey})`);
        res.json({
          success: true,
          message: 'Hourly report already sent automatically for this hour',
          report: report,
          sent: false,
          alreadySent: true
        });
      }
    } else {
      res.json({
        success: true,
        message: 'No purchases found for today',
        report: null
      });
    }
  } catch (error) {
    logger.error('Error generating hourly report', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GEO Alert endpoint DISABLED - replaced by Hourly Report
// Hourly Report includes GEO data with platform breakdown and both Stripe accounts
app.get('/api/geo-alert', async (req, res) => {
  res.json({
    success: true,
    message: 'GEO Alert has been replaced by Hourly Report. Use /api/hourly-report instead.',
    deprecated: true,
    replacement: '/api/hourly-report'
  });
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
    
    // ✅ УНИФИЦИРОВАННЫЙ формат ключа
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
      // ✅ ДОПОЛНИТЕЛЬНАЯ ЗАЩИТА от дубликатов по содержимому
      const alertHash = Buffer.from(alert).toString('base64').slice(0, 50);
      const duplicateKey = `creative_content_${today}_${alertHash}`;
      
      if (sentAlerts.creativeAlert && sentAlerts.creativeAlert.has(duplicateKey)) {
        logger.info('🎨 Creative alert with same content already sent, skipping');
        return res.json({
          success: true,
          message: 'Creative alert with same content already sent'
        });
      }
      
      await sendTextNotifications(alert);
      
      // Отмечаем, что Creative алерт был отправлен
      sentAlerts.creativeAlert.add(creativeAlertKey);
      sentAlerts.creativeAlert.add(duplicateKey);
      
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

// Fix existing rows with missing data
app.post('/api/fix-existing-rows', async (req, res) => {
  try {
    logger.info('🔧 Fixing existing rows with missing Currency and Status data...');
    
    const allRows = await googleSheets.getAllRows();
    let fixedCount = 0;
    let errorCount = 0;
    
    // Process last 10 rows to add missing data
    const rowsToFix = allRows.slice(-10);
    
    for (const row of rowsToFix) {
      try {
        const customerId = row.get('Customer ID');
        if (!customerId || customerId === 'N/A') continue;
        
        // ✅ OPTIMIZATION: Get customer data and payments in parallel (safe - they're independent)
        const [customer, payments] = await Promise.all([
          getCustomer(customerId),
          getCustomerPayments(customerId)
        ]);
        
        if (!customer) continue;
        const successfulPayments = payments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        if (successfulPayments.length === 0) continue;
        
        const latestPayment = successfulPayments[successfulPayments.length - 1];
        
        // Update row with missing data
        const updateData = {
          'Currency': latestPayment.currency?.toUpperCase() || 'USD',
          'Status': latestPayment.status || 'succeeded',
          'UTM Source': customer.metadata?.utm_source || 'N/A',
          'UTM Medium': customer.metadata?.utm_medium || 'N/A',
          'UTM Campaign': customer.metadata?.utm_campaign || 'N/A'
        };
        
        // Update the row
        Object.keys(updateData).forEach(key => {
          row.set(key, updateData[key]);
        });
        
        await row.save();
        fixedCount++;
        
        logger.info(`Fixed row ${row.rowNumber} for customer ${customerId}`);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        errorCount++;
        logger.error(`Error fixing row ${row.rowNumber}:`, error);
      }
    }
    
    logger.info(`✅ Fixed ${fixedCount} rows, ${errorCount} errors`);
    
    res.json({
      success: true,
      message: `Fixed ${fixedCount} rows with missing data`,
      fixedCount,
      errorCount,
      totalProcessed: rowsToFix.length
    });
    
  } catch (error) {
    logger.error('Error fixing existing rows', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix existing rows',
      error: error.message
    });
  }
});

// Check last rows data
app.get('/api/check-last-rows', async (req, res) => {
  try {
    const allRows = await googleSheets.getAllRows();
    const lastRows = allRows.slice(-5);
    
    const formattedRows = lastRows.map(row => ({
      rowNumber: row.rowNumber,
      customerId: row.get('Customer ID'),
      currency: row.get('Currency'),
      status: row.get('Status'),
      utmSource: row.get('UTM Source'),
      utmCampaign: row.get('UTM Campaign'),
      totalAmount: row.get('Total Amount'),
      email: row.get('Email'),
      createdLocal: row.get('Created Local (UTC+1)')
    }));
    
    res.json({
      success: true,
      message: `Found ${formattedRows.length} last rows`,
      rows: formattedRows
    });
    
  } catch (error) {
    logger.error('Error checking last rows', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check last rows',
      error: error.message
    });
  }
});

// Fix all today's purchases
app.post('/api/fix-today-purchases', async (req, res) => {
  try {
    logger.info('🔧 Fixing all today\'s purchases with missing data...');
    
    // Get today's date in UTC+1
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
    
    logger.info(`Looking for purchases on ${todayStr} (UTC+1)`);
    
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
        fixedCount: 0,
        errorCount: 0
      });
    }
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const row of todayPurchases) {
      try {
        const customerId = row.get('Customer ID');
        if (!customerId || customerId === 'N/A') continue;
        
        // Get customer data from Stripe
        const customer = await getCustomer(customerId);
        if (!customer) continue;
        
        // Get customer payments
        const payments = await getCustomerPayments(customerId);
        const successfulPayments = payments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        if (successfulPayments.length === 0) continue;
        
        const latestPayment = successfulPayments[successfulPayments.length - 1];
        
        // Update row with missing data
        const updateData = {
          'Currency': latestPayment.currency?.toUpperCase() || 'USD',
          'Status': latestPayment.status || 'succeeded',
          'UTM Source': customer.metadata?.utm_source || 'N/A',
          'UTM Medium': customer.metadata?.utm_medium || 'N/A',
          'UTM Campaign': customer.metadata?.utm_campaign || 'N/A',
          'UTM Content': customer.metadata?.utm_content || 'N/A',
          'UTM Term': customer.metadata?.utm_term || 'N/A'
        };
        
        // Update the row
        Object.keys(updateData).forEach(key => {
          row.set(key, updateData[key]);
        });
        
        await row.save();
        fixedCount++;
        
        logger.info(`Fixed today's purchase row ${row.rowNumber} for customer ${customerId}`);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        errorCount++;
        logger.error(`Error fixing today's purchase row ${row.rowNumber}:`, error);
      }
    }
    
    logger.info(`✅ Fixed ${fixedCount} today's purchases, ${errorCount} errors`);
    
    res.json({
      success: true,
      message: `Fixed ${fixedCount} today's purchases with missing data`,
      date: todayStr,
      totalTodayPurchases: todayPurchases.length,
      fixedCount,
      errorCount
    });
    
  } catch (error) {
    logger.error('Error fixing today\'s purchases', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix today\'s purchases',
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
  
  // GEO Alert DISABLED - replaced by Hourly Report
  // Hourly Report includes GEO data with platform breakdown and both Stripe accounts
  // Не отправляем GEO Alert здесь, чтобы избежать дублирования с Hourly Report
  
  // Проверяем Creative Alert (должен отправиться в настроенное время)
  if (currentHour >= alertConfig.creativeAlertHours[0] && currentHour < alertConfig.creativeAlertHours[1]) {
    // ✅ УНИФИЦИРОВАННЫЙ формат ключа
    const morning = `creative_${today}_${alertConfig.creativeAlertHours[0]}`;
    if (!sentAlerts.creativeAlert.has(morning)) {
      logger.info('🎨 Sending missed morning creative alert...');
      try {
        // ✅ ПРЯМОЙ ВЫЗОВ ВМЕСТО FETCH
        const alert = await analytics.generateCreativeAlert();
        if (alert) {
          // ✅ ДОПОЛНИТЕЛЬНАЯ ЗАЩИТА от дубликатов по содержимому
          const alertHash = Buffer.from(alert).toString('base64').slice(0, 50);
          const duplicateKey = `creative_content_${today}_${alertHash}`;
          
          if (!sentAlerts.creativeAlert.has(duplicateKey)) {
            await sendTextNotifications(alert);
            sentAlerts.creativeAlert.add(morning);
            sentAlerts.creativeAlert.add(duplicateKey);
            logger.info('✅ Missed morning creative alert sent');
          } else {
            logger.info('⚠️ Missed morning creative alert duplicate detected, skipping');
          }
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

  // Автоматическая массовая выгрузка для LowPrice при старте (если мало записей)
  setTimeout(async () => {
    try {
      if (!stripeLowPrice || !ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
        return; // Skip if Low Price account not configured
      }

      const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
      const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
      
      try {
        await lowPriceSheet.loadHeaderRow();
        const rows = await lowPriceSheet.getRows();
        
        // Если в листе меньше 10 записей, запускаем массовую выгрузку
        if (rows.length < 10) {
          logger.info(`LowPrice sheet has only ${rows.length} records, starting mass export...`);
          console.log(`🚀 Запускаем массовую выгрузку всех платежей для LowPrice (найдено только ${rows.length} записей)...`);
          
          // Запускаем массовую выгрузку в фоне (все платежи)
          performSyncLogicLowPrice(true).then(result => {
            if (result.success) {
              logger.info('Mass export for LowPrice completed on startup', result);
              console.log(`✅ Массовая выгрузка завершена: ${result.processed} обработано, ${result.newPurchases} новых покупок`);
            } else {
              logger.error('Mass export for LowPrice failed on startup', result);
            }
          }).catch(error => {
            logger.error('Error in mass export for LowPrice on startup', error);
          });
        } else {
          logger.info(`LowPrice sheet has ${rows.length} records, skipping automatic mass export`);
        }
      } catch (error) {
        // Если лист не существует или пустой, запускаем массовую выгрузку
        logger.info('LowPrice sheet appears empty or missing, starting mass export...');
        console.log(`🚀 Запускаем массовую выгрузку всех платежей для LowPrice (лист пустой или не найден)...`);
        
        performSyncLogicLowPrice(true).then(result => {
          if (result.success) {
            logger.info('Mass export for LowPrice completed on startup', result);
            console.log(`✅ Массовая выгрузка завершена: ${result.processed} обработано, ${result.newPurchases} новых покупок`);
          }
        }).catch(error => {
          logger.error('Error in mass export for LowPrice on startup', error);
        });
      }
    } catch (error) {
      logger.error('Failed to check LowPrice sheet on startup', error);
    }
  }, 15000); // Через 15 секунд после старта

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
          
          // ✅ Проверяем оперативные алерты после успешной синхронизации
          try {
            const realTimeAlerts = await smartAlerts.checkAllRealTimeAlerts();
            if (realTimeAlerts) {
              await sendTextNotifications(realTimeAlerts);
              console.log('⚡ Real-time alerts sent');
            }
          } catch (alertError) {
            console.error('❌ Real-time alerts check failed:', alertError.message);
            // Не прерываем синхронизацию из-за ошибки алертов
          }
        } else {
          console.log(`⚠️ Scheduled sync skipped: ${result.message}`);
        }
      } catch (error) {
        console.error('❌ Scheduled sync failed:', error.message);
      }
    }, alertConfig.syncInterval * 60 * 1000); // Configurable sync interval
    
    // ✅ Автоматическая синхронизация LowPrice каждые 5 минут
    if (!ENV.AUTO_SYNC_DISABLED && ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
      const lowPriceSyncInterval = 5 * 60 * 1000; // 5 минут в миллисекундах
      console.log(`🔄 Starting LowPrice automatic sync every ${lowPriceSyncInterval / 1000 / 60} minutes...`);
      
      // Первая синхронизация через 1 минуту после старта
      setTimeout(async () => {
        try {
          console.log('🚀 Running initial LowPrice sync...');
          const result = await performSyncLogicLowPrice();
          if (result.success) {
            console.log(`✅ Initial LowPrice sync completed: ${result.processed || 0} customers processed, ${result.newPurchases || 0} new, ${result.updatedPurchases || 0} updated`);
          } else {
            console.log(`⚠️ Initial LowPrice sync failed: ${result.message}`);
          }
        } catch (error) {
          console.error('❌ Initial LowPrice sync failed:', error.message, error.stack);
        }
      }, 60000); // Через 1 минуту после старта
      
      // Затем каждые 5 минут (используем фиксированный интервал, не зависимый от alertConfig)
      setInterval(async () => {
        try {
          console.log('🔄 Running scheduled LowPrice sync...');
          const result = await performSyncLogicLowPrice();
          if (result.success) {
            console.log(`✅ LowPrice sync completed: ${result.processed || 0} customers processed, ${result.newPurchases || 0} new, ${result.updatedPurchases || 0} updated`);
            
            // ✅ Проверяем оперативные алерты после успешной синхронизации LowPrice
            try {
              const realTimeAlerts = await smartAlerts.checkAllRealTimeAlerts();
              if (realTimeAlerts) {
                await sendTextNotifications(realTimeAlerts);
                console.log('⚡ Real-time alerts sent (after LowPrice sync)');
              }
            } catch (alertError) {
              console.error('❌ Real-time alerts check failed:', alertError.message);
              // Не прерываем синхронизацию из-за ошибки алертов
            }
          } else {
            console.log(`⚠️ LowPrice sync failed: ${result.message}`);
          }
        } catch (error) {
          console.error('❌ LowPrice sync failed:', error.message, error.stack);
        }
      }, lowPriceSyncInterval); // Фиксированные 5 минут
    } else {
      if (ENV.AUTO_SYNC_DISABLED) {
        console.log('⚠️ LowPrice auto sync is DISABLED (AUTO_SYNC_DISABLED is set)');
      }
      if (!ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
        console.log('⚠️ LowPrice auto sync is DISABLED (STRIPE_SECRET_KEY_LOW_PRICE is not set)');
      }
    }
    
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
    
    // Hourly Report every hour (scheduled only, no initial run)
    const scheduleHourlyReport = () => {
      console.log('📊 Starting hourly reports...');
      
      hourlyReportInterval = setInterval(async () => {
        try {
          const now = new Date();
          const today = now.toISOString().split('T')[0]; // UTC date
          const currentHour = now.getUTCHours();
          const currentMinute = now.getUTCMinutes();
          
          const hourlyReportKey = `hourly_${today}_${currentHour}`;
          
          // Отправляем в начале каждого часа (только в 0-1 минуту, чтобы избежать дублирования)
          if (currentMinute >= 0 && currentMinute <= 1) {
            if (!sentAlerts.hourlyReport || !sentAlerts.hourlyReport.has(hourlyReportKey)) {
              console.log(`📊 Running hourly report for ${today} ${currentHour}:00 UTC...`);
              // ✅ ПРЯМОЙ ВЫЗОВ
              const report = await analytics.generateHourlyReport();
              if (report) {
                await sendTextNotifications(report);
                sentAlerts.hourlyReport.add(hourlyReportKey);
                console.log(`✅ Hourly report completed and marked as sent (key: ${hourlyReportKey})`);
              } else {
                console.log('ℹ️ No purchases found for today, skipping hourly report');
              }
            } else {
              console.log(`⏭️ Hourly report already sent for ${today} ${currentHour}:00 UTC (key: ${hourlyReportKey})`);
            }
          }
        } catch (error) {
          console.error('❌ Hourly report failed:', error.message);
        }
      }, 60 * 1000); // Проверяем каждую минуту
    };
    
    // GEO Alert DISABLED - replaced by Hourly Report which includes GEO data
    // Hourly Report now includes platform breakdown with country stats (US, AU, CA, WW)
    // and includes data from both Stripe accounts (payments + LowPrice)
    const scheduleGeoAlert = () => {
      console.log('🌍 GEO Alert disabled - using Hourly Report instead');
      // GEO Alert отключен, так как Hourly Report уже включает эту информацию
      // и более информативен (показывает платформы и данные из обоих Stripe аккаунтов)
      // НЕ создаем интервал - функция пустая, чтобы избежать дублирования отчетов
      return; // Явно выходим, чтобы ничего не делать
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
      
      // ✅ УНИФИЦИРОВАННЫЙ формат ключа: creative_YYYY-MM-DD_HH
      let lastSentHour = null;
      let lastSentDay = null;
      
      creativeAlertInterval = setInterval(async () => {
        const now = new Date();
        const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
        const hour = utcPlus1.getUTCHours();
        const minute = utcPlus1.getUTCMinutes();
        const today = utcPlus1.toISOString().split('T')[0];
        
        // ✅ УНИФИЦИРОВАННЫЙ формат ключа
        const alertKey = `creative_${today}_${hour}`;
        
        // ✅ СТРОГАЯ ЗАЩИТА: проверяем и по ключу, и по времени
        // Отправляем только если:
        // 1. Это нужный час (10:00 или 22:00)
        // 2. В пределах первой минуты (0-1) для избежания повторных срабатываний
        // 3. Ключ еще не был отправлен
        // 4. Это новый час или новый день
        if ((hour === 10 || hour === 22) && minute >= 0 && minute <= 1) {
          const isNewHour = lastSentHour !== hour || lastSentDay !== today;
          
          if (isNewHour && !sentAlerts.creativeAlert.has(alertKey)) {
            try {
              console.log(`🎨 Running creative alert for ${today} at ${hour}:00...`);
              // ✅ ПРЯМОЙ ВЫЗОВ
              const alert = await analytics.generateCreativeAlert();
              if (alert) {
                // ✅ ДОПОЛНИТЕЛЬНАЯ ЗАЩИТА: проверяем, не было ли уже отправлено такое же сообщение
                const alertHash = Buffer.from(alert).toString('base64').slice(0, 50);
                const duplicateKey = `creative_content_${today}_${alertHash}`;
                
                if (!sentAlerts.creativeAlert.has(duplicateKey)) {
                  await sendTextNotifications(alert);
                  sentAlerts.creativeAlert.add(alertKey);
                  sentAlerts.creativeAlert.add(duplicateKey);
                  lastSentHour = hour;
                  lastSentDay = today;
                  console.log('✅ Creative alert completed');
                } else {
                  console.log('⚠️ Creative alert duplicate detected, skipping');
                }
              }
            } catch (error) {
              console.error('❌ Creative alert failed:', error.message);
            }
          }
        }
      }, 60 * 1000); // ✅ Проверяем каждую минуту вместо каждых 2 минут
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
    scheduleHourlyReport();
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
    console.log('   ✅ Hourly reports every hour at :00 UTC (replaces GEO alerts, includes both Stripe accounts)');
    console.log('   ✅ Daily stats every morning at 7:00 UTC+1');
    console.log('   ✅ Creative alerts at 10:00 and 22:00 UTC+1');
    console.log('   ✅ Campaign analysis at 11:00 UTC+1');
    console.log('   ✅ Campaign reports at 16:00 UTC+1');
    console.log('   ✅ Weekly reports every Monday at 9 AM UTC+1');
    console.log('   ⚡ REAL-TIME alerts: Campaigns with 5+ purchases/hour, Creatives with 10+ purchases/hour');
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
