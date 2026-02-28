#!/usr/bin/env node
/**
 * Скрипт для проверки записей с определенной суммой в таблице Primer
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');

async function checkPrimerAmount(targetAmount) {
  console.log(`🔍 Ищу записи с суммой $${targetAmount} в таблице Primer\n`);

  try {
    await googleSheets.initialize();
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    const allRows = await primerSheet.getRows();
    console.log(`📋 Всего записей в таблице: ${allRows.length}\n`);

    // Ищем по сумме (с небольшой погрешностью)
    const matchingRows = allRows.filter(row => {
      const rowAmount = parseFloat(row.get('Total Amount') || 0);
      return Math.abs(rowAmount - targetAmount) < 0.01;
    });

    if (matchingRows.length === 0) {
      console.log(`❌ Записей с суммой $${targetAmount} не найдено`);
      return;
    }

    console.log(`✅ Найдено ${matchingRows.length} записей с суммой $${targetAmount}:\n`);

    for (const row of matchingRows) {
      const customerId = row.get('Customer ID');
      const rowEmail = row.get('Email');
      const totalAmount = row.get('Total Amount');
      const paymentCount = row.get('Payment Count');
      const paymentIds = row.get('Payment Intent IDs');
      const createdUtc = row.get('Created UTC');
      const geo = row.get('GEO');
      
      console.log(`📋 Строка ${row.rowNumber}:`);
      console.log(`   Customer ID: ${customerId}`);
      console.log(`   Email: ${rowEmail}`);
      console.log(`   Total Amount: $${totalAmount}`);
      console.log(`   Payment Count: ${paymentCount}`);
      console.log(`   Payment IDs: ${paymentIds}`);
      console.log(`   Created UTC: ${createdUtc}`);
      console.log(`   GEO: ${geo}`);
      
      // Проверяем, может ли сумма быть суммой нескольких платежей
      if (parseFloat(paymentCount) === 1 && parseFloat(totalAmount) > 20) {
        console.log(`   ⚠️ ВНИМАНИЕ: Payment Count = 1, но сумма $${totalAmount} выглядит как несколько платежей!`);
        console.log(`   💡 Возможно, это рекурентный платеж, который был неправильно обработан`);
      }
      
      console.log('');
    }

    // Группируем по Customer ID чтобы найти дубликаты
    const customerGroups = new Map();
    for (const row of matchingRows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(row);
    }

    // Проверяем дубликаты
    for (const [customerId, rows] of customerGroups.entries()) {
      if (rows.length > 1) {
        console.log(`⚠️ Найдено ${rows.length} записей с одинаковым Customer ID: ${customerId}`);
        rows.forEach(row => {
          console.log(`   - Строка ${row.rowNumber}: $${row.get('Total Amount')}, Payment: ${row.get('Payment Intent IDs')}`);
        });
        console.log('');
      }
    }

  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Получаем сумму из аргументов командной строки
const amount = parseFloat(process.argv[2]) || 39.98;

checkPrimerAmount(amount)
  .then(() => {
    console.log('\n✅ Проверка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
