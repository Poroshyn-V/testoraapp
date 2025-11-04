// Скрипт для выгрузки всех апселлов LowPrice в отдельную вкладку
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { getAllPaymentsLowPrice, getCustomerPaymentsLowPrice, getCustomerLowPrice } = await import('./src/services/stripe.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

async function exportAllLowPriceUpsells() {
  console.log('🚀 Запускаем выгрузку всех апселлов LowPrice в отдельную вкладку...\n');

  try {
    if (!ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
      console.error('❌ Второй Stripe аккаунт не настроен!');
      process.exit(1);
    }

    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    const UPSELLS_SHEET_NAME = 'LowPrice Upsells';
    
    await googleSheets.initialize();
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();
    
    const upsellsSheet = await googleSheets.getSheetByName(UPSELLS_SHEET_NAME);
    
    // Создаем заголовки если их нет
    try {
      await upsellsSheet.loadHeaderRow();
    } catch (error) {
      console.log(`📝 Создаем заголовки для "${UPSELLS_SHEET_NAME}"...`);
      const headers = [
        'Customer ID',
        'Email',
        'First Payment Date',
        'Latest Payment Date',
        'Total Payments',
        'Payment Intent IDs',
        'Total Amount',
        'Currency',
        'First Payment Amount',
        'Upsells Count',
        'Upsells Total',
        'Created UTC',
        'Created Local (LA Time)'
      ];
      await upsellsSheet.setHeaderRow(headers);
      console.log(`✅ Заголовки созданы!\n`);
    }

    // Получаем все записи из LowPrice листа
    const allRows = await lowPriceSheet.getRows();
    console.log(`📋 Найдено ${allRows.length} записей в листе "${LOW_PRICE_SHEET_NAME}"\n`);

    // Получаем все существующие записи из Upsells листа
    const existingUpsellsRows = await upsellsSheet.getRows();
    const existingCustomerIds = new Set();
    for (const row of existingUpsellsRows) {
      const customerId = row.get('Customer ID');
      if (customerId) existingCustomerIds.add(customerId);
    }
    console.log(`📋 Найдено ${existingCustomerIds.size} существующих записей в "${UPSELLS_SHEET_NAME}"\n`);

    let processed = 0;
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    // Обрабатываем каждую запись из LowPrice
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const customerId = row.get('Customer ID');
      
      if (!customerId || customerId === 'N/A') {
        skipped++;
        continue;
      }

      try {
        const paymentCount = parseInt(row.get('Payment Count') || 0);
        
        // Пропускаем если только один платеж (нет апселлов)
        if (paymentCount <= 1) {
          skipped++;
          continue;
        }

        console.log(`\n[${i + 1}/${allRows.length}] Обрабатываем клиента: ${customerId} (${paymentCount} платежей)`);

        // Загружаем ВСЕ платежи клиента из Stripe
        const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
        const allSuccessfulPayments = allPayments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          // ✅ УБРАЛИ исключение subscription update - это могут быть реальные апселлы!
          if (p.amount === 60) return false; // Исключаем тестовые $0.60
          return true;
        });

        if (allSuccessfulPayments.length <= 1) {
          console.log(`   ⚠️ Только ${allSuccessfulPayments.length} платеж, пропускаем`);
          skipped++;
          continue;
        }

        // Сортируем по дате
        allSuccessfulPayments.sort((a, b) => a.created - b.created);
        const firstPayment = allSuccessfulPayments[0];
        const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];

        const customer = await fetchWithRetry(() => getCustomerLowPrice(customerId));
        if (!customer) {
          console.log(`   ⚠️ Клиент не найден в Stripe`);
          skipped++;
          continue;
        }

        // Вычисляем сумму апселлов
        let upsellsTotal = 0;
        const upsellsCount = allSuccessfulPayments.length - 1;
        for (let i = 1; i < allSuccessfulPayments.length; i++) {
          upsellsTotal += allSuccessfulPayments[i].amount;
        }

        // Суммируем все платежи
        let totalAmount = 0;
        const paymentIds = [];
        for (const p of allSuccessfulPayments) {
          totalAmount += p.amount;
          paymentIds.push(p.id);
        }

        // Форматируем данные
        const firstPaymentDate = new Date(firstPayment.created * 1000);
        const latestPaymentDate = new Date(latestPayment.created * 1000);
        
        // Форматируем LA time
        const laFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
        
        const laParts = laFormatter.formatToParts(latestPaymentDate);
        const laYear = laParts.find(p => p.type === 'year').value;
        const laMonth = laParts.find(p => p.type === 'month').value;
        const laDay = laParts.find(p => p.type === 'day').value;
        const laHours = laParts.find(p => p.type === 'hour').value;
        const laMinutes = laParts.find(p => p.type === 'minute').value;
        const laSeconds = laParts.find(p => p.type === 'second').value;
        const createdLATime = `${laYear}-${laMonth.padStart(2, '0')}-${laDay.padStart(2, '0')} ${laHours.padStart(2, '0')}:${laMinutes.padStart(2, '0')}:${laSeconds.padStart(2, '0')}.000 LA Time`;

        const upsellData = {
          'Customer ID': customerId,
          'Email': customer.email || 'N/A',
          'First Payment Date': firstPaymentDate.toISOString(),
          'Latest Payment Date': latestPaymentDate.toISOString(),
          'Total Payments': allSuccessfulPayments.length.toString(),
          'Payment Intent IDs': paymentIds.sort().join(', '),
          'Total Amount': (totalAmount / 100).toFixed(2),
          'Currency': latestPayment.currency || 'USD',
          'First Payment Amount': (firstPayment.amount / 100).toFixed(2),
          'Upsells Count': upsellsCount.toString(),
          'Upsells Total': (upsellsTotal / 100).toFixed(2),
          'Created UTC': latestPaymentDate.toISOString(),
          'Created Local (LA Time)': createdLATime
        };

        // Проверяем, существует ли уже в Upsells листе
        const existingUpsellsRows = await upsellsSheet.getRows();
        const existingCustomerRow = existingUpsellsRows.find(row => {
          const rowCustomerId = row.get('Customer ID');
          return rowCustomerId === customerId;
        });

        if (existingCustomerRow) {
          // Обновляем существующую запись
          await existingCustomerRow.save(upsellData);
          updated++;
          console.log(`   ✅ Обновлено: ${upsellsCount} апселлов, $${(upsellsTotal / 100).toFixed(2)}`);
        } else {
          // Добавляем новую запись
          await upsellsSheet.addRow(upsellData);
          added++;
          console.log(`   ➕ Добавлено: ${upsellsCount} апселлов, $${(upsellsTotal / 100).toFixed(2)}`);
        }

        processed++;

      } catch (error) {
        errors.push({ customerId, error: error.message });
        console.error(`   ❌ Ошибка: ${error.message}`);
      }

      // Задержка между запросами
      if (i < allRows.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log('\n✅ Выгрузка завершена!\n');
    console.log('📊 Итоговые результаты:');
    console.log(`   Всего обработано: ${processed}`);
    console.log(`   Добавлено новых: ${added}`);
    console.log(`   Обновлено существующих: ${updated}`);
    console.log(`   Пропущено (нет апселлов): ${skipped}`);
    console.log(`   Ошибок: ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\n⚠️ Ошибки (первые 10):`);
      errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. Customer ${error.customerId}: ${error.error}`);
      });
    }

    console.log(`\n✅ Все апселлы выгружены в лист "${UPSELLS_SHEET_NAME}"!\n`);

  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

exportAllLowPriceUpsells();

