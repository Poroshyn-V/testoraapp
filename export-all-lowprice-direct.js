// Прямой скрипт для массовой выгрузки всех платежей из второго Stripe аккаунта
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем .env ПЕРЕД всеми импортами
config({ path: resolve(__dirname, '.env') });

// Теперь импортируем модули после загрузки .env
const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { stripeLowPrice, getAllPaymentsLowPrice, getCustomerPaymentsLowPrice, getCustomerLowPrice } = await import('./src/services/stripe.js');
const { formatPaymentForSheetsLowPrice } = await import('./src/utils/formatting.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

async function exportAllLowPricePayments() {
  console.log('🚀 Запускаем массовую выгрузку ВСЕХ платежей из второго Stripe аккаунта...\n');

  try {
    if (!stripeLowPrice || !ENV.STRIPE_SECRET_KEY_LOW_PRICE) {
      console.error('❌ Второй Stripe аккаунт не настроен!');
      console.error('   Установите STRIPE_SECRET_KEY_LOW_PRICE в .env');
      process.exit(1);
    }

    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    
    // Инициализируем Google Sheets
    await googleSheets.initialize();
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();

    // Загружаем существующие payment IDs
    const existingRows = await lowPriceSheet.getRows();
    const existingPaymentIds = new Set();
    
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || '';
      if (paymentIdsField) {
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    console.log(`📋 Найдено ${existingPaymentIds.size} существующих платежей в листе "${LOW_PRICE_SHEET_NAME}"\n`);

    // Получаем ВСЕ платежи из Stripe
    console.log('📥 Загружаем все платежи из Stripe (это может занять время)...');
    const allPayments = await fetchWithRetry(() => getAllPaymentsLowPrice());
    console.log(`✅ Загружено ${allPayments.length} платежей из Stripe\n`);

    // ✅ Фильтруем успешные платежи (ВКЛЮЧАЕМ subscription update - это могут быть апселлы!)
    // Исключаем только тестовые платежи $0.60
    const successfulPayments = allPayments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      // ✅ УБРАЛИ исключение subscription update - это могут быть реальные апселлы!
      // Исключаем тестовые платежи $0.60
      if (p.amount === 60) return false;
      return true;
    });

    console.log(`✅ Найдено ${successfulPayments.length} успешных платежей (исключены тестовые $0.60)\n`);

    // Фильтруем существующие платежи
    const newPayments = successfulPayments.filter(p => {
      if (existingPaymentIds.has(p.id)) {
        return false;
      }
      return true;
    });

    console.log(`🆕 Обрабатываем ${newPayments.length} новых платежей (пропущено ${successfulPayments.length - newPayments.length} дубликатов)\n`);

    // Группируем платежи по клиентам
    const customerGroups = new Map();
    for (const payment of newPayments) {
      const customerId = payment.customer;
      if (!customerId) continue;
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }

    console.log(`👥 Группировка: ${customerGroups.size} уникальных клиентов\n`);

    let processed = 0;
    let newPurchases = 0;
    let updatedPurchases = 0;
    let failed = 0;
    const errors = [];

    // Обрабатываем каждую группу клиентов
    for (const [customerId, payments] of customerGroups.entries()) {
      try {
        const customer = await fetchWithRetry(() => getCustomerLowPrice(customerId));
        if (!customer) {
          console.warn(`⚠️ Клиент ${customerId} не найден в Stripe`);
          failed += payments.length;
          continue;
        }

        // Сортируем платежи по дате создания
        payments.sort((a, b) => a.created - b.created);
        const firstPayment = payments[0];

        // Проверяем, существует ли клиент в таблице
        const existingRows = await lowPriceSheet.getRows();
        const existingCustomerRow = existingRows.find(row => {
          const rowCustomerId = row.get('Customer ID');
          return rowCustomerId === customerId;
        });

        if (existingCustomerRow) {
          // Обновляем существующего клиента
          console.log(`🔄 Обновляем клиента ${customerId}...`);
          
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
          // ✅ ВКЛЮЧАЕМ ВСЕ успешные платежи (включая subscription update - это могут быть апселлы!)
          const allSuccessfulPayments = allPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            // ✅ УБРАЛИ исключение subscription update - это могут быть реальные апселлы!
            if (p.amount === 60) return false;
            return true;
          });

          let totalAmountAll = 0;
          let paymentCountAll = 0;
          const paymentIdsAll = [];

          for (const p of allSuccessfulPayments) {
            totalAmountAll += p.amount;
            paymentCountAll++;
            paymentIdsAll.push(p.id);
          }

          const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];
          const updatedRowData = formatPaymentForSheetsLowPrice(latestPayment, customer);

          await existingCustomerRow.save({
            'Purchase ID': `purchase_${customerId}`,
            'Total Amount': (totalAmountAll / 100).toFixed(2),
            'Payment Count': paymentCountAll.toString(),
            'Payment Intent IDs': paymentIdsAll.join(', '),
            'Created UTC': updatedRowData['Created UTC'],
            'Created Local (LA Time)': updatedRowData['Created Local (LA Time)']
          });

          updatedPurchases++;
          processed++;

        } else {
          // Добавляем нового клиента - загружаем ВСЕ платежи клиента (включая апселлы)
          console.log(`➕ Добавляем нового клиента ${customerId}...`);
          
          // ✅ Загружаем ВСЕ платежи клиента из Stripe (не только новые из группы)
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
          const allSuccessfulPayments = allPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.description && p.description.toLowerCase().includes('subscription update')) {
              return false;
            }
            if (p.amount === 60) return false; // Исключаем тестовые $0.60
            return true;
          });
          
          // Сортируем по дате создания
          allSuccessfulPayments.sort((a, b) => a.created - b.created);
          const firstPayment = allSuccessfulPayments[0];
          
          const rowData = formatPaymentForSheetsLowPrice(firstPayment, customer);

          // ✅ Суммируем ВСЕ платежи клиента (основная покупка + все апселлы)
          let totalAmount = 0;
          const paymentIds = [];
          for (const p of allSuccessfulPayments) {
            totalAmount += p.amount;
            paymentIds.push(p.id);
          }

          rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
          rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
          rowData['Payment Count'] = allSuccessfulPayments.length.toString();
          rowData['Payment Intent IDs'] = paymentIds.join(', ');

          await lowPriceSheet.addRow(rowData);

          newPurchases++;
          processed++;
        }

        if (processed % 10 === 0) {
          console.log(`📊 Обработано ${processed} клиентов...`);
        }

      } catch (error) {
        failed++;
        errors.push({
          customerId,
          error: error.message
        });
        console.error(`❌ Ошибка при обработке клиента ${customerId}:`, error.message);
      }
    }

    console.log('\n✅ Массовая выгрузка завершена!\n');
    console.log('📊 Итоговые результаты:');
    console.log(`   Всего платежей в Stripe: ${allPayments.length}`);
    console.log(`   Успешных платежей: ${successfulPayments.length}`);
    console.log(`   Новых платежей: ${newPayments.length}`);
    console.log(`   Дубликатов пропущено: ${successfulPayments.length - newPayments.length}`);
    console.log(`   Клиентов обработано: ${processed}`);
    console.log(`   Новых покупок добавлено: ${newPurchases}`);
    console.log(`   Существующих покупок обновлено: ${updatedPurchases}`);
    console.log(`   Ошибок: ${failed}`);

    if (errors.length > 0) {
      console.log(`\n⚠️ Ошибки (первые 10):`);
      errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. Customer ${error.customerId}: ${error.error}`);
      });
    }

    console.log(`\n✅ Все платежи выгружены в лист "${LOW_PRICE_SHEET_NAME}"!\n`);

  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

exportAllLowPricePayments();

