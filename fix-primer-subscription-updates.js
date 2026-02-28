#!/usr/bin/env node
/**
 * Скрипт для удаления subscription update платежей из таблицы Primer
 * Проверяет каждый Payment ID через Primer API и удаляет записи с "Subscription update"
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

async function fixPrimerSubscriptionUpdates() {
  console.log('🚀 Запускаем проверку и удаление subscription update платежей из таблицы Primer...\n');

  try {
    await googleSheets.initialize();
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    const allRows = await primerSheet.getRows();
    console.log(`📋 Найдено ${allRows.length} записей в таблице Primer\n`);

    const PRIMER_API_URL = ENV.PRIMER_API_URL || 'https://api.primer.io';
    const PRIMER_API_KEY = ENV.PRIMER_API_KEY;
    const PRIMER_API_VERSION = ENV.PRIMER_API_VERSION || '2.4';

    if (!PRIMER_API_KEY) {
      console.error('❌ Primer API key не настроен');
      return;
    }

    let checkedCount = 0;
    let deletedCount = 0;
    let errorCount = 0;
    const errors = [];
    const rowsToDelete = [];

    // Сначала проверяем все записи и собираем те, которые нужно удалить
    for (const row of allRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || '';
      if (!paymentIdsField || paymentIdsField === 'N/A') continue;

      const paymentIds = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
      if (paymentIds.length === 0) continue;

      // Проверяем первый Payment ID
      const firstPaymentId = paymentIds[0];
      checkedCount++;

      if (checkedCount % 10 === 0) {
        console.log(`   Проверено ${checkedCount} записей...`);
      }

      try {
        // Получаем детальную информацию о платеже через Primer API
        const url = `${PRIMER_API_URL}/payments/${firstPaymentId}`;
        const response = await fetch(url, {
          headers: {
            'X-API-KEY': PRIMER_API_KEY,
            'X-API-VERSION': PRIMER_API_VERSION,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          // Если платеж не найден, пропускаем
          if (response.status === 404) {
            continue;
          }
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const payment = await response.json();
        const description = payment.metadata?.description || '';
        const isSubscriptionUpdate = description.toLowerCase().includes('subscription update');

        if (isSubscriptionUpdate) {
          const customerId = row.get('Customer ID');
          const email = row.get('Email');
          const amount = row.get('Total Amount');
          
          rowsToDelete.push({
            row,
            paymentId: firstPaymentId,
            customerId,
            email,
            amount,
            description
          });
          
          console.log(`   ⏭️ Найден subscription update: строка ${row.rowNumber}, Payment: ${firstPaymentId}, Email: ${email}, Amount: $${amount}`);
        }

        // Небольшая задержка чтобы не превысить лимиты API
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errorCount++;
        errors.push({ rowNumber: row.rowNumber, paymentId: firstPaymentId, error: error.message });
        if (errorCount <= 5) {
          console.log(`   ⚠️ Ошибка при проверке строки ${row.rowNumber} (Payment: ${firstPaymentId}): ${error.message}`);
        }
      }
    }

    console.log(`\n📊 Результаты проверки:`);
    console.log(`   Проверено записей: ${checkedCount}`);
    console.log(`   Найдено subscription update: ${rowsToDelete.length}`);
    console.log(`   Ошибок: ${errorCount}\n`);

    if (rowsToDelete.length === 0) {
      console.log('✅ Subscription update платежей не найдено!');
      return;
    }

    // Удаляем найденные subscription update записи
    console.log(`🗑️ Удаляю ${rowsToDelete.length} subscription update записей...\n`);

    // Сортируем по номеру строки (с конца, чтобы не сбить номера)
    rowsToDelete.sort((a, b) => b.row.rowNumber - a.row.rowNumber);

    for (const { row, paymentId, email, amount } of rowsToDelete) {
      try {
        await fetchWithRetry(() => row.delete());
        deletedCount++;
        console.log(`   🗑️ Удалена строка ${row.rowNumber}: Payment ${paymentId}, Email: ${email}, Amount: $${amount}`);
        // Небольшая задержка чтобы не превысить лимиты API
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        errorCount++;
        errors.push({ rowNumber: row.rowNumber, paymentId, error: error.message });
        console.log(`   ❌ Ошибка при удалении строки ${row.rowNumber}: ${error.message}`);
      }
    }

    console.log(`\n✅ Очистка завершена!`);
    console.log(`   - Проверено записей: ${checkedCount}`);
    console.log(`   - Удалено subscription update: ${deletedCount}`);
    console.log(`   - Ошибок: ${errorCount}`);
    
    if (errors.length > 0 && errors.length <= 10) {
      console.log(`\n⚠️ Ошибки:`);
      errors.forEach(err => {
        console.log(`   - Строка ${err.rowNumber}, Payment ${err.paymentId}: ${err.error}`);
      });
    }

  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Запускаем очистку
fixPrimerSubscriptionUpdates()
  .then(() => {
    console.log('\n✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
