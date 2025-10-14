// Sync operations endpoints
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

const router = express.Router();

// Load existing purchases from Google Sheets into memory
router.get('/api/load-existing', async (req, res) => {
  const timerId = metrics.startTimer('load_existing_purchases');
  const startTime = Date.now();
  try {
    metrics.increment('load_existing_started');
    logger.info('🔄 Loading existing purchases...', {
      timestamp: new Date().toISOString(),
      startTime: startTime
    });
    
    const rows = await fetchWithRetry(() => googleSheets.getAllRows());
    const existingPurchases = new Set();
    
    for (const row of rows) {
      const paymentIds = row.get('Payment Intent IDs');
      if (paymentIds) {
        const ids = paymentIds.split(', ').map(id => id.trim());
        ids.forEach(id => existingPurchases.add(id));
      }
    }
    
    // Update purchase cache
    purchaseCache.reload();
    
    const duration = Date.now() - startTime;
    metrics.endTimer(timerId);
    metrics.increment('load_existing_completed');
    
    logger.info('✅ Existing purchases loaded', {
      count: existingPurchases.size,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: `Loaded ${existingPurchases.size} existing purchases`,
      count: existingPurchases.size,
      duration: `${duration}ms`
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.endTimer(timerId);
    metrics.increment('load_existing_failed');
    logger.error('❌ Failed to load existing purchases', {
      error: error.message,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      success: false,
      message: 'Failed to load existing purchases',
      error: error.message
    });
  }
});

// Protected sync function to prevent overlapping synchronizations
router.post('/api/sync-payments', async (req, res) => {
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

// Core sync logic function
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
    
    // 🔒 ГЛОБАЛЬНАЯ БЛОКИРОВКА SYNC (только один sync за раз)
    const syncLockId = await distributedLock.acquire('sync_operation', 100, 200);
    
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
      // 🔓 Освобождаем sync operation lock
      distributedLock.release('sync_operation', syncLockId);
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

export default router;
