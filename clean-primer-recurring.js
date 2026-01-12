#!/usr/bin/env node
/**
 * Скрипт для очистки таблицы Primer от рекурентных платежей
 * Оставляет только первый платеж каждого клиента, удаляет все остальные (рекуренты)
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const logger = pino({ 
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { getCustomerPaymentsPrimer, getCustomerPrimer } = await import('./src/services/primer.js');
const { normalizePrimerPayment } = await import('./src/services/primer.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');
const { formatPaymentForSheetsPrimer } = await import('./src/utils/formatting.js');

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
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Обрабатываем каждого клиента
    for (const { customerId, firstRow, recurringRows } of customersWithDuplicates) {
      try {
        console.log(`\n📋 Обрабатываю клиента ${customerId}:`);
        console.log(`   - Первая запись (строка ${firstRow.rowNumber}): ${firstRow.get('Created UTC')}`);
        console.log(`   - Рекурентных записей: ${recurringRows.length}`);

        // Получаем все платежи клиента из Primer API
        const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
        const normalizedPayments = allPayments.map(normalizePrimerPayment);
        
        // Фильтруем только успешные платежи
        const successfulPayments = normalizedPayments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
          return true;
        });

        if (successfulPayments.length === 0) {
          console.log(`   ⚠️ Нет успешных платежей для клиента ${customerId}, пропускаю`);
          continue;
        }

        // ✅ КРИТИЧЕСКИ ВАЖНО: Находим ТОЛЬКО первый платеж (самый ранний по дате)
        successfulPayments.sort((a, b) => a.created - b.created);
        const firstPayment = successfulPayments[0];
        
        console.log(`   ✅ Первый платеж: ${firstPayment.id} (${new Date(firstPayment.created * 1000).toISOString()})`);
        console.log(`   ⏭️ Пропускаем ${successfulPayments.length - 1} рекурентных платежей`);

        // Получаем customer данные
        let customer;
        try {
          customer = await fetchWithRetry(() => getCustomerPrimer(customerId));
        } catch (error) {
          logger.warn(`Не удалось получить customer ${customerId}, используем данные из payment`);
          customer = {
            id: customerId,
            email: firstPayment.email || null,
            country: firstPayment.country || null,
            address: firstPayment.country ? { country: firstPayment.country } : null,
            metadata: firstPayment.metadata || {}
          };
        }

        // Форматируем данные для обновления первой строки
        const rowData = formatPaymentForSheetsPrimer(firstPayment, customer, { accountSource: 'primer' });
        
        // Обновляем первую строку с правильными данными (только первый платеж)
        rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
        rowData['Total Amount'] = (firstPayment.amount / 100).toFixed(2);
        rowData['Payment Count'] = '1';
        rowData['Payment Intent IDs'] = firstPayment.id;

        // Убеждаемся что email и GEO заполнены
        if (!rowData['Email'] || rowData['Email'] === 'N/A') {
          rowData['Email'] = customer?.email || firstPayment.email || 'N/A';
        }
        if (!rowData['GEO'] || rowData['GEO'] === 'Unknown') {
          rowData['GEO'] = customer?.country || customer?.address?.country || firstPayment.country || 'Unknown';
        }

        // Обновляем первую строку
        await fetchWithRetry(() => firstRow.save(rowData));
        updatedCount++;
        console.log(`   ✅ Обновлена первая запись (строка ${firstRow.rowNumber})`);

        // Удаляем рекурентные строки (с конца, чтобы не сбить номера строк)
        recurringRows.sort((a, b) => b.rowNumber - a.rowNumber);
        for (const row of recurringRows) {
          try {
            await fetchWithRetry(() => row.delete());
            deletedCount++;
            console.log(`   🗑️ Удалена рекурентная запись (строка ${row.rowNumber})`);
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
    console.log(`   - Обновлено записей: ${updatedCount}`);
    console.log(`   - Удалено рекурентных записей: ${deletedCount}`);
    console.log(`   - Ошибок: ${errorCount}`);
    
    if (errors.length > 0) {
      console.log(`\n⚠️ Ошибки:`);
      errors.slice(0, 10).forEach(err => {
        console.log(`   - ${err.customerId}: ${err.error}`);
      });
    }

  } catch (error) {
    logger.error('Критическая ошибка при очистке', error);
    console.error('❌ Критическая ошибка:', error.message);
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
    logger.error('Ошибка выполнения скрипта', error);
    console.error('❌ Ошибка выполнения:', error.message);
    process.exit(1);
  });
