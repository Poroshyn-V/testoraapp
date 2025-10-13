// src/services/duplicateChecker.js
import googleSheets from './googleSheets.js';
import { logger } from '../utils/logging.js';

class DuplicateChecker {
  constructor() {
    // Кэш для быстрой проверки существующих customers
    this.customerCache = new Map(); // customerId -> row info
    this.lastCacheUpdate = null;
  }
  
  // Загрузка всех Customer ID в кэш
  async refreshCache() {
    try {
      logger.info('🔄 Refreshing duplicate checker cache...');
      const startTime = Date.now();
      
      const rows = await googleSheets.getAllRows();
      this.customerCache.clear();
      
      for (const row of rows) {
        const customerId = row.get('Customer ID');
        const purchaseId = row.get('Purchase ID');
        const paymentIntentIds = row.get('Payment Intent IDs');
        
        if (customerId && customerId !== 'N/A') {
          this.customerCache.set(customerId, {
            rowNumber: row.rowNumber,
            purchaseId,
            paymentIntentIds: paymentIntentIds ? paymentIntentIds.split(', ').map(id => id.trim()) : [],
            totalAmount: row.get('Total Amount'),
            paymentCount: row.get('Payment Count'),
            lastChecked: Date.now()
          });
        }
      }
      
      this.lastCacheUpdate = Date.now();
      const duration = Date.now() - startTime;
      
      logger.info('✅ Duplicate checker cache refreshed', {
        customers: this.customerCache.size,
        duration: `${duration}ms`
      });
      
      return this.customerCache.size;
      
    } catch (error) {
      logger.error('Error refreshing duplicate checker cache', error);
      throw error;
    }
  }
  
  // Проверка существования customer
  customerExists(customerId) {
    return this.customerCache.has(customerId);
  }
  
  // Получение информации о customer
  getCustomerInfo(customerId) {
    return this.customerCache.get(customerId);
  }
  
  // Проверка существования конкретного Payment Intent ID
  paymentIntentExists(paymentIntentId) {
    for (const [customerId, info] of this.customerCache.entries()) {
      if (info.paymentIntentIds.includes(paymentIntentId)) {
        return {
          exists: true,
          customerId,
          info
        };
      }
    }
    return {
      exists: false
    };
  }
  
  // Добавление customer в кэш
  addToCache(customerId, data) {
    this.customerCache.set(customerId, {
      ...data,
      lastChecked: Date.now()
    });
  }
  
  // Обновление customer в кэше
  updateCache(customerId, updates) {
    const existing = this.customerCache.get(customerId);
    if (existing) {
      this.customerCache.set(customerId, {
        ...existing,
        ...updates,
        lastChecked: Date.now()
      });
    }
  }
  
  // Удаление customer из кэша
  removeFromCache(customerId) {
    this.customerCache.delete(customerId);
  }
  
  // Проверка актуальности кэша (обновляем если старше 5 минут)
  isCacheStale() {
    if (!this.lastCacheUpdate) return true;
    const age = Date.now() - this.lastCacheUpdate;
    return age > 5 * 60 * 1000; // 5 минут
  }
  
  // Получение статистики
  getStats() {
    return {
      customersInCache: this.customerCache.size,
      lastCacheUpdate: this.lastCacheUpdate ? new Date(this.lastCacheUpdate).toISOString() : null,
      cacheAge: this.lastCacheUpdate ? `${Math.round((Date.now() - this.lastCacheUpdate) / 1000)}s` : null,
      isStale: this.isCacheStale()
    };
  }
  
  // Поиск дубликатов по всей таблице
  async findAllDuplicates() {
    try {
      logger.info('🔍 Searching for duplicates in Google Sheets...');
      
      const rows = await googleSheets.getAllRows();
      const customerGroups = new Map();
      const duplicates = [];
      
      // Группируем по Customer ID
      for (const row of rows) {
        const customerId = row.get('Customer ID');
        if (!customerId || customerId === 'N/A') continue;
        
        if (!customerGroups.has(customerId)) {
          customerGroups.set(customerId, []);
        }
        customerGroups.get(customerId).push({
          rowNumber: row.rowNumber,
          email: row.get('Email'),
          totalAmount: row.get('Total Amount'),
          paymentCount: row.get('Payment Count'),
          paymentIntentIds: row.get('Payment Intent IDs'),
          createdUtc: row.get('Created UTC')
        });
      }
      
      // Находим customers с несколькими строками
      for (const [customerId, customerRows] of customerGroups.entries()) {
        if (customerRows.length > 1) {
          // Сортируем по дате создания (старые первыми)
          customerRows.sort((a, b) => {
            const dateA = new Date(a.createdUtc || 0);
            const dateB = new Date(b.createdUtc || 0);
            return dateA - dateB;
          });
          
          duplicates.push({
            customerId,
            email: customerRows[0].email,
            count: customerRows.length,
            keepRow: customerRows[0].rowNumber, // Самая старая запись
            deleteRows: customerRows.slice(1).map(r => r.rowNumber),
            rows: customerRows
          });
        }
      }
      
      logger.info(`🔍 Found ${duplicates.length} customers with duplicates`);
      
      return {
        totalCustomers: customerGroups.size,
        totalRows: rows.length,
        duplicatesFound: duplicates.length,
        duplicates
      };
      
    } catch (error) {
      logger.error('Error finding duplicates', error);
      throw error;
    }
  }
}

export const duplicateChecker = new DuplicateChecker();
