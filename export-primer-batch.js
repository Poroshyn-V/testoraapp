#!/usr/bin/env node
/**
 * Скрипт для выгрузки платежей Primer в Google Sheets батчами (по 10-20 штук)
 * Запуск: node export-primer-batch.js [размер_батча]
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
  process.exit(1);
}

// Проверяем Google Sheets конфигурацию
if (!process.env.GOOGLE_SERVICE_EMAIL || !process.env.GOOGLE_SERVICE_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_DOC_ID) {
  console.error('❌ Ошибка: Google Sheets не настроен!');
  process.exit(1);
}

async function exportPrimerPaymentsBatch(batchSize = 20) {
  // Динамически импортируем модули после загрузки dotenv
  const { ENV } = await import('./src/config/env.js');
  const { logger } = await import('./src/utils/logging.js');
  const googleSheetsModule = await import('./src/services/googleSheets.js');
  const googleSheets = googleSheetsModule.default;
  const { getRecentPaymentsPrimer, getCustomerPaymentsPrimer, getCustomerPrimer, normalizePrimerPayment, isPrimerConfigured } = await import('./src/services/primer.js');
  const { formatPaymentForSheetsPrimer } = await import('./src/utils/formatting.js');
  const { sendPurchaseNotification } = await import('./src/services/notifications.js');
  const { fetchWithRetry } = await import('./src/utils/retry.js');
  
  try {
    logger.info(`🚀 Начинаю выгрузку платежей Primer батчами по ${batchSize} штук...`);
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    
    // Получаем лист Primer
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    logger.info(`✅ Используется лист: "${primerSheet.title}"`);
    
    // Загружаем заголовки
    try {
      await primerSheet.loadHeaderRow();
      logger.info('✅ Заголовки загружены');
    } catch (error) {
      logger.warn(`⚠️ Не удалось загрузить заголовки: ${error.message}`);
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
    
    // Получаем платежи из Primer API (только последние, не все)
    logger.info(`📥 Получаю последние ${batchSize * 2} платежей из Primer API...`);
    const primerPayments = await fetchWithRetry(() => getRecentPaymentsPrimer(batchSize * 2, 30)); // Последние 30 дней
    logger.info(`✅ Получено ${primerPayments.length} платежей из Primer API`);
    
    if (primerPayments.length === 0) {
      logger.info('ℹ️ Нет платежей для обработки');
      return;
    }
    
    // Нормализуем платежи
    const normalizedPayments = primerPayments.map(normalizePrimerPayment);
    
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
    
    // Ограничиваем размер батча
    const paymentsToProcess = newPayments.slice(0, batchSize);
    logger.info(`📦 Обрабатываю батч из ${paymentsToProcess.length} платежей`);
    
    // Группируем платежи по клиентам
    const customerGroups = new Map();
    for (const payment of paymentsToProcess) {
      const customerId = payment.customer;
      if (!customerId) continue;
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    logger.info(`📦 Сгруппировано ${paymentsToProcess.length} платежей в ${customerGroups.size} групп клиентов`);
    
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
          
          // Добавляем формулу LA Time если еще нет
          try {
            const { ENV: ENV_DYNAMIC } = await import('./src/config/env.js');
            const { google } = await import('googleapis');
            const { JWT } = await import('google-auth-library');
            
            const PRIMER_SHEET_NAME = ENV_DYNAMIC.PRIMER_SHEET_NAME || 'Primer';
            await primerSheet.loadHeaderRow();
            const utcColumnIndex = primerSheet.headerValues.indexOf('Created UTC');
            const laTimeColumnIndex = primerSheet.headerValues.indexOf('Created Local (UTC-8)');
            
            if (utcColumnIndex !== -1 && laTimeColumnIndex !== -1) {
              const utcColumnLetter = String.fromCharCode(65 + utcColumnIndex);
              const laTimeColumnLetter = String.fromCharCode(65 + laTimeColumnIndex);
              const formula = `=IF(${utcColumnLetter}${existingCustomerRow.rowNumber}="","",TEXT(DATEVALUE(LEFT(${utcColumnLetter}${existingCustomerRow.rowNumber},10))+TIMEVALUE(MID(${utcColumnLetter}${existingCustomerRow.rowNumber},12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" UTC-8")`;
              
              const serviceAccountAuth = new JWT({
                email: ENV_DYNAMIC.GOOGLE_SERVICE_EMAIL,
                key: ENV_DYNAMIC.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
              });
              
              const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
              
              await sheets.spreadsheets.values.update({
                spreadsheetId: ENV_DYNAMIC.GOOGLE_SHEETS_DOC_ID,
                range: `${PRIMER_SHEET_NAME}!${laTimeColumnLetter}${existingCustomerRow.rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                  values: [[formula]]
                }
              });
            }
          } catch (formulaError) {
            logger.warn(`⚠️ Не удалось добавить формулу LA Time: ${formulaError.message}`);
          }
          
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
          const addResult = await primerSheet.addRow(rowData);
          
          // Добавляем формулу LA Time (UTC-8) в колонку Created Local (UTC-8)
          try {
            const { ENV: ENV_DYNAMIC } = await import('./src/config/env.js');
            const { google } = await import('googleapis');
            const { JWT } = await import('google-auth-library');
            
            const PRIMER_SHEET_NAME = ENV_DYNAMIC.PRIMER_SHEET_NAME || 'Primer';
            await primerSheet.loadHeaderRow();
            const utcColumnIndex = primerSheet.headerValues.indexOf('Created UTC');
            const laTimeColumnIndex = primerSheet.headerValues.indexOf('Created Local (UTC-8)');
            
            if (utcColumnIndex !== -1 && laTimeColumnIndex !== -1) {
              const utcColumnLetter = String.fromCharCode(65 + utcColumnIndex);
              const laTimeColumnLetter = String.fromCharCode(65 + laTimeColumnIndex);
              const formula = `=IF(${utcColumnLetter}${addResult.row.rowNumber}="","",TEXT(DATEVALUE(LEFT(${utcColumnLetter}${addResult.row.rowNumber},10))+TIMEVALUE(MID(${utcColumnLetter}${addResult.row.rowNumber},12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" UTC-8")`;
              
              const serviceAccountAuth = new JWT({
                email: ENV_DYNAMIC.GOOGLE_SERVICE_EMAIL,
                key: ENV_DYNAMIC.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
              });
              
              const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
              
              await sheets.spreadsheets.values.update({
                spreadsheetId: ENV_DYNAMIC.GOOGLE_SHEETS_DOC_ID,
                range: `${PRIMER_SHEET_NAME}!${laTimeColumnLetter}${addResult.row.rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                  values: [[formula]]
                }
              });
              
              logger.info(`✅ Добавлена формула LA Time для строки ${addResult.row.rowNumber}`);
            }
          } catch (formulaError) {
            logger.warn(`⚠️ Не удалось добавить формулу LA Time: ${formulaError.message}`);
            // Не прерываем процесс из-за ошибки формулы
          }
          
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
        
        // Небольшая задержка между обработкой клиентов для избежания лимитов API
        await new Promise(resolve => setTimeout(resolve, 500));
        
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
      batchSize: batchSize,
      totalPayments: primerPayments.length,
      successfulPayments: successfulPayments.length,
      newPayments: newPayments.length,
      processedPayments: paymentsToProcess.length,
      duplicatesAvoided: successfulPayments.length - newPayments.length,
      customersProcessed: processed,
      newPurchases,
      updatedPurchases,
      failed,
      errors: errors.slice(0, 10)
    };
    
    logger.info('✅ Батч выгрузки завершен!', result);
    
    console.log('\n📊 Результаты выгрузки батча:');
    console.log(`   Размер батча: ${result.batchSize}`);
    console.log(`   Получено платежей из API: ${result.totalPayments}`);
    console.log(`   Успешных платежей: ${result.successfulPayments}`);
    console.log(`   Новых платежей: ${result.newPayments}`);
    console.log(`   Обработано платежей: ${result.processedPayments}`);
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
    
    if (newPayments.length > batchSize) {
      console.log(`\nℹ️ Осталось еще ${newPayments.length - batchSize} новых платежей. Запустите скрипт снова для обработки следующего батча.`);
    }
    
  } catch (error) {
    logger.error('❌ Критическая ошибка при выгрузке батча', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

// Получаем размер батча из аргументов командной строки или используем по умолчанию 15
const batchSize = parseInt(process.argv[2]) || 15;

// Запускаем выгрузку
exportPrimerPaymentsBatch(batchSize)
  .then(() => {
    console.log('✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Скрипт завершился с ошибкой', error);
    process.exit(1);
  });
