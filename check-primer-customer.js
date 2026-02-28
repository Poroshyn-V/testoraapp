#!/usr/bin/env node
/**
 * Скрипт для проверки конкретного клиента в таблице Primer
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { getCustomerPaymentsPrimer } = await import('./src/services/primer.js');
const { normalizePrimerPayment } = await import('./src/services/primer.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

async function checkPrimerCustomer(email) {
  console.log(`🔍 Ищу клиента с email: ${email}\n`);

  try {
    await googleSheets.initialize();
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    const allRows = await primerSheet.getRows();
    console.log(`📋 Всего записей в таблице: ${allRows.length}\n`);

    // Ищем по email
    const matchingRows = allRows.filter(row => {
      const rowEmail = row.get('Email') || '';
      return rowEmail.toLowerCase().includes(email.toLowerCase());
    });

    if (matchingRows.length === 0) {
      console.log(`❌ Клиент с email ${email} не найден в таблице Primer`);
      return;
    }

    console.log(`✅ Найдено ${matchingRows.length} записей для ${email}:\n`);

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
      console.log('');

      // Если есть Customer ID, получаем все платежи из Primer API
      if (customerId && customerId !== 'N/A') {
        try {
          console.log(`   🔍 Получаю все платежи из Primer API для Customer ID: ${customerId}...`);
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
          const normalizedPayments = allPayments.map(normalizePrimerPayment);
          
          // Фильтруем только успешные платежи
          const successfulPayments = normalizedPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
            return true;
          });

          console.log(`   📊 Найдено ${successfulPayments.length} успешных платежей в Primer API:`);
          
          // Сортируем по дате
          successfulPayments.sort((a, b) => a.created - b.created);
          
          for (let i = 0; i < successfulPayments.length; i++) {
            const payment = successfulPayments[i];
            const paymentDate = new Date(payment.created * 1000);
            const daysDiff = i > 0 ? Math.floor((payment.created - successfulPayments[0].created) / (24 * 60 * 60)) : 0;
            
            console.log(`   ${i === 0 ? '✅' : '⏭️'} Платеж ${i + 1}: ${payment.id}`);
            console.log(`      Дата: ${paymentDate.toISOString()}${daysDiff > 0 ? ` (через ${daysDiff} дней после первого)` : ' (ПЕРВЫЙ ПЛАТЕЖ)'}`);
            console.log(`      Сумма: $${(payment.amount / 100).toFixed(2)} ${payment.currency.toUpperCase()}`);
            console.log(`      Email: ${payment.email || 'N/A'}`);
            console.log(`      Country: ${payment.country || 'N/A'}`);
            console.log('');
          }

          // Проверяем, есть ли рекурентные платежи
          if (successfulPayments.length > 1) {
            const firstPayment = successfulPayments[0];
            const totalAmount = successfulPayments.reduce((sum, p) => sum + p.amount, 0) / 100;
            
            console.log(`   ⚠️ ВНИМАНИЕ: У клиента ${successfulPayments.length} платежей!`);
            console.log(`      Первый платеж: $${(firstPayment.amount / 100).toFixed(2)} (${new Date(firstPayment.created * 1000).toISOString()})`);
            console.log(`      Общая сумма всех платежей: $${totalAmount.toFixed(2)}`);
            console.log(`      В таблице указано: $${totalAmount}`);
            console.log(`      Разница: ${Math.abs(parseFloat(totalAmount) - totalAmount) < 0.01 ? '✅ Совпадает' : '❌ НЕ СОВПАДАЕТ'}`);
            console.log('');
          }

        } catch (error) {
          console.log(`   ❌ Ошибка при получении платежей из Primer API: ${error.message}`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Получаем email из аргументов командной строки
const email = process.argv[2] || 'veatre@hotmail.com';

checkPrimerCustomer(email)
  .then(() => {
    console.log('\n✅ Проверка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
