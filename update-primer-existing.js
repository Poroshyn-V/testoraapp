#!/usr/bin/env node
/**
 * Скрипт для обновления существующих строк в Primer листе:
 * 1. Добавление email из Primer API
 * 2. Добавление формулы LA Time (UTC-8) в колонку Created Local (UTC-8)
 * Запуск: node update-primer-existing.js
 */

// Загружаем переменные окружения из .env файла ПЕРЕД импортами
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.PRIMER_API_KEY) {
  console.error('❌ Ошибка: PRIMER_API_KEY не найден в .env файле!');
  process.exit(1);
}

if (!process.env.GOOGLE_SERVICE_EMAIL || !process.env.GOOGLE_SERVICE_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_DOC_ID) {
  console.error('❌ Ошибка: Google Sheets не настроен!');
  process.exit(1);
}

async function updateExistingPrimerRows() {
  // Динамически импортируем модули после загрузки dotenv
  const { ENV } = await import('./src/config/env.js');
  const { logger } = await import('./src/utils/logging.js');
  const googleSheetsModule = await import('./src/services/googleSheets.js');
  const googleSheets = googleSheetsModule.default;
  const { getCustomerPrimer, normalizePrimerPayment } = await import('./src/services/primer.js');
  
  try {
    logger.info('🔄 Начинаю обновление существующих строк в Primer листе...');
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    
    // Получаем лист Primer
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    logger.info(`✅ Используется лист: "${primerSheet.title}"`);
    
    // Загружаем заголовки
    await primerSheet.loadHeaderRow();
    logger.info('✅ Заголовки загружены');
    
    // Загружаем все строки
    const rows = await primerSheet.getRows();
    logger.info(`📋 Найдено ${rows.length} строк в листе Primer`);
    
    if (rows.length === 0) {
      logger.info('ℹ️ Нет строк для обновления');
      return;
    }
    
    // Находим индексы колонок
    const utcColumnIndex = primerSheet.headerValues.indexOf('Created UTC');
    const laTimeColumnIndex = primerSheet.headerValues.indexOf('Created Local (UTC-8)');
    const emailColumnIndex = primerSheet.headerValues.indexOf('Email');
    const customerIdColumnIndex = primerSheet.headerValues.indexOf('Customer ID');
    
    if (utcColumnIndex === -1 || laTimeColumnIndex === -1 || emailColumnIndex === -1 || customerIdColumnIndex === -1) {
      logger.error('❌ Не найдены необходимые колонки в листе Primer');
      return;
    }
    
    const utcColumnLetter = String.fromCharCode(65 + utcColumnIndex);
    const laTimeColumnLetter = String.fromCharCode(65 + laTimeColumnIndex);
    const emailColumnLetter = String.fromCharCode(65 + emailColumnIndex);
    
    // Формула для LA Time (UTC-8)
    const laTimeFormula = (rowNumber) => 
      `=IF(${utcColumnLetter}${rowNumber}="","",TEXT(DATEVALUE(LEFT(${utcColumnLetter}${rowNumber},10))+TIMEVALUE(MID(${utcColumnLetter}${rowNumber},12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" UTC-8")`;
    
    // Google Sheets API для массового обновления
    const { JWT } = await import('google-auth-library');
    const { google } = await import('googleapis');
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
    
    let updated = 0;
    let emailUpdated = 0;
    let geoUpdated = 0;
    let formulaUpdated = 0;
    let failed = 0;
    const errors = [];
    
    // Обновляем каждую строку
    for (const row of rows) {
      try {
        const customerId = row.get('Customer ID');
        const currentEmail = row.get('Email') || '';
        const currentGeo = row.get('GEO') || '';
        const currentLaTime = row.get('Created Local (UTC-8)') || '';
        
        logger.info(`📋 Строка ${row.rowNumber}: Customer ID=${customerId}, Email='${currentEmail}', GEO='${currentGeo}'`);
        
        if (!customerId || customerId === 'N/A') {
          logger.warn(`⚠️ Строка ${row.rowNumber}: нет Customer ID, пропускаю`);
          continue;
        }
        
        let needsUpdate = false;
        const updates = {};
        
        // Всегда пытаемся обновить email и GEO из Primer API
        let emailFromAPI = null;
        let countryFromAPI = null;
        
        // Сначала пробуем получить через payment ID (более надежно)
        const paymentIdsField = row.get('Payment Intent IDs') || '';
        if (paymentIdsField && paymentIdsField !== 'N/A') {
          const paymentIds = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
          if (paymentIds.length > 0) {
            const firstPaymentId = paymentIds[0];
            try {
              const { ENV } = await import('./src/config/env.js');
              const { fetchWithRetry } = await import('./src/utils/retry.js');
              
              const paymentDetailResponse = await fetchWithRetry(() => 
                fetch(`https://api.primer.io/payments/${firstPaymentId}`, {
                  headers: {
                    'X-API-KEY': ENV.PRIMER_API_KEY,
                    'X-API-VERSION': ENV.PRIMER_API_VERSION || '2.4',
                    'Content-Type': 'application/json'
                  }
                })
              );
              
              if (paymentDetailResponse.ok) {
                const paymentDetail = await paymentDetailResponse.json();
                
                emailFromAPI = paymentDetail.customer?.emailAddress 
                  || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
                  || null;
                
                countryFromAPI = paymentDetail.order?.countryCode 
                  || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
                  || null;
                
                if (emailFromAPI || countryFromAPI) {
                  logger.info(`✅ Получены данные из payment ${firstPaymentId} для ${customerId}: email=${emailFromAPI || 'нет'}, country=${countryFromAPI || 'нет'}`);
                }
              }
            } catch (paymentError) {
              logger.debug(`Не удалось получить payment ${firstPaymentId}: ${paymentError.message}`);
            }
          }
        }
        
        // Если не получили через payment ID, пробуем через customer API
        if ((!emailFromAPI || !countryFromAPI)) {
          try {
            const customer = await getCustomerPrimer(customerId);
            if (customer?.email && !emailFromAPI) {
              emailFromAPI = customer.email;
            }
            if (!countryFromAPI) {
              countryFromAPI = customer?.country || customer?.address?.country || customer?.metadata?.geo_country || customer?.metadata?.country_code;
            }
          } catch (customerError) {
            logger.debug(`Не удалось получить customer через API для ${customerId}: ${customerError.message}`);
          }
        }
        
        // Обновляем email если он найден и отличается
        if (emailFromAPI) {
          const normalizedCurrentEmail = (currentEmail || '').trim();
          const normalizedApiEmail = emailFromAPI.trim();
          if (!normalizedCurrentEmail || normalizedCurrentEmail === 'N/A' || normalizedCurrentEmail !== normalizedApiEmail) {
            updates['Email'] = emailFromAPI;
            needsUpdate = true;
            emailUpdated++;
            logger.info(`📧 Обновляю email для ${customerId}: '${normalizedCurrentEmail || 'N/A'}' → '${normalizedApiEmail}'`);
          } else {
            logger.debug(`✓ Email уже актуален для ${customerId}: ${normalizedApiEmail}`);
          }
        } else {
          logger.warn(`⚠️ Email не найден для ${customerId}`);
        }
        
        // Обновляем GEO (country code) - обновляем если Unknown или пусто
        if (countryFromAPI) {
          const newGeo = countryFromAPI; // Используем только код страны
          const normalizedCurrentGeo = (currentGeo || '').trim();
          if (!normalizedCurrentGeo || normalizedCurrentGeo === 'Unknown' || normalizedCurrentGeo === 'N/A' || normalizedCurrentGeo !== newGeo) {
            updates['GEO'] = newGeo;
            needsUpdate = true;
            geoUpdated++;
            logger.info(`🌍 Обновляю GEO для ${customerId}: '${normalizedCurrentGeo || 'Unknown'}' → '${newGeo}'`);
          } else {
            logger.debug(`✓ GEO уже актуален для ${customerId}: ${newGeo}`);
          }
        } else {
          logger.warn(`⚠️ Country code не найден для ${customerId}`);
        }
        
        // Проверяем нужно ли добавить формулу LA Time
        if (!currentLaTime || !currentLaTime.startsWith('=')) {
          // Формула будет добавлена через Google Sheets API
          needsUpdate = true;
          formulaUpdated++;
        }
        
        // Обновляем строку если нужно
        if (needsUpdate && Object.keys(updates).length > 0) {
          try {
            // Сохраняем каждое поле отдельно для надежности
            logger.info(`💾 Сохраняю обновления для строки ${row.rowNumber}:`, JSON.stringify(updates));
            for (const [key, value] of Object.entries(updates)) {
              row.set(key, value);
              logger.debug(`  Установлено ${key} = ${value}`);
            }
            await row.save();
            logger.info(`✅ Сохранено обновление для строки ${row.rowNumber}:`, updates);
            updated++;
          } catch (saveError) {
            logger.error(`❌ Ошибка сохранения строки ${row.rowNumber}:`, saveError);
            failed++;
            errors.push({ row: row.rowNumber, error: saveError.message });
          }
        } else if (needsUpdate && Object.keys(updates).length === 0) {
          logger.warn(`⚠️ Строка ${row.rowNumber} нуждается в обновлении, но updates пуст`);
        }
        
        // Добавляем формулу LA Time через Google Sheets API
        if (!currentLaTime || !currentLaTime.startsWith('=')) {
          try {
            const formula = laTimeFormula(row.rowNumber);
            await sheets.spreadsheets.values.update({
              spreadsheetId: ENV.GOOGLE_SHEETS_DOC_ID,
              range: `${PRIMER_SHEET_NAME}!${laTimeColumnLetter}${row.rowNumber}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: {
                values: [[formula]]
              }
            });
            logger.info(`✅ Добавлена формула LA Time для строки ${row.rowNumber}`);
          } catch (formulaError) {
            logger.warn(`⚠️ Не удалось добавить формулу для строки ${row.rowNumber}: ${formulaError.message}`);
            failed++;
            errors.push({ row: row.rowNumber, error: formulaError.message });
          }
        }
        
        // Задержка между обновлениями чтобы не превысить квоту Google Sheets API (300 запросов в минуту)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if ((updated + formulaUpdated) % 10 === 0) {
          logger.info(`📊 Обработано ${updated + formulaUpdated} строк...`);
        }
        
      } catch (error) {
        failed++;
        errors.push({
          row: row.rowNumber,
          error: error.message
        });
        logger.error(`❌ Ошибка при обработке строки ${row.rowNumber}`, error);
      }
    }
    
    const result = {
      success: true,
      totalRows: rows.length,
      emailUpdated,
      geoUpdated,
      formulaUpdated,
      failed,
      errors: errors.slice(0, 10)
    };
    
    logger.info('✅ Обновление завершено!', result);
    
    console.log('\n📊 Результаты обновления:');
    console.log(`   Всего строк: ${result.totalRows}`);
    console.log(`   Email обновлено: ${result.emailUpdated}`);
    console.log(`   GEO обновлено: ${result.geoUpdated}`);
    console.log(`   Формул LA Time добавлено: ${result.formulaUpdated}`);
    console.log(`   Ошибок: ${result.failed}`);
    
    if (result.errors.length > 0) {
      console.log('\n❌ Ошибки:');
      result.errors.forEach(err => {
        console.log(`   - Строка ${err.row}: ${err.error}`);
      });
    }
    
  } catch (error) {
    logger.error('❌ Критическая ошибка при обновлении', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

// Запускаем обновление
updateExistingPrimerRows()
  .then(() => {
    console.log('✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Скрипт завершился с ошибкой', error);
    process.exit(1);
  });

