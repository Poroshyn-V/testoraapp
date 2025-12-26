#!/usr/bin/env node
/**
 * Простой скрипт для выгрузки всех платежей Primer
 * Обрабатывает данные постепенно, не зависает
 */

import dotenv from 'dotenv';
dotenv.config();

if (!process.env.PRIMER_API_KEY) {
  console.error('❌ PRIMER_API_KEY не найден!');
  process.exit(1);
}

async function exportAll() {
  const { ENV } = await import('./src/config/env.js');
  const { logger } = await import('./src/utils/logging.js');
  const googleSheetsModule = await import('./src/services/googleSheets.js');
  const googleSheets = googleSheetsModule.default;
  const { normalizePrimerPayment, getCustomerPrimer, getAllPaymentsPrimer } = await import('./src/services/primer.js');
  const { formatPaymentForSheetsPrimer } = await import('./src/utils/formatting.js');
  const { google } = await import('googleapis');
  const { JWT } = await import('google-auth-library');
  
  try {
    console.log('🚀 Начинаю выгрузку всех платежей Primer...');
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    // Загружаем существующие Payment IDs
    let existingRows = await primerSheet.getRows();
    const existingPaymentIds = new Set();
    const existingCustomerIds = new Set();
    
    for (const row of existingRows) {
      const paymentIds = (row.get('Payment Intent IDs') || '').split(',').map(id => id.trim()).filter(Boolean);
      paymentIds.forEach(id => existingPaymentIds.add(id));
      const customerId = row.get('Customer ID');
      if (customerId && customerId !== 'N/A') {
        existingCustomerIds.add(customerId);
      }
    }
    
    console.log(`📋 Найдено ${existingRows.length} существующих строк, ${existingPaymentIds.size} платежей`);
    
    // Получаем все платежи через getAllPaymentsPrimer (он уже обрабатывает пагинацию и ошибки)
    console.log('📥 Получаю платежи из Primer API...');
    let allPayments = [];
    
    try {
      allPayments = await getAllPaymentsPrimer();
      console.log(`✅ Получено ${allPayments.length} платежей из Primer API`);
    } catch (error) {
      console.error(`❌ Ошибка при получении платежей:`, error.message);
      if (allPayments.length === 0) {
        throw error;
      }
      console.log(`⚠️ Продолжаю с уже полученными ${allPayments.length} платежами`);
    }
    
    if (allPayments.length === 0) {
      console.log('ℹ️ Нет платежей для обработки');
      return;
    }
    
    // Нормализуем и фильтруем
    const normalized = allPayments.map(normalizePrimerPayment);
    const successful = normalized.filter(p => p.status === 'succeeded' && p.customer);
    
    console.log(`✅ Найдено ${successful.length} успешных платежей`);
    
    // Группируем по клиентам и извлекаем email/GEO из оригинальных payment объектов
    const customerGroups = new Map();
    const customerDataCache = new Map(); // Кэш для email и GEO по customerId
    
    for (const payment of successful) {
      const customerId = payment.customer;
      if (!customerId || existingPaymentIds.has(payment.id)) continue;
      
      // Извлекаем email и GEO из оригинального payment объекта
      const originalPayment = payment._original || allPayments.find(p => p.id === payment.id);
      if (originalPayment && !customerDataCache.has(customerId)) {
        const email = originalPayment.customer?.emailAddress 
          || originalPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
          || null;
        
        const countryCode = originalPayment.order?.countryCode 
          || originalPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
          || null;
        
        if (email || countryCode) {
          customerDataCache.set(customerId, { email, countryCode });
          console.log(`📧 Найден email/GEO для ${customerId}: email=${email || 'нет'}, country=${countryCode || 'нет'}`);
        }
      }
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    console.log(`📦 Обрабатываю ${customerGroups.size} клиентов...`);
    
    // Google Sheets API для формул
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
    
    let processed = 0;
    let newPurchases = 0;
    let updatedPurchases = 0;
    
    // Обрабатываем каждого клиента (existingRows уже загружены выше)
    for (const [customerId, payments] of customerGroups.entries()) {
      try {
        // Получаем клиента (может упасть на ошибке пагинации, используем fallback)
        let customer;
        
        // Сортируем платежи
        payments.sort((a, b) => a.created - b.created);
        const firstPayment = payments[0];
        const originalPayment = firstPayment._original || allPayments.find(p => p.id === firstPayment.id);
        
        // Используем кэшированные данные email/GEO если они есть
        if (customerDataCache.has(customerId)) {
          const cached = customerDataCache.get(customerId);
          if (!customer || !customer.email) {
            customer = customer || { id: customerId, metadata: firstPayment.metadata || {} };
            customer.email = cached.email || null;
          }
          if (!customer.country && cached.countryCode) {
            customer.country = cached.countryCode;
            customer.address = cached.countryCode ? { country: cached.countryCode } : null;
          }
        }
        
        // Если нет кэша или данных недостаточно, извлекаем из payment объекта
        if (!customer || (!customer.email || !customer.country)) {
          let emailFromPayment = null;
          let countryFromPayment = null;
          
          if (originalPayment) {
            // Email из разных источников в Primer API
            emailFromPayment = originalPayment.customer?.emailAddress 
              || originalPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
              || firstPayment.email
              || null;
            
            // GEO из order объекта
            countryFromPayment = originalPayment.order?.countryCode 
              || originalPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
              || null;
          }
          
          try {
            // Пробуем получить клиента через API
            if (!customer) {
              customer = await getCustomerPrimer(customerId);
            }
            
            // Если API не вернул email/GEO, используем данные из payment
            if (!customer.email && emailFromPayment) {
              customer.email = emailFromPayment;
            }
            if (!customer.country && countryFromPayment) {
              customer.country = countryFromPayment;
              customer.address = countryFromPayment ? { country: countryFromPayment } : null;
            }
          } catch (customerError) {
            // Если не удалось получить клиента, создаем объект из данных payment
            customer = customer || {
              id: customerId,
              email: emailFromPayment || firstPayment.email || null,
              country: countryFromPayment || null,
              address: countryFromPayment ? { country: countryFromPayment } : null,
              metadata: firstPayment.metadata || {}
            };
          }
          
          // Если все еще нет email/GEO, пробуем получить из детального payment запроса
          if ((!customer.email || !customer.country) && originalPayment?.id) {
            try {
              const { ENV } = await import('./src/config/env.js');
              const { fetchWithRetry } = await import('./src/utils/retry.js');
              
              const paymentDetailResponse = await fetchWithRetry(() => 
                fetch(`https://api.primer.io/payments/${originalPayment.id}`, {
                  headers: {
                    'X-API-KEY': ENV.PRIMER_API_KEY,
                    'X-API-VERSION': ENV.PRIMER_API_VERSION || '2.4',
                    'Content-Type': 'application/json'
                  }
                })
              );
              
              if (paymentDetailResponse.ok) {
                const paymentDetail = await paymentDetailResponse.json();
                
                if (!customer.email) {
                  customer.email = paymentDetail.customer?.emailAddress 
                    || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
                    || customer.email;
                }
                
                if (!customer.country) {
                  customer.country = paymentDetail.order?.countryCode 
                    || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
                    || customer.country;
                  customer.address = customer.country ? { country: customer.country } : null;
                }
                
                if (customer.email || customer.country) {
                  console.log(`✅ Получен детальный payment для ${customerId}: email=${customer.email || 'нет'}, country=${customer.country || 'нет'}`);
                }
              }
            } catch (detailError) {
              // Игнорируем ошибку детального запроса
              console.debug(`Не удалось получить детальный payment для ${customerId}: ${detailError.message}`);
            }
          }
        }
        
        // Проверяем существование (загружаем строки один раз перед циклом)
        const existingRow = existingRows.find(r => r.get('Customer ID') === customerId);
        
        // Считаем сумму и количество
        let totalAmount = 0;
        const paymentIds = [];
        for (const p of payments) {
          totalAmount += p.amount;
          paymentIds.push(p.id);
        }
        
        const rowData = formatPaymentForSheetsPrimer(firstPayment, customer, { accountSource: 'primer' });
        rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
        rowData['Total Amount'] = (totalAmount / 100).toFixed(2);
        rowData['Payment Count'] = payments.length.toString();
        rowData['Payment Intent IDs'] = paymentIds.join(', ');
        
        if (existingRow) {
          // Обновляем
          existingRow.set('Purchase ID', rowData['Purchase ID']);
          existingRow.set('Total Amount', rowData['Total Amount']);
          existingRow.set('Payment Count', rowData['Payment Count']);
          existingRow.set('Payment Intent IDs', rowData['Payment Intent IDs']);
          existingRow.set('Email', rowData['Email']);
          existingRow.set('GEO', rowData['GEO']);
          existingRow.set('Created UTC', rowData['Created UTC']);
          await existingRow.save();
          
          // Добавляем формулу LA Time
          try {
            await primerSheet.loadHeaderRow();
            const utcIndex = primerSheet.headerValues.indexOf('Created UTC');
            const laIndex = primerSheet.headerValues.indexOf('Created Local (UTC-8)');
            if (utcIndex !== -1 && laIndex !== -1 && existingRow && existingRow.rowNumber) {
              const utcLetter = String.fromCharCode(65 + utcIndex);
              const laLetter = String.fromCharCode(65 + laIndex);
              const formula = `=IF(${utcLetter}${existingRow.rowNumber}="","",TEXT(DATEVALUE(LEFT(${utcLetter}${existingRow.rowNumber},10))+TIMEVALUE(MID(${utcLetter}${existingRow.rowNumber},12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" UTC-8")`;
              await sheets.spreadsheets.values.update({
                spreadsheetId: ENV.GOOGLE_SHEETS_DOC_ID,
                range: `${PRIMER_SHEET_NAME}!${laLetter}${existingRow.rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[formula]] }
              });
            }
          } catch (formulaError) {
            console.warn(`⚠️ Не удалось добавить формулу для строки: ${formulaError.message}`);
          }
          
          updatedPurchases++;
        } else {
          // Добавляем новую строку
          const addResult = await primerSheet.addRow(rowData);
          
          // Добавляем формулу LA Time
          try {
            await primerSheet.loadHeaderRow();
            const utcIndex = primerSheet.headerValues.indexOf('Created UTC');
            const laIndex = primerSheet.headerValues.indexOf('Created Local (UTC-8)');
            if (utcIndex !== -1 && laIndex !== -1 && addResult && addResult.row && addResult.row.rowNumber) {
              const utcLetter = String.fromCharCode(65 + utcIndex);
              const laLetter = String.fromCharCode(65 + laIndex);
              const formula = `=IF(${utcLetter}${addResult.row.rowNumber}="","",TEXT(DATEVALUE(LEFT(${utcLetter}${addResult.row.rowNumber},10))+TIMEVALUE(MID(${utcLetter}${addResult.row.rowNumber},12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" UTC-8")`;
              await sheets.spreadsheets.values.update({
                spreadsheetId: ENV.GOOGLE_SHEETS_DOC_ID,
                range: `${PRIMER_SHEET_NAME}!${laLetter}${addResult.row.rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[formula]] }
              });
            }
          } catch (formulaError) {
            console.warn(`⚠️ Не удалось добавить формулу для новой строки: ${formulaError.message}`);
          }
          
          newPurchases++;
        }
        
        processed++;
        
        if (processed % 10 === 0) {
          console.log(`📊 Обработано ${processed}/${customerGroups.size} клиентов...`);
          // Задержка чтобы не превысить квоту
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error(`❌ Ошибка при обработке клиента ${customerId}:`, error.message);
      }
    }
    
    console.log('\n✅ Выгрузка завершена!');
    console.log(`   Всего платежей: ${allPayments.length}`);
    console.log(`   Клиентов обработано: ${processed}`);
    console.log(`   Новых покупок: ${newPurchases}`);
    console.log(`   Обновлено покупок: ${updatedPurchases}`);
    
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

exportAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

