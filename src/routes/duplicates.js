// Duplicate management endpoints
import express from 'express';
import { logger } from '../utils/logging.js';
import { duplicateChecker } from '../services/duplicateChecker.js';
import { googleSheets } from '../services/googleSheets.js';
import { fetchWithRetry } from '../utils/retry.js';

const router = express.Router();

// Check and fix duplicates endpoint
router.get('/api/check-duplicates', async (req, res) => {
  try {
    logger.info('🔍 Starting duplicate check...');
    
    // Use the new DuplicateChecker service
    const result = await duplicateChecker.findAllDuplicates();
    
    res.json({
      success: true,
      message: 'Duplicate check completed',
      duplicates: result.duplicates,
      totalDuplicates: result.duplicates.length,
      cacheStats: result.cacheStats
    });
  } catch (error) {
    logger.error('Error checking duplicates', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check duplicates',
      error: error.message
    });
  }
});

// Fix duplicates endpoint
router.post('/api/fix-duplicates', async (req, res) => {
  try {
    logger.info('🔧 Starting aggressive duplicate fix...');
    
    // Clear Google Sheets cache first
    googleSheets.clearCache();
    
    // Get all rows from Google Sheets
    const rows = await fetchWithRetry(() => googleSheets.getAllRows());
    logger.info(`Found ${rows.length} rows to check for duplicates`);
    
    // Group by customer ID
    const customerGroups = new Map();
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(row);
    }
    
    let deletedCount = 0;
    const duplicateGroups = [];
    
    // Process each customer group
    for (const [customerId, customerRows] of customerGroups.entries()) {
      if (customerRows.length > 1) {
        duplicateGroups.push({
          customerId,
          count: customerRows.length,
          rows: customerRows.map(r => r.rowNumber)
        });
        
        // Keep the first row, delete the rest
        const keepRow = customerRows[0];
        const deleteRows = customerRows.slice(1);
        
        // Sort by row number (delete from bottom to top to avoid shifting)
        deleteRows.sort((a, b) => b.rowNumber - a.rowNumber);
        for (const row of deleteRows) {
          try {
            await fetchWithRetry(() => row.delete());
            deletedCount++;
            logger.info(`Deleted duplicate row ${row.rowNumber} for customer ${customerId}`);
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            logger.error(`Failed to delete row ${row.rowNumber}:`, error.message);
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
        } catch (error) {
          logger.error(`Failed to update kept row for ${customerId}:`, error.message);
        }
      }
    }
    
    // Clear cache again after cleanup
    googleSheets.clearCache();
    
    logger.info(`✅ Duplicate fix completed! Deleted ${deletedCount} duplicate rows`);
    
    res.json({
      success: true,
      message: `Duplicate fix completed! Deleted ${deletedCount} duplicate rows`,
      deletedCount,
      duplicateGroups,
      totalGroups: duplicateGroups.length
    });
  } catch (error) {
    logger.error('Error fixing duplicates', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix duplicates',
      error: error.message
    });
  }
});

// Duplicate checker cache management endpoints
router.get('/api/duplicate-checker/stats', (req, res) => {
  try {
    const stats = duplicateChecker.getStats();
    res.json({
      success: true,
      message: 'Duplicate checker statistics',
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get duplicate checker stats',
      error: error.message
    });
  }
});

router.post('/api/duplicate-checker/refresh', async (req, res) => {
  try {
    logger.info('🔄 Refreshing duplicate checker cache...');
    const count = await duplicateChecker.refreshCache();
    
    res.json({
      success: true,
      message: 'Duplicate checker cache refreshed',
      customers: count
    });
  } catch (error) {
    logger.error('Error refreshing duplicate checker cache', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh duplicate checker cache',
      error: error.message
    });
  }
});

router.get('/api/duplicate-checker/customer/:customerId', (req, res) => {
  try {
    const { customerId } = req.params;
    
    if (duplicateChecker.customerExists(customerId)) {
      const info = duplicateChecker.getCustomerInfo(customerId);
      res.json({
        success: true,
        message: 'Customer found in duplicate checker',
        customerId,
        info
      });
    } else {
      res.json({
        success: true,
        message: 'Customer not found in duplicate checker',
        customerId,
        info: null
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check customer in duplicate checker',
      error: error.message
    });
  }
});

router.get('/api/duplicate-checker/payment-intent/:paymentIntentId', (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    const result = duplicateChecker.paymentIntentExists(paymentIntentId);
    
    res.json({
      success: true,
      message: 'Payment intent check completed',
      paymentIntentId,
      exists: result.exists,
      customerId: result.customerId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check payment intent',
      error: error.message
    });
  }
});

// Duplicate checker stats
router.get('/api/duplicates/cache-stats', (req, res) => {
  try {
    const stats = duplicateChecker.getStats();
    res.json({
      success: true,
      message: 'Duplicate checker cache statistics',
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

// Refresh duplicate cache manually
router.post('/api/duplicates/refresh-cache', async (req, res) => {
  try {
    const count = await duplicateChecker.refreshCache();
    res.json({
      success: true,
      message: 'Duplicate checker cache refreshed',
      customers: count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to refresh cache',
      error: error.message
    });
  }
});

// Find all duplicates
router.get('/api/duplicates/find', async (req, res) => {
  try {
    const result = await duplicateChecker.findAllDuplicates();
    res.json({
      success: true,
      message: 'Duplicate search completed',
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to find duplicates',
      error: error.message
    });
  }
});

// Sync locks endpoint
router.get('/api/sync-locks', (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Sync lock status',
      isSyncing: global.isSyncing || false,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get sync lock status',
      error: error.message
    });
  }
});

export default router;
