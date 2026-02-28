// Скрипт для переноса всех покупок из "LowPrice Upsells" в "LowPrice"
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

async function transferUpsellsToLowPrice() {
  console.log('🚀 Начинаем перенос покупок из "LowPrice Upsells" в "LowPrice"...\n');

  try {
    await googleSheets.initialize();
    
    const UPSELLS_SHEET_NAME = 'LowPrice Upsells';
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    
    // Получаем лист с апселлами
    let upsellsSheet;
    try {
      upsellsSheet = await googleSheets.getSheetByName(UPSELLS_SHEET_NAME);
      await upsellsSheet.loadHeaderRow();
    } catch (error) {
      console.log(`❌ Лист "${UPSELLS_SHEET_NAME}" не найден или пуст`);
      return;
    }
    
    // Получаем основной лист LowPrice
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();
    
    // Читаем все строки из Upsells
    const upsellsRows = await upsellsSheet.getRows();
    console.log(`📋 Найдено ${upsellsRows.length} записей в листе "${UPSELLS_SHEET_NAME}"\n`);
    
    if (upsellsRows.length === 0) {
      console.log('✅ Нет данных для переноса');
      return;
    }
    
    // Читаем существующие данные из LowPrice
    const lowPriceRows = await lowPriceSheet.getRows();
    const existingCustomers = new Map();
    for (const row of lowPriceRows) {
      const customerId = row.get('Customer ID');
      if (customerId && customerId !== 'N/A') {
        existingCustomers.set(customerId, row);
      }
    }
    
    console.log(`📊 Найдено ${existingCustomers.size} существующих клиентов в "${LOW_PRICE_SHEET_NAME}"\n`);
    
    let transferred = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];
    
    for (const upsellRow of upsellsRows) {
      const customerId = upsellRow.get('Customer ID');
      if (!customerId || customerId === 'N/A') {
        skipped++;
        continue;
      }
      
      try {
        console.log(`\n🔄 Обрабатываем клиента ${customerId}...`);
        
        // Получаем данные клиента из Stripe
        const customer = await fetchWithRetry(() => getCustomerLowPrice(customerId));
        if (!customer) {
          console.log(`   ⚠️ Клиент не найден в Stripe, пропускаем`);
          skipped++;
          continue;
        }
        
        // Получаем все платежи клиента из Stripe
        const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
        
        // Фильтруем успешные платежи (включая апселлы)
        const allSuccessfulPayments = allPayments.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.amount === 60) return false; // Исключаем тестовые платежи $0.60
          
          // Проверяем subscription update - включаем только если это апселл (есть creation в тот же день)
          const isSubscriptionUpdate = p.description && p.description.toLowerCase().includes('subscription update');
          if (isSubscriptionUpdate) {
            const paymentDate = new Date(p.created * 1000);
            const dateKey = paymentDate.toISOString().split('T')[0];
            
            const hasCreationSameDay = allPayments.some(otherPayment => {
              if (otherPayment.id === p.id) return false;
              const otherDate = new Date(otherPayment.created * 1000);
              const otherDateKey = otherDate.toISOString().split('T')[0];
              
              if (otherDateKey !== dateKey) return false;
              
              const isCreation = otherPayment.description && (
                otherPayment.description.toLowerCase().includes('subscription creation') ||
                otherPayment.description.toLowerCase().includes('w2w:stripe: subscription creation')
              );
              
              return isCreation && otherPayment.status === 'succeeded';
            });
            
            return hasCreationSameDay;
          }
          
          return true;
        });
        
        if (allSuccessfulPayments.length === 0) {
          console.log(`   ⚠️ Нет успешных платежей, пропускаем`);
          skipped++;
          continue;
        }
        
        // Сортируем по дате
        allSuccessfulPayments.sort((a, b) => a.created - b.created);
        const firstPayment = allSuccessfulPayments[0];
        const latestPayment = allSuccessfulPayments[allSuccessfulPayments.length - 1];
        
        // Суммируем все платежи
        let totalAmount = 0;
        const paymentIds = [];
        for (const p of allSuccessfulPayments) {
          totalAmount += p.amount;
          paymentIds.push(p.id);
        }
        
        const newTotalAmount = (totalAmount / 100).toFixed(2);
        const newPaymentIds = paymentIds.sort().join(', ');
        
        // Форматируем данные для листа
        const rowData = formatPaymentForSheetsLowPrice(firstPayment, customer);
        rowData['Purchase ID'] = `purchase_${customerId}_${firstPayment.created}`;
        rowData['Total Amount'] = newTotalAmount;
        rowData['Payment Count'] = allSuccessfulPayments.length.toString();
        rowData['Payment Intent IDs'] = newPaymentIds;
        
        // Проверяем, есть ли клиент уже в LowPrice
        const existingRow = existingCustomers.get(customerId);
        
        if (existingRow) {
          // Обновляем существующую запись
          const currentPaymentIds = (existingRow.get('Payment Intent IDs') || '').split(',').map(id => id.trim()).filter(Boolean);
          const currentPaymentIdsSorted = currentPaymentIds.sort().join(', ');
          const currentTotalAmount = parseFloat(existingRow.get('Total Amount') || 0);
          
          // Обновляем только если есть изменения
          if (currentPaymentIdsSorted !== newPaymentIds || Math.abs(currentTotalAmount - parseFloat(newTotalAmount)) >= 0.01) {
            await existingRow.save({
              'Total Amount': newTotalAmount,
              'Payment Count': allSuccessfulPayments.length.toString(),
              'Payment Intent IDs': newPaymentIds,
              'Created UTC': rowData['Created UTC'],
              'Created Local (LA Time)': rowData['Created Local (LA Time)']
            });
            
            console.log(`   ✅ Обновлен: ${currentPaymentIds.length} → ${paymentIds.length} платежей, $${currentTotalAmount.toFixed(2)} → $${newTotalAmount}`);
            updated++;
          } else {
            console.log(`   ⏭️ Уже актуально, пропускаем`);
            skipped++;
          }
        } else {
          // Добавляем новую запись
          const newRow = await lowPriceSheet.addRow(rowData);
          console.log(`   ✅ Добавлен: ${paymentIds.length} платежей, $${newTotalAmount}`);
          transferred++;
          existingCustomers.set(customerId, newRow); // Добавляем в кэш
        }
        
      } catch (error) {
        errors.push({ customerId, error: error.message });
        console.error(`   ❌ Ошибка: ${error.message}`);
      }
    }
    
    console.log('\n✅ Перенос завершен!\n');
    console.log('📊 Итоговые результаты:');
    console.log(`   Перенесено новых: ${transferred}`);
    console.log(`   Обновлено существующих: ${updated}`);
    console.log(`   Пропущено: ${skipped}`);
    console.log(`   Ошибок: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Ошибки:');
      errors.forEach(({ customerId, error }) => {
        console.log(`   ${customerId}: ${error}`);
      });
    }
    
  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

transferUpsellsToLowPrice();



