// Скрипт для объединения дубликатов клиентов в LowPrice - группировка всех платежей
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { getCustomerPaymentsLowPrice, getCustomerLowPrice } = await import('./src/services/stripe.js');
const { formatPaymentForSheetsLowPrice } = await import('./src/utils/formatting.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

async function mergeDuplicateCustomers() {
  console.log('🚀 Запускаем объединение дубликатов клиентов в LowPrice...\n');

  try {
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    
    await googleSheets.initialize();
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();

    const allRows = await lowPriceSheet.getRows();
    console.log(`📋 Найдено ${allRows.length} записей в листе "${LOW_PRICE_SHEET_NAME}"\n`);

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

    let merged = 0;
    let deleted = 0;
    const errors = [];

    for (const [customerId, rows] of customerGroups.entries()) {
      if (rows.length === 1) continue; // Нет дубликатов

      try {
        console.log(`\n🔄 Обрабатываем клиента ${customerId} (${rows.length} дубликатов)`);

        // Загружаем ВСЕ платежи клиента из Stripe
        const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
        const allSuccessfulPayments = allPayments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) return false;
          if (p.amount === 60) return false;
          return true;
        });

        if (allSuccessfulPayments.length === 0) {
          console.log(`   ⚠️ Нет успешных платежей`);
          continue;
        }

        // Сортируем по дате
        allSuccessfulPayments.sort((a, b) => a.created - b.created);
        const firstPayment = allSuccessfulPayments[0];
        const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];

        const customer = await fetchWithRetry(() => getCustomerLowPrice(customerId));
        if (!customer) {
          console.log(`   ⚠️ Клиент не найден в Stripe`);
          continue;
        }

        // Суммируем ВСЕ платежи
        let totalAmount = 0;
        const allPaymentIds = new Set();
        
        // Собираем все Payment IDs из существующих строк
        for (const row of rows) {
          const paymentIdsStr = row.get('Payment Intent IDs') || '';
          const paymentIds = paymentIdsStr.split(',').map(id => id.trim()).filter(Boolean);
          paymentIds.forEach(id => allPaymentIds.add(id));
        }

        // Добавляем Payment IDs из Stripe
        for (const p of allSuccessfulPayments) {
          totalAmount += p.amount;
          allPaymentIds.add(p.id);
        }

        const newTotalAmount = (totalAmount / 100).toFixed(2);
        const newPaymentCount = allPaymentIds.size;
        const newPaymentIds = Array.from(allPaymentIds).sort().join(', ');

        console.log(`   📊 Объединяем: ${rows.length} строк → 1 строка`);
        console.log(`   💰 Сумма: $${newTotalAmount} (${newPaymentCount} платежей)`);

        // Оставляем первую строку, удаляем остальные
        const keepRow = rows[0];
        const rowsToDelete = rows.slice(1);

        // Обновляем оставшуюся строку
        const updatedRowData = formatPaymentForSheetsLowPrice(latestPayment, customer);
        await keepRow.save({
          'Purchase ID': `purchase_${customerId}`,
          'Total Amount': newTotalAmount,
          'Payment Count': newPaymentCount.toString(),
          'Payment Intent IDs': newPaymentIds,
          'Created UTC': updatedRowData['Created UTC'],
          'Created Local (LA Time)': updatedRowData['Created Local (LA Time)']
        });

        // Удаляем дубликаты
        for (const row of rowsToDelete) {
          await row.delete();
          deleted++;
        }

        merged++;
        console.log(`   ✅ Объединено успешно!`);

      } catch (error) {
        errors.push({ customerId, error: error.message });
        console.error(`   ❌ Ошибка: ${error.message}`);
      }
    }

    console.log('\n✅ Объединение завершено!\n');
    console.log('📊 Итоговые результаты:');
    console.log(`   Клиентов с дубликатами: ${merged}`);
    console.log(`   Удалено дубликатов: ${deleted}`);
    console.log(`   Ошибок: ${errors.length}`);

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

mergeDuplicateCustomers();

