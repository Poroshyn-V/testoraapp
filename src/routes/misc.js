// Miscellaneous endpoints
import express from 'express';
import { logger } from '../utils/logging.js';
import { googleSheets } from '../services/googleSheets.js';
import { getRecentPayments, getCustomer, getCustomerPayments } from '../services/stripe.js';
import { fetchWithRetry } from '../utils/retry.js';
import { formatPaymentForSheets } from '../utils/formatting.js';
import { sendPurchaseNotification } from '../services/notifications.js';
import { duplicateChecker } from '../services/duplicateChecker.js';
import { purchaseCache } from '../services/purchaseCache.js';
import { distributedLock } from '../services/distributedLock.js';
import { metrics } from '../services/metrics.js';
import { analytics } from '../services/analytics.js';
import { sendTextNotifications } from '../services/notifications.js';
import { alertCooldown } from '../utils/alertCooldown.js';
import { alertConfig } from '../config/alertConfig.js';
import { performanceMonitor } from '../services/performanceMonitor.js';
import { smartAlerts } from '../services/smartAlerts.js';
import { campaignAnalyzer } from '../services/campaignAnalyzer.js';

const router = express.Router();

// Force notifications endpoint
router.post('/api/force-notifications', async (req, res) => {
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
        const customer = await fetchWithRetry(() => getCustomer(customerId));
        if (!customer) {
          results.push({
            customerId,
            success: false,
            error: 'Customer not found in Stripe'
          });
          continue;
        }
        
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
        
        const sheetData = {
          'Ad Name': sheetRow.get('Ad Name') || 'N/A',
          'Adset Name': sheetRow.get('Adset Name') || 'N/A',
          'Campaign Name': sheetRow.get('Campaign Name') || 'N/A',
          'Creative Link': sheetRow.get('Creative Link') || 'N/A',
          'Total Amount': sheetRow.get('Total Amount') || '0.00',
          'Payment Count': sheetRow.get('Payment Count') || '1',
          'Payment Intent IDs': sheetRow.get('Payment Intent IDs') || latestPayment.id
        };
        
        const amount = parseFloat(sheetData['Total Amount'] || 0);
        
        // VIP purchase alert (same logic as sendPurchaseNotification)
        if (amount >= alertConfig.vipPurchaseThreshold) {
          const vipMessage = `🚨 VIP Purchase Alert! $${amount.toFixed(2)} from ${customer.email}`;
          await sendTextNotifications(vipMessage);
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
      message: 'Failed to send notifications',
      error: error.message
    });
  }
});

// Debug UTM campaigns endpoint
router.get('/api/debug/utm-campaigns', async (req, res) => {
  try {
    const rows = await googleSheets.getAllRows();
    const utmCampaigns = new Set();
    const campaignName = new Set();
    
    for (const row of rows) {
      const utmCampaign = row.get('UTM Campaign');
      const campaign = row.get('Campaign Name');
      
      if (utmCampaign && utmCampaign !== 'N/A') {
        utmCampaigns.add(utmCampaign);
      }
      if (campaign && campaign !== 'N/A') {
        campaignName.add(campaign);
      }
    }
    
    res.json({
      success: true,
      message: 'UTM Campaign debug info',
      utmCampaigns: Array.from(utmCampaigns),
      campaignNames: Array.from(campaignName),
      totalRows: rows.length,
      utmCount: utmCampaigns.size,
      campaignCount: campaignName.size
    });
  } catch (error) {
    logger.error('Error debugging UTM campaigns', error);
    res.status(500).json({
      success: false,
      message: 'Failed to debug UTM campaigns',
      error: error.message
    });
  }
});

// Memory status endpoint
router.get('/api/memory-status', (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({
    success: true,
    message: 'Memory status',
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
    },
    uptime: `${Math.floor(uptime)}s`,
    timestamp: new Date().toISOString()
  });
});

// Cache stats endpoint
router.get('/api/cache-stats', (req, res) => {
  try {
    const stats = {
      purchaseCache: {
        size: purchaseCache.size,
        processedIds: purchaseCache.processedPurchaseIds.size
      },
      duplicateChecker: duplicateChecker.getStats(),
      googleSheets: googleSheets.getCacheStats()
    };
    
    res.json({
      success: true,
      message: 'Cache statistics',
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get cache stats',
      error: error.message
    });
  }
});

// Sync status endpoint
router.get('/api/sync-status', (req, res) => {
  res.json({
    success: true,
    message: 'Sync status',
    isSyncing: global.isSyncing || false,
    timestamp: new Date().toISOString()
  });
});

// Clean alerts endpoint
router.post('/api/clean-alerts', (req, res) => {
  try {
    const beforeSize = global.sentAlerts ? 
      Object.values(global.sentAlerts).reduce((sum, set) => sum + set.size, 0) : 0;
    
    // Clean old alert records
    if (global.sentAlerts) {
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      
      for (const [key, set] of Object.entries(global.sentAlerts)) {
        if (set instanceof Set) {
          // For sets, we can't easily filter by date, so we'll clear old entries
          // This is a simplified cleanup - in production you might want more sophisticated logic
          if (set.size > 100) {
            const entries = Array.from(set);
            set.clear();
            // Keep only the last 50 entries
            entries.slice(-50).forEach(entry => set.add(entry));
          }
        }
      }
    }
    
    const afterSize = global.sentAlerts ? 
      Object.values(global.sentAlerts).reduce((sum, set) => sum + set.size, 0) : 0;
    
    res.json({
      success: true,
      message: 'Alerts cleaned successfully',
      beforeSize,
      afterSize,
      cleaned: beforeSize - afterSize
    });
  } catch (error) {
    logger.error('Error cleaning alerts', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean alerts',
      error: error.message
    });
  }
});

// Metrics endpoint
router.get('/api/metrics', (req, res) => {
  try {
    const stats = metrics.getStats();
    res.json({
      success: true,
      message: 'Metrics statistics',
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get metrics',
      error: error.message
    });
  }
});

// Auto sync endpoint
router.get('/auto-sync', async (req, res) => {
  try {
    if (global.isSyncing) {
      return res.json({
        success: false,
        message: 'Sync already in progress'
      });
    }
    
    global.isSyncing = true;
    
    try {
      const result = await performSyncLogic();
      res.json(result);
    } finally {
      global.isSyncing = false;
    }
  } catch (error) {
    global.isSyncing = false;
    logger.error('Auto sync error', error);
    res.status(500).json({
      success: false,
      message: 'Auto sync failed',
      error: error.message
    });
  }
});

// Ping endpoint
router.get('/ping', (_req, res) => {
  res.json({
    success: true,
    message: 'pong',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
router.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString()
  });
});

// Full resync endpoint
router.post('/api/full-resync', async (req, res) => {
  try {
    logger.info('🔄 Starting full resync...');
    
    // Clear all caches
    purchaseCache.clear();
    duplicateChecker.clearCache();
    googleSheets.clearCache();
    
    // Reload all data
    await Promise.all([
      purchaseCache.reload(),
      duplicateChecker.refreshCache()
    ]);
    
    // Run sync
    const result = await performSyncLogic();
    
    res.json({
      success: true,
      message: 'Full resync completed',
      ...result
    });
  } catch (error) {
    logger.error('Full resync error', error);
    res.status(500).json({
      success: false,
      message: 'Full resync failed',
      error: error.message
    });
  }
});

// Clean duplicates endpoint
router.post('/api/clean-duplicates', async (req, res) => {
  try {
    logger.info('🧹 Starting duplicate cleanup...');
    
    const result = await duplicateChecker.findAllDuplicates();
    
    if (result.duplicates.length === 0) {
      return res.json({
        success: true,
        message: 'No duplicates found',
        duplicates: 0
      });
    }
    
    // Clean up duplicates
    let cleaned = 0;
    for (const duplicate of result.duplicates) {
      try {
        // Keep the first row, delete the rest
        const keepRow = duplicate.rows[0];
        const deleteRows = duplicate.rows.slice(1);
        
        for (const row of deleteRows) {
          await row.delete();
          cleaned++;
        }
      } catch (error) {
        logger.error(`Failed to clean duplicate for customer ${duplicate.customerId}`, error);
      }
    }
    
    res.json({
      success: true,
      message: `Cleaned ${cleaned} duplicate rows`,
      cleaned,
      totalDuplicates: result.duplicates.length
    });
  } catch (error) {
    logger.error('Clean duplicates error', error);
    res.status(500).json({
      success: false,
      message: 'Clean duplicates failed',
      error: error.message
    });
  }
});

// Test telegram endpoint
router.post('/api/test-telegram', async (req, res) => {
  try {
    const { message } = req.body;
    const testMessage = message || 'Test message from Stripe Ops API';
    
    await sendTextNotifications(testMessage);
    
    res.json({
      success: true,
      message: 'Test message sent to Telegram'
    });
  } catch (error) {
    logger.error('Test telegram error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test message',
      error: error.message
    });
  }
});

// Remove test data endpoint
router.post('/api/remove-test-data', async (req, res) => {
  try {
    const rows = await googleSheets.getAllRows();
    let removed = 0;
    
    for (const row of rows) {
      const email = row.get('Email');
      if (email && email.includes('test')) {
        await row.delete();
        removed++;
      }
    }
    
    res.json({
      success: true,
      message: `Removed ${removed} test rows`,
      removed
    });
  } catch (error) {
    logger.error('Remove test data error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove test data',
      error: error.message
    });
  }
});

// Test notifications endpoint
router.post('/api/test-notifications', async (req, res) => {
  try {
    const testMessage = '🧪 Test notification from Stripe Ops API';
    await sendTextNotifications(testMessage);
    
    res.json({
      success: true,
      message: 'Test notification sent'
    });
  } catch (error) {
    logger.error('Test notifications error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
});

// Metrics summary endpoint
router.get('/api/metrics/summary', (req, res) => {
  try {
    const summary = metrics.getSummary();
    res.json({
      success: true,
      message: 'Metrics summary',
      ...summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get metrics summary',
      error: error.message
    });
  }
});

// Reset metrics endpoint
router.post('/api/metrics/reset', (req, res) => {
  try {
    metrics.reset();
    res.json({
      success: true,
      message: 'Metrics reset successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to reset metrics',
      error: error.message
    });
  }
});

// Test batch operations endpoint
router.post('/api/test-batch-operations', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Test batch operations
    const testData = Array.from({ length: 10 }, (_, i) => ({
      'Customer ID': `test_customer_${i}`,
      'Email': `test${i}@example.com`,
      'Total Amount': '9.99',
      'Payment Count': '1',
      'Payment Intent IDs': `test_payment_${i}`
    }));
    
    const results = [];
    for (const data of testData) {
      try {
        const result = await googleSheets.addRowIfNotExists(data, 'Customer ID');
        results.push(result);
      } catch (error) {
        results.push({ error: error.message });
      }
    }
    
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      message: 'Batch operations test completed',
      duration: `${duration}ms`,
      results: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => r.error).length
    });
  } catch (error) {
    logger.error('Test batch operations error', error);
    res.status(500).json({
      success: false,
      message: 'Batch operations test failed',
      error: error.message
    });
  }
});

// Last purchases endpoint
router.get('/api/last-purchases', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const rows = await googleSheets.getAllRows();
    
    // Sort by creation date (assuming there's a date field)
    const sortedRows = rows
      .sort((a, b) => {
        const dateA = new Date(a.get('Created Local (UTC+1)') || 0);
        const dateB = new Date(b.get('Created Local (UTC+1)') || 0);
        return dateB - dateA;
      })
      .slice(0, limit);
    
    const purchases = sortedRows.map(row => ({
      customerId: row.get('Customer ID'),
      email: row.get('Email'),
      amount: row.get('Total Amount'),
      paymentCount: row.get('Payment Count'),
      date: row.get('Created Local (UTC+1)'),
      campaign: row.get('Campaign Name') || row.get('UTM Campaign') || 'Unknown'
    }));
    
    res.json({
      success: true,
      message: `Last ${purchases.length} purchases`,
      purchases
    });
  } catch (error) {
    logger.error('Last purchases error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get last purchases',
      error: error.message
    });
  }
});

// Fix sheets data endpoint
router.post('/api/fix-sheets-data', async (req, res) => {
  try {
    const { customerId, updates } = req.body;
    
    if (!customerId || !updates) {
      return res.status(400).json({
        success: false,
        error: 'customerId and updates are required'
      });
    }
    
    const rows = await googleSheets.findRows({ 'Customer ID': customerId });
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }
    
    const row = rows[0];
    await googleSheets.updateRow(row, updates);
    
    res.json({
      success: true,
      message: 'Sheet data updated successfully',
      customerId,
      updates
    });
  } catch (error) {
    logger.error('Fix sheets data error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix sheets data',
      error: error.message
    });
  }
});

// Debug customer endpoint
router.get('/api/debug-customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    // Get customer from Stripe
    const customer = await fetchWithRetry(() => getCustomer(customerId));
    
    // Get payments from Stripe
    const payments = await fetchWithRetry(() => getCustomerPayments(customerId));
    
    // Get rows from Google Sheets
    const sheetRows = await fetchWithRetry(() => 
      googleSheets.findRows({ 'Customer ID': customerId })
    );
    
    // Check in caches
    const inPurchaseCache = purchaseCache.has(customerId);
    const duplicateCheck = duplicateChecker.customerExists(customerId);
    
    res.json({
      success: true,
      message: 'Customer debug info',
      customerId,
      stripe: {
        customer: customer ? {
          id: customer.id,
          email: customer.email,
          created: new Date(customer.created * 1000).toISOString()
        } : null,
        payments: payments.length
      },
      sheets: {
        rows: sheetRows.length,
        data: sheetRows.map(row => ({
          rowNumber: row.rowNumber,
          email: row.get('Email'),
          amount: row.get('Total Amount'),
          paymentCount: row.get('Payment Count')
        }))
      },
      caches: {
        inPurchaseCache,
        inDuplicateChecker: duplicateCheck
      }
    });
  } catch (error) {
    logger.error('Debug customer error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to debug customer',
      error: error.message
    });
  }
});

// Debug geo endpoint
router.get('/api/debug-geo', async (req, res) => {
  try {
    const rows = await googleSheets.getAllRows();
    const geoStats = {};
    
    for (const row of rows) {
      const geo = row.get('GEO') || 'Unknown';
      if (!geoStats[geo]) {
        geoStats[geo] = {
          count: 0,
          totalAmount: 0
        };
      }
      geoStats[geo].count++;
      geoStats[geo].totalAmount += parseFloat(row.get('Total Amount') || 0);
    }
    
    res.json({
      success: true,
      message: 'GEO debug info',
      geoStats,
      totalRows: rows.length
    });
  } catch (error) {
    logger.error('Debug geo error', error);
    res.status(500).json({
      success: false,
      message: 'Failed to debug geo',
      error: error.message
    });
  }
});

export default router;
