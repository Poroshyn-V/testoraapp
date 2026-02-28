// Скрипт для исправления покупок в LowPrice - добавление всех апселлов
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем .env ПЕРЕД всеми импортами
config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { getCustomerPaymentsLowPrice, getCustomerLowPrice } = await import('./src/services/stripe.js');
const { formatPaymentForSheetsLowPrice } = await import('./src/utils/formatting.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

async function fixLowPriceUpsells() {
  console.log('🚀 Запускаем исправление покупок в LowPrice - добавление всех апселлов...\n');

  try {
    if (!ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
      console.error('❌ Второй Stripe аккаунт не настроен!');
      process.exit(1);
    }

    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    
    // Инициализируем Google Sheets
    await googleSheets.initialize();
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();

    // Получаем ВСЕ строки из таблицы
    const allRows = await lowPriceSheet.getRows();
    console.log(`📋 Найдено ${allRows.length} записей в листе "${LOW_PRICE_SHEET_NAME}"\n`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    // Обрабатываем каждую запись
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const customerId = row.get('Customer ID');
      
      if (!customerId || customerId === 'N/A') {
        skipped++;
        continue;
      }

      try {
        console.log(`\n[${i + 1}/${allRows.length}] Обрабатываем клиента: ${customerId}`);
        
        // Загружаем ВСЕ платежи клиента из Stripe (с таймаутом)
        const allPayments = await Promise.race([
          fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId)),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout: загрузка платежей заняла больше 10 секунд')), 10000)
          )
        ]);
        const allSuccessfulPayments = allPayments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) {
            console.log(`   ⚠️ Пропущен платеж ${p.id}: status=${p.status}, customer=${p.customer}`);
            return false;
          }
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            console.log(`   ⚠️ Пропущен платеж ${p.id}: subscription update`);
            return false;
          }
          if (p.amount === 60) {
            console.log(`   ⚠️ Пропущен платеж ${p.id}: тестовый $0.60`);
            return false; // Исключаем тестовые $0.60
          }
          return true;
        });
        
        console.log(`   📊 Всего платежей в Stripe: ${allPayments.length}, после фильтрации: ${allSuccessfulPayments.length}`);

        if (allSuccessfulPayments.length === 0) {
          console.log(`   ⚠️ Нет успешных платежей для клиента ${customerId}`);
          skipped++;
          continue;
        }

        // Сортируем по дате создания
        allSuccessfulPayments.sort((a, b) => a.created - b.created);
        const firstPayment = allSuccessfulPayments[0];
        const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];

        // Получаем клиента (с таймаутом)
        const customer = await Promise.race([
          fetchWithRetry(() => getCustomerLowPrice(customerId)),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout: загрузка клиента заняла больше 5 секунд')), 5000)
          )
        ]);
        if (!customer) {
          console.log(`   ⚠️ Клиент ${customerId} не найден в Stripe`);
          skipped++;
          continue;
        }

        // Суммируем ВСЕ платежи (основная покупка + все апселлы)
        let totalAmount = 0;
        const paymentIds = [];
        for (const p of allSuccessfulPayments) {
          totalAmount += p.amount;
          paymentIds.push(p.id);
        }

        // Получаем текущие значения из таблицы
        const currentTotalAmount = parseFloat(row.get('Total Amount') || 0);
        const currentPaymentCount = parseInt(row.get('Payment Count') || 0);
        const currentPaymentIdsStr = row.get('Payment Intent IDs') || '';
        const currentPaymentIds = currentPaymentIdsStr.split(',').map(id => id.trim()).filter(Boolean);

        // Подготавливаем новые значения
        const newTotalAmount = (totalAmount / 100).toFixed(2);
        const newPaymentCount = allSuccessfulPayments.length;
        const newPaymentIds = paymentIds.sort().join(', ');
        const currentPaymentIdsSorted = currentPaymentIds.sort().join(', ');

        // ✅ ВСЕГДА показываем что найдено
        console.log(`   📊 Stripe: ${newPaymentCount} платежей, сумма $${newTotalAmount}`);
        console.log(`   📋 Таблица: ${currentPaymentCount} платежей, сумма $${currentTotalAmount.toFixed(2)}`);

        // Проверяем, нужно ли обновление (сравниваем отсортированные списки ID)
        const needsUpdate = 
          Math.abs(parseFloat(newTotalAmount) - currentTotalAmount) >= 0.01 ||
          newPaymentCount !== currentPaymentCount ||
          newPaymentIds !== currentPaymentIdsSorted;

        if (!needsUpdate) {
          console.log(`   ✅ Уже актуально - все платежи включены`);
          skipped++;
          continue;
        }

        console.log(`   🔄 ОБНОВЛЯЕМ: ${currentPaymentCount} → ${newPaymentCount} платежей, $${currentTotalAmount.toFixed(2)} → $${newTotalAmount}`);

        // Форматируем данные для обновления
        const updatedRowData = formatPaymentForSheetsLowPrice(latestPayment, customer);

        // Обновляем строку
        await row.save({
          'Purchase ID': `purchase_${customerId}`,
          'Total Amount': newTotalAmount,
          'Payment Count': newPaymentCount.toString(),
          'Payment Intent IDs': newPaymentIds,
          'Created UTC': updatedRowData['Created UTC'],
          'Created Local (LA Time)': updatedRowData['Created Local (LA Time)']
        });

        updated++;
        console.log(`   ✅ Обновлено успешно!`);

      } catch (error) {
        failed++;
        errors.push({
          customerId,
          error: error.message
        });
        console.error(`   ❌ Ошибка при обработке клиента ${customerId}:`, error.message);
        console.error(`   Stack:`, error.stack);
      }

      // Показываем прогресс каждые 10 записей
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Прогресс: ${i + 1}/${allRows.length} обработано (${updated} обновлено, ${skipped} пропущено, ${failed} ошибок)\n`);
      }

      // Небольшая задержка между запросами (уменьшена для ускорения)
      if (i < allRows.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log('\n✅ Исправление завершено!\n');
    console.log('📊 Итоговые результаты:');
    console.log(`   Всего записей: ${allRows.length}`);
    console.log(`   Обновлено: ${updated}`);
    console.log(`   Пропущено (уже актуально): ${skipped}`);
    console.log(`   Ошибок: ${failed}`);

    if (errors.length > 0) {
      console.log(`\n⚠️ Ошибки (первые 10):`);
      errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. Customer ${error.customerId}: ${error.error}`);
      });
    }

    console.log(`\n✅ Все покупки обновлены с учетом всех апселлов!\n`);

  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixLowPriceUpsells();

