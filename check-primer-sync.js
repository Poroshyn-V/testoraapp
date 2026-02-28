#!/usr/bin/env node
/**
 * Скрипт для проверки и синхронизации Primer покупок
 */

import dotenv from 'dotenv';
dotenv.config();

async function checkAndSyncPrimer() {
  const { ENV } = await import('./src/config/env.js');
  const { logger } = await import('./src/utils/logging.js');
  
  // Динамически импортируем app.js чтобы получить performSyncLogicPrimer
  const appModule = await import('./app.js');
  
  // Получаем функцию из app.js (она должна быть экспортирована или доступна через глобальную область)
  // Если не экспортирована, используем другой способ
  
  try {
    console.log('🔄 Запускаю синхронизацию Primer...\n');
    
    // Используем прямой вызов через eval или через глобальную область
    // Но лучше использовать API endpoint или прямой импорт функции
    
    // Попробуем вызвать через performSyncLogicPrimer если она доступна
    if (typeof appModule.performSyncLogicPrimer === 'function') {
      const result = await appModule.performSyncLogicPrimer(false);
      console.log('✅ Результат синхронизации:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Если функция не экспортирована, используем другой подход
      console.log('⚠️ Функция не экспортирована, используем альтернативный метод...');
      
      // Можно использовать API endpoint или прямой вызов
      const response = await fetch('http://localhost:3000/api/sync-primer-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Результат синхронизации:');
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error('❌ Ошибка при вызове API:', response.statusText);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkAndSyncPrimer()
  .then(() => {
    console.log('\n✅ Проверка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });




