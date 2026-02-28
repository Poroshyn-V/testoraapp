// Скрипт для проверки и добавления отсутствующего клиента
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

const customerId = 'cus_TPtN00OjbIDTfT';

async function checkAndAddCustomer() {
  console.log(`🔍 Проверяем и добавляем клиента ${customerId}...\n`);

  try {
    await googleSheets.initialize();
    
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();
    
    // Проверяем в таблице
    const rows = await lowPriceSheet.getRows();
    const foundRow = rows.find(row => row.get('Customer ID') === customerId);
    
    if (foundRow) {
      console.log('✅ Клиент УЖЕ есть в таблице:');
      console.log(`   Email: ${foundRow.get('Email')}`);
      console.log(`   Total Amount: ${foundRow.get('Total Amount')}`);
      console.log(`   Payment Count: ${foundRow.get('Payment Count')}`);
      console.log(`   Payment IDs: ${foundRow.get('Payment Intent IDs')}`);
      return;
    }
    
    console.log('❌ Клиент НЕ найден в таблице, проверяем Stripe...\n');
    
    // Проверяем в Stripe
    const customer = await fetchWithRetry(() => getCustomerLowPrice(customerId));
    if (!customer) {
      console.log('❌ Клиент не найден в Stripe');
      return;
    }
    
    console.log(`✅ Клиент найден в Stripe:`);
    console.log(`   Email: ${customer.email}`);
    console.log(`   Created: ${new Date(customer.created * 1000).toISOString()}\n`);
    
    // Получаем все платежи
    const allPayments = await fetchWithRetry(() => getCustomerPaymentsLowPrice(customerId));
    console.log(`📊 Найдено ${allPayments.length} платежей в Stripe\n`);
    
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
      console.log('❌ Нет успешных платежей для добавления');
      return;
    }
    
    console.log(`💰 Найдено ${allSuccessfulPayments.length} успешных платежей:`);
    allSuccessfulPayments.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.id} - $${(p.amount / 100).toFixed(2)} - ${new Date(p.created * 1000).toISOString()}`);
      console.log(`      Description: ${p.description || 'N/A'}`);
    });
    
    // Сортируем по дате
    allSuccessfulPayments.sort((a, b) => a.created - b.created);
    const firstPayment = allSuccessfulPayments[0];
    
    // Форматируем данные
    const rowData = formatPaymentForSheetsLowPrice(firstPayment, customer);
    
    // Суммируем все платежи
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
    
    console.log(`\n📝 Добавляем клиента в таблицу...`);
    console.log(`   Total Amount: $${rowData['Total Amount']}`);
    console.log(`   Payment Count: ${rowData['Payment Count']}`);
    console.log(`   Payment IDs: ${rowData['Payment Intent IDs']}`);
    
    // Добавляем в таблицу
    const addResult = await googleSheets.addRowIfNotExists(rowData, 'Customer ID');
    
    if (addResult.exists) {
      console.log('\n⚠️ Клиент уже существует в таблице (возможно, добавился между проверками)');
      // Обновляем существующую строку
      await googleSheets.updateRow(addResult.row, {
        'Total Amount': rowData['Total Amount'],
        'Payment Count': rowData['Payment Count'],
        'Payment Intent IDs': rowData['Payment Intent IDs'],
        'Created UTC': rowData['Created UTC'],
        'Created Local (LA Time)': rowData['Created Local (LA Time)']
      });
      console.log('✅ Обновлена существующая запись');
    } else if (addResult.success) {
      console.log('\n✅ Клиент успешно добавлен в таблицу!');
    } else {
      console.log('\n❌ Ошибка при добавлении:', addResult);
    }
    
  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkAndAddCustomer();



