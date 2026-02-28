#!/usr/bin/env node
/**
 * Скрипт для очистки таблицы Primer от рекурентных платежей
 * Оставляет только первый платеж каждого клиента, удаляет все остальные (рекуренты)
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

async function cleanPrimerRecurring() {
  console.log('🚀 Запускаем очистку таблицы Primer от рекурентных платежей...\n');

  try {
    await googleSheets.initialize();
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    const allRows = await primerSheet.getRows();
    console.log(`📋 Найдено ${allRows.length} записей в таблице Primer\n`);

    // Группируем строки по Customer ID
    const customerGroups = new Map();
    for (const row of allRows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(row);
    }

    console.log(`👥 Найдено ${customerGroups.size} уникальных клиентов\n`);

    // Находим клиентов с несколькими записями (потенциальные рекуренты)
    const customersWithDuplicates = [];
    for (const [customerId, rows] of customerGroups.entries()) {
      if (rows.length > 1) {
        // Сортируем по дате создания (старые первыми)
        rows.sort((a, b) => {
          const dateA = new Date(a.get('Created UTC') || 0);
          const dateB = new Date(b.get('Created UTC') || 0);
          return dateA - dateB;
        });
        
        customersWithDuplicates.push({
          customerId,
          rows,
          firstRow: rows[0],
          recurringRows: rows.slice(1),
          count: rows.length
        });
      }
    }

    console.log(`🔍 Найдено ${customersWithDuplicates.length} клиентов с несколькими записями (рекуренты)\n`);

    if (customersWithDuplicates.length === 0) {
      console.log('✅ Рекурентных платежей не найдено!\n');
      return;
    }

    let deletedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Обрабатываем каждого клиента
    for (const { customerId, firstRow, recurringRows } of customersWithDuplicates) {
      try {
        console.log(`\n📋 Обрабатываю клиента ${customerId}:`);
        const firstRowDate = new Date(firstRow.get('Created UTC') || 0);
        console.log(`   ✅ Первая запись (строка ${firstRow.rowNumber}): ${firstRowDate.toISOString()}`);
        console.log(`   🗑️ Рекурентных записей для удаления: ${recurringRows.length}`);

        // Удаляем рекурентные строки (с конца, чтобы не сбить номера строк)
        recurringRows.sort((a, b) => b.rowNumber - a.rowNumber);
        for (const row of recurringRows) {
          try {
            const rowDate = new Date(row.get('Created UTC') || 0);
            const rowPaymentIds = (row.get('Payment Intent IDs') || '').split(',').map(id => id.trim()).filter(Boolean);
            
            await fetchWithRetry(() => row.delete());
            deletedCount++;
            console.log(`   🗑️ Удалена рекурентная запись (строка ${row.rowNumber}, дата: ${rowDate.toISOString()}, Payment: ${rowPaymentIds[0] || 'N/A'})`);
            // Небольшая задержка чтобы не превысить лимиты API
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            errorCount++;
            errors.push({ customerId, rowNumber: row.rowNumber, error: error.message });
            console.log(`   ❌ Ошибка при удалении строки ${row.rowNumber}: ${error.message}`);
          }
        }

      } catch (error) {
        errorCount++;
        errors.push({ customerId, error: error.message });
        console.log(`   ❌ Ошибка при обработке клиента ${customerId}: ${error.message}`);
      }
    }

    console.log(`\n✅ Очистка завершена!`);
    console.log(`   - Удалено рекурентных записей: ${deletedCount}`);
    console.log(`   - Ошибок: ${errorCount}`);
    
    if (errors.length > 0) {
      console.log(`\n⚠️ Ошибки:`);
      errors.slice(0, 10).forEach(err => {
        console.log(`   - ${err.customerId}: ${err.error}`);
      });
    }

  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Запускаем очистку
cleanPrimerRecurring()
  .then(() => {
    console.log('\n✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
