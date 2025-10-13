import { logger } from '../utils/logging.js';

class DistributedLock {
  constructor() {
    // Глобальная система блокировок для всех операций
    this.locks = new Map(); // key -> { timestamp, operation, pid }
    this.LOCK_TIMEOUT = 30000; // 30 секунд
    this.LOCK_CHECK_INTERVAL = 100; // Проверка каждые 100ms
  }
  
  // Попытка получить блокировку с retry
  async acquire(key, maxRetries = 50, retryDelay = 100) {
    const processId = `${process.pid}_${Date.now()}_${Math.random()}`;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const now = Date.now();
      const existingLock = this.locks.get(key);
      
      // Проверяем, не протух ли существующий lock
      if (existingLock) {
        const lockAge = now - existingLock.timestamp;
        
        if (lockAge > this.LOCK_TIMEOUT) {
          // Lock протух, удаляем его
          logger.warn(`Removing stale lock for ${key}`, {
            lockAge: `${lockAge}ms`,
            oldProcessId: existingLock.pid
          });
          this.locks.delete(key);
        } else {
          // Lock активен, ждём
          if (attempt % 10 === 0) {
            logger.info(`Waiting for lock on ${key}`, {
              attempt: attempt + 1,
              maxRetries,
              lockAge: `${lockAge}ms`,
              holder: existingLock.pid
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      // Пытаемся установить lock
      this.locks.set(key, {
        timestamp: now,
        operation: key,
        pid: processId
      });
      
      // Даём маленькую задержку для проверки race condition
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Проверяем, что наш lock не был перезаписан
      const currentLock = this.locks.get(key);
      if (currentLock && currentLock.pid === processId) {
        logger.info(`Lock acquired for ${key}`, {
          processId,
          attempt: attempt + 1
        });
        return processId;
      }
      
      // Наш lock был перезаписан, повторяем попытку
      logger.warn(`Lock collision detected for ${key}, retrying`, {
        attempt: attempt + 1
      });
    }
    
    throw new Error(`Failed to acquire lock for ${key} after ${maxRetries} attempts`);
  }
  
  // Освобождение блокировки
  release(key, processId) {
    const lock = this.locks.get(key);
    
    if (!lock) {
      logger.warn(`No lock found for ${key} during release`);
      return false;
    }
    
    if (lock.pid !== processId) {
      logger.error(`Lock ownership mismatch for ${key}`, {
        expected: processId,
        actual: lock.pid
      });
      return false;
    }
    
    this.locks.delete(key);
    logger.info(`Lock released for ${key}`, { processId });
    return true;
  }
  
  // Проверка наличия блокировки
  isLocked(key) {
    const lock = this.locks.get(key);
    if (!lock) return false;
    
    const lockAge = Date.now() - lock.timestamp;
    if (lockAge > this.LOCK_TIMEOUT) {
      // Протухший lock
      this.locks.delete(key);
      return false;
    }
    
    return true;
  }
  
  // Получение статистики
  getStats() {
    const now = Date.now();
    const activeLocks = [];
    
    for (const [key, lock] of this.locks.entries()) {
      const lockAge = now - lock.timestamp;
      if (lockAge <= this.LOCK_TIMEOUT) {
        activeLocks.push({
          key,
          age: `${lockAge}ms`,
          pid: lock.pid
        });
      }
    }
    
    return {
      activeLocks: activeLocks.length,
      locks: activeLocks
    };
  }
  
  // Очистка всех протухших блокировок
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, lock] of this.locks.entries()) {
      const lockAge = now - lock.timestamp;
      if (lockAge > this.LOCK_TIMEOUT) {
        this.locks.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} stale locks`);
    }
    
    return cleaned;
  }
  
  // Получение списка активных блокировок
  getActiveLocks() {
    const now = Date.now();
    const activeLocks = [];
    
    for (const [key, lock] of this.locks.entries()) {
      const lockAge = now - lock.timestamp;
      if (lockAge <= this.LOCK_TIMEOUT) {
        activeLocks.push({
          key,
          age: `${lockAge}ms`,
          ageMs: lockAge,
          pid: lock.pid,
          operation: lock.operation,
          timestamp: lock.timestamp,
          acquiredAt: new Date(lock.timestamp).toISOString()
        });
      }
    }
    
    return activeLocks.sort((a, b) => a.ageMs - b.ageMs);
  }
  
  // Принудительное освобождение блокировки
  forceRelease(key) {
    const lock = this.locks.get(key);
    
    if (!lock) {
      logger.warn(`No lock found for ${key} during force release`);
      return false;
    }
    
    this.locks.delete(key);
    logger.warn(`Force released lock for ${key}`, {
      pid: lock.pid,
      age: `${Date.now() - lock.timestamp}ms`
    });
    
    return true;
  }
}

export const distributedLock = new DistributedLock();

// Автоматическая очистка каждые 5 минут
setInterval(() => {
  distributedLock.cleanup();
}, 5 * 60 * 1000);
