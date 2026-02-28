#!/usr/bin/env node
/**
 * Скрипт для массовой выгрузки всех платежей Primer в Google Sheets
 * Запуск: node export-all-primer.js
 */

// Загружаем переменные окружения из .env файла ПЕРЕД импортами
import dotenv from 'dotenv';
const result = dotenv.config();

if (result.error) {
  console.error('❌ Ошибка загрузки .env файла:', result.error);
  process.exit(1);
}

// Проверяем, что переменные загружены
if (!process.env.PRIMER_API_KEY) {
  console.error('❌ Ошибка: PRIMER_API_KEY не найден в .env файле!');
  console.error('   Убедитесь, что файл .env содержит:');
  console.error('   PRIMER_API_KEY=ваш_ключ');
  process.exit(1);
}

// Проверяем Google Sheets конфигурацию
if (!process.env.GOOGLE_SERVICE_EMAIL || !process.env.GOOGLE_SERVICE_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_DOC_ID) {
  console.error('❌ Ошибка: Google Sheets не настроен!');
  console.error('   Проверьте переменные в .env:');
  console.error('   GOOGLE_SERVICE_EMAIL');
  console.error('   GOOGLE_SERVICE_PRIVATE_KEY');
  console.error('   GOOGLE_SHEETS_DOC_ID');
  process.exit(1);
}

async function exportAllPrimerPayments() {
  // Динамически импортируем модули после загрузки dotenv
  const { ENV } = await import('./src/config/env.js');
  const { logger } = await import('./src/utils/logging.js');
  const googleSheetsModule = await import('./src/services/googleSheets.js');
  const googleSheets = googleSheetsModule.default;
  const { getAllPaymentsPrimer, getRecentPaymentsPrimer, getCustomerPaymentsPrimer, getCustomerPrimer, normalizePrimerPayment, isPrimerConfigured } = await import('./src/services/primer.js');
  const { formatPaymentForSheetsPrimer } = await import('./src/utils/formatting.js');
  const { sendPurchaseNotification } = await import('./src/services/notifications.js');
  const { fetchWithRetry } = await import('./src/utils/retry.js');
  
  try {
    logger.info('🚀 Начинаю массовую выгрузку всех платежей Primer в Google Sheets...');
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    
    // Получаем лист Primer
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    logger.info(`✅ Используется лист: "${primerSheet.title}"`);
    
    // Загружаем заголовки
    try {
      await primerSheet.loadHeaderRow();
      logger.info('✅ Заголовки загружены');
    } catch (error) {
      logger.warn(`⚠️ Не удалось загрузить заголовки (возможно лист пустой): ${error.message}`);
    }
    
    // Загружаем существующие Payment IDs
    const existingRows = await primerSheet.getRows();
    const existingPaymentIds = new Set();
    
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || '';
      if (paymentIdsField) {
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    logger.info(`📋 Найдено ${existingPaymentIds.size} существующих платежей в листе Primer`);
    
    // Получаем ВСЕ платежи из Primer API
    logger.info('📥 Получаю все платежи из Primer API (это может занять время)...');
    let allPayments = [];
    
    // Пробуем получить все платежи (может упасть на пагинации, но вернет что получил)
    allPayments = await getAllPaymentsPrimer();
    
    if (allPayments.length === 0) {
      logger.warn(`⚠️ Не получено платежей через getAllPaymentsPrimer, пробую getRecentPaymentsPrimer...`);
      // Fallback: получаем последние платежи за год
      allPayments = await getRecentPaymentsPrimer(1000, 365);
    }
    
    logger.info(`✅ Получено ${allPayments.length} платежей из Primer API`);
    
    if (allPayments.length === 0) {
      logger.error(`❌ Не удалось получить платежи из Primer API`);
      console.error('❌ Не удалось получить платежи. Проверьте PRIMER_API_KEY и фильтр application=testora');
      return;
    }
    
    // Нормализуем платежи
    const normalizedPayments = allPayments.map(normalizePrimerPayment);
    
    // Фильтруем успешные платежи
    const successfulPayments = normalizedPayments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
      return true;
    });
    
    logger.info(`✅ Найдено ${successfulPayments.length} успешных платежей`);
    
    // Фильтруем существующие платежи
    const newPayments = successfulPayments.filter(p => {
      if (existingPaymentIds.has(p.id)) {
        return false;
      }
      return true;
    });
    
    logger.info(`🆕 Обрабатываю ${newPayments.length} новых платежей (избежано ${successfulPayments.length - newPayments.length} дубликатов)`);
    
    if (newPayments.length === 0) {
      logger.info('ℹ️ Нет новых платежей для обработки');
      return;
    }
    
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
    
    logger.info(`📦 Сгруппировано ${newPayments.length} платежей в ${customerGroups.size} групп клиентов`);
    
    let processed = 0;
    let newPurchases = 0;
    let updatedPurchases = 0;
    let failed = 0;
    const errors = [];
    
    // Обрабатываем каждую группу клиентов
    for (const [customerId, payments] of customerGroups.entries()) {
      try {
        // Получаем клиента
        const customer = await fetchWithRetry(() => getCustomerPrimer(customerId));
        if (!customer) {
          logger.warn(`⚠️ Клиент Primer ${customerId} не найден`);
          failed += payments.length;
          continue;
        }
        
        // Сортируем платежи по дате создания
        payments.sort((a, b) => a.created - b.created);
        const firstPayment = payments[0];
        
        // Проверяем существование клиента в листе
        const allRows = await primerSheet.getRows();
        const existingCustomerRow = allRows.find(row => {
          const rowCustomerId = row.get('Customer ID');
          return rowCustomerId === customerId;
        });
        
        if (existingCustomerRow) {
          // Обновляем существующего клиента
          logger.info(`🔄 Обновляю существующего клиента ${customerId}`);
          
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
          const normalizedAllPayments = allPayments.map(normalizePrimerPayment);
          const allSuccessfulPayments = normalizedAllPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
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
          const updatedRowData = formatPaymentForSheetsPrimer(latestPayment, customer, { accountSource: 'primer' });
          
          await existingCustomerRow.save({
            'Purchase ID': `purchase_${customerId}`,
            'Total Amount': updatedRowData['Total Amount'],
            'Payment Count': paymentCountAll.toString(),
            'Payment Intent IDs': paymentIdsAll.join(', '),
            'Created UTC': updatedRowData['Created UTC'],
            'Created Local (UTC-8)': updatedRowData['Created Local (UTC-8)']
          });
          
          updatedPurchases++;
          processed++;
          
        } else {
          // Добавляем нового клиента
          logger.info(`➕ Добавляю нового клиента ${customerId}`);
          
          const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
          const normalizedAllPayments = allPayments.map(normalizePrimerPayment);
          const allSuccessfulPayments = normalizedAllPayments.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
            return true;
          });
          
          if (allSuccessfulPayments.length === 0) {
            logger.warn(`⚠️ Нет успешных платежей для клиента ${customerId}, пропускаю`);
            failed++;
            continue;
          }
          
          // Сортируем по дате создания (первая покупка)
          allSuccessfulPayments.sort((a, b) => a.created - b.created);
          const firstPayment = allSuccessfulPayments[0];
          
          const rowData = formatPaymentForSheetsPrimer(firstPayment, customer, { accountSource: 'primer' });
          
          // Суммируем ВСЕ платежи клиента
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
          
          // Добавляем новую строку
          await primerSheet.addRow(rowData);
          
          logger.info(`✅ Добавлен новый клиент ${customerId} в лист Primer`);
          
          // Отправляем уведомление для НОВОЙ покупки
          try {
            await sendPurchaseNotification(firstPayment, customer, {
              ...rowData,
              accountSource: 'primer',
              'Total Amount': rowData['Total Amount'],
              'Payment Count': rowData['Payment Count']
            });
            logger.info(`📱 Уведомление отправлено для новой покупки Primer: ${customerId}`);
          } catch (notifError) {
            logger.error(`❌ Не удалось отправить уведомление для покупки Primer ${customerId}`, {
              error: notifError.message
            });
            // Не прерываем процесс из-за ошибки уведомления
          }
          
          newPurchases++;
          processed++;
        }
        
        if (processed % 10 === 0) {
          logger.info(`📊 Обработано ${processed} клиентов...`);
        }
        
      } catch (error) {
        failed++;
        errors.push({
          customerId,
          error: error.message
        });
        logger.error(`❌ Ошибка при обработке клиента ${customerId}`, error);
      }
    }
    
    const result = {
      success: true,
      totalPayments: allPayments.length,
      successfulPayments: successfulPayments.length,
      newPayments: newPayments.length,
      duplicatesAvoided: successfulPayments.length - newPayments.length,
      customersProcessed: processed,
      newPurchases,
      updatedPurchases,
      failed,
      errors: errors.slice(0, 10)
    };
    
    logger.info('✅ Массовая выгрузка завершена!', result);
    
    console.log('\n📊 Результаты выгрузки:');
    console.log(`   Всего платежей из API: ${result.totalPayments}`);
    console.log(`   Успешных платежей: ${result.successfulPayments}`);
    console.log(`   Новых платежей: ${result.newPayments}`);
    console.log(`   Дубликатов избежано: ${result.duplicatesAvoided}`);
    console.log(`   Клиентов обработано: ${result.customersProcessed}`);
    console.log(`   Новых покупок: ${result.newPurchases}`);
    console.log(`   Обновлено покупок: ${result.updatedPurchases}`);
    console.log(`   Ошибок: ${result.failed}`);
    
    if (result.errors.length > 0) {
      console.log('\n❌ Ошибки:');
      result.errors.forEach(err => {
        console.log(`   - ${err.customerId}: ${err.error}`);
      });
    }
    
  } catch (error) {
    logger.error('❌ Критическая ошибка при массовой выгрузке', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

// Запускаем выгрузку
exportAllPrimerPayments()
  .then(async () => {
    const { logger } = await import('./src/utils/logging.js');
    logger.info('✅ Скрипт завершен успешно');
    console.log('✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch(async (error) => {
    try {
      const { logger } = await import('./src/utils/logging.js');
      logger.error('❌ Скрипт завершился с ошибкой', error);
    } catch (e) {
      // Если logger не доступен, просто выводим в консоль
    }
    console.error('❌ Скрипт завершился с ошибкой', error.message);
    process.exit(1);
  });

