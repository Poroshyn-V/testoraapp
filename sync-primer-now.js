#!/usr/bin/env node
/**
 * Скрипт для немедленной синхронизации Primer покупок
 */

import dotenv from 'dotenv';
dotenv.config();

// Импортируем все необходимые модули
const { ENV } = await import('./src/config/env.js');
const { logger } = await import('./src/utils/logging.js');
const googleSheetsModule = await import('./src/services/googleSheets.js');
const googleSheets = googleSheetsModule.default;
const { getRecentPaymentsPrimer, getAllPaymentsPrimer, normalizePrimerPayment, getCustomerPaymentsPrimer, getCustomerPrimer, isPrimerConfigured } = await import('./src/services/primer.js');
const { formatPaymentForSheetsPrimer } = await import('./src/utils/formatting.js');
const { sendPurchaseNotification } = await import('./src/services/notifications.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

const { distributedLock } = await import('./src/services/distributedLock.js');

// Импортируем функцию addLaTimeFormulaToPrimerSheet из app.js
const appModule = await import('./app.js');

async function syncPrimerNow() {
  try {
    console.log('🔄 Запускаю синхронизацию Primer...\n');
    
    if (!isPrimerConfigured()) {
      console.log('❌ Primer API не настроен');
      return;
    }
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    const existingRows = await primerSheet.getRows();
    const existingPaymentIds = new Set();
    
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || '';
      if (paymentIdsField) {
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    console.log(`📋 Найдено ${existingPaymentIds.size} существующих платежей в таблице`);
    
    const primerPayments = await getRecentPaymentsPrimer(100, 30);
    console.log(`📥 Получено ${primerPayments.length} платежей из API\n`);
    
    const normalizedPayments = primerPayments.map(normalizePrimerPayment);
    const successfulPayments = normalizedPayments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
      return true;
    });
    
    const newPayments = successfulPayments.filter(p => !existingPaymentIds.has(p.id));
    console.log(`🆕 Найдено ${newPayments.length} новых платежей для добавления\n`);
    
    if (newPayments.length === 0) {
      console.log('✅ Нет новых платежей для добавления');
      return;
    }
    
    // Группируем по клиентам
    const customerGroups = new Map();
    for (const payment of newPayments) {
      const customerId = payment.customer;
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    
    console.log(`📦 Сгруппировано в ${customerGroups.size} групп клиентов\n`);
    
    let added = 0;
    let updated = 0;
    
    for (const [customerId, payments] of customerGroups.entries()) {
      try {
        const customerLockKey = `customer_primer_${customerId}`;
        const customerLockId = await distributedLock.acquire(customerLockKey, 5, 100);
        
        try {
          const allPrimerRows = await primerSheet.getRows();
          const existingCustomers = allPrimerRows.filter(row => row.get('Customer ID') === customerId);
          
          if (existingCustomers.length > 0) {
            // Обновляем существующего клиента
            console.log(`🔄 Обновляю существующего клиента ${customerId}...`);
            
            const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
            const normalizedAllPayments = allPayments.map(normalizePrimerPayment);
            const allSuccessfulPayments = normalizedAllPayments.filter(p => {
              if (p.status !== 'succeeded' || !p.customer) return false;
              if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
              return true;
            });
            
            if (allSuccessfulPayments.length === 0) {
              console.log(`⚠️ Нет успешных платежей для клиента ${customerId}`);
              continue;
            }
            
            allSuccessfulPayments.sort((a, b) => a.created - b.created);
            const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];
            const customer = await fetchWithRetry(() => getCustomerPrimer(customerId));
            
            const updatedRowData = formatPaymentForSheetsPrimer(latestPayment, customer, { accountSource: 'primer' });
            
            let totalAmountAll = 0;
            const paymentIdsAll = [];
            for (const p of allSuccessfulPayments) {
              totalAmountAll += p.amount;
              paymentIdsAll.push(p.id);
            }
            
            const existingRow = existingCustomers[0];
            const correctTotalAmount = (totalAmountAll / 100).toFixed(2);
            
            existingRow.set('Purchase ID', `purchase_${customerId}`);
            existingRow.set('Total Amount', correctTotalAmount);
            existingRow.set('Payment Count', allSuccessfulPayments.length.toString());
            existingRow.set('Payment Intent IDs', paymentIdsAll.join(', '));
            existingRow.set('Created UTC', updatedRowData['Created UTC']);
            existingRow.set('Created Local (UTC-8)', updatedRowData['Created Local (UTC-8)']);
            existingRow.set('Email', updatedRowData['Email']);
            existingRow.set('GEO', updatedRowData['GEO']);
            existingRow.set('Customer ID', customerId);
            
            await fetchWithRetry(() => existingRow.save());
            
            console.log(`✅ Обновлен клиент ${customerId}: $${correctTotalAmount}, ${allSuccessfulPayments.length} платежей`);
            updated++;
            
          } else {
            // Добавляем нового клиента
            console.log(`➕ Добавляю нового клиента ${customerId}...`);
            
            const allPayments = await fetchWithRetry(() => getCustomerPaymentsPrimer(customerId));
            const normalizedAllPayments = allPayments.map(normalizePrimerPayment);
            const allSuccessfulPayments = normalizedAllPayments.filter(p => {
              if (p.status !== 'succeeded' || !p.customer) return false;
              if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') return false;
              return true;
            });
            
            if (allSuccessfulPayments.length === 0) {
              console.log(`⚠️ Нет успешных платежей для клиента ${customerId}`);
              continue;
            }
            
            allSuccessfulPayments.sort((a, b) => a.created - b.created);
            const firstPayment = allSuccessfulPayments[0];
            const customer = await fetchWithRetry(() => getCustomerPrimer(customerId));
            
            const rowData = formatPaymentForSheetsPrimer(firstPayment, customer, { accountSource: 'primer' });
            
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
            
            if (!rowData['Email'] || rowData['Email'] === 'N/A') {
              rowData['Email'] = customer?.email || firstPayment.email || 'N/A';
            }
            if (!rowData['GEO'] || rowData['GEO'] === 'Unknown') {
              rowData['GEO'] = customer?.country || customer?.address?.country || firstPayment.country || 'Unknown';
            }
            
            const addResult = await primerSheet.addRow(rowData);
            
            // Добавляем формулу LA Time
            if (appModule.addLaTimeFormulaToPrimerSheet) {
              await appModule.addLaTimeFormulaToPrimerSheet(addResult.row.rowNumber);
            }
            
            console.log(`✅ Добавлен клиент ${customerId}: $${rowData['Total Amount']} USD, ${allSuccessfulPayments.length} платежей`);
            added++;
            
            // Отправляем уведомление
            try {
              const notificationCustomer = {
                id: customer?.id || customerId,
                email: customer?.email || firstPayment.email || rowData['Email'] || 'N/A',
                address: customer?.address || (customer?.country ? { country: customer.country } : null),
                country: customer?.country || firstPayment.country || null,
                metadata: { ...(customer?.metadata || {}), ...firstPayment.metadata }
              };
              
              const notificationPayment = {
                ...firstPayment,
                _primer: true,
                _source: 'primer'
              };
              
              await sendPurchaseNotification(notificationPayment, notificationCustomer, {
                ...rowData,
                accountSource: 'primer',
                'Total Amount': rowData['Total Amount'],
                'Payment Count': rowData['Payment Count']
              });
              
              console.log(`📱 Уведомление отправлено для ${customerId}`);
            } catch (notifError) {
              console.log(`⚠️ Не удалось отправить уведомление: ${notifError.message}`);
            }
          }
          
        } finally {
          await distributedLock.release(customerLockKey, customerLockId);
        }
        
      } catch (error) {
        console.error(`❌ Ошибка при обработке клиента ${customerId}:`, error.message);
      }
    }
    
    console.log(`\n✅ Синхронизация завершена:`);
    console.log(`   - Добавлено новых клиентов: ${added}`);
    console.log(`   - Обновлено существующих: ${updated}`);
    
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

syncPrimerNow()
  .then(() => {
    console.log('\n✅ Готово!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  });

