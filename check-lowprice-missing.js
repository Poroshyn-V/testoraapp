import dotenv from 'dotenv';
dotenv.config();

// Динамический импорт для ESM
const { default: googleSheets } = await import('./src/services/googleSheets.js');
const { getAllPaymentsLowPrice, getCustomerPaymentsLowPrice, getCustomerLowPrice } = await import('./src/services/stripe.js');
const { fetchWithRetry } = await import('./src/utils/retry.js');

const LOW_PRICE_SHEET_NAME = process.env.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';

async function checkMissingPurchases() {
  console.log('🔍 Проверяем недостающие покупки в листе LowPrice...\n');

  try {
    // Получаем лист LowPrice
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    const existingRows = await lowPriceSheet.getRows();
    
    console.log(`📋 Найдено ${existingRows.length} записей в листе "${LOW_PRICE_SHEET_NAME}"\n`);

    // Собираем все Payment Intent IDs из листа
    const existingPaymentIds = new Set();
    const customerIdToRow = new Map();
    
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || row.get('Payment Intent ID') || '';
      if (paymentIdsField) {
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
      
      const customerId = row.get('Customer ID');
      if (customerId && customerId !== 'N/A') {
        customerIdToRow.set(customerId, row);
      }
    }
    
    console.log(`📋 Найдено ${existingPaymentIds.size} Payment Intent IDs в листе\n`);

    // Получаем ВСЕ платежи из Stripe
    console.log('📥 Загружаем все платежи из Stripe LowPrice (это может занять время)...');
    const allPayments = await fetchWithRetry(() => getAllPaymentsLowPrice());
    console.log(`✅ Загружено ${allPayments.length} платежей из Stripe\n`);

    // Фильтруем успешные платежи (только покупки и апселлы)
    const successfulPayments = allPayments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (p.amount === 60) return false; // Исключаем тестовые $0.60
      
      // Проверяем subscription update - включаем только если это апселл (есть creation в тот же день)
      const isSubscriptionUpdate = p.description && p.description.toLowerCase().includes('subscription update');
      if (isSubscriptionUpdate) {
        // Проверяем, есть ли subscription creation в тот же день
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
          
          return isCreation && otherPayment.status === 'succeeded' && otherPayment.customer === p.customer;
        });
        
        return hasCreationSameDay;
      }
      
      return true;
    });

    console.log(`✅ Найдено ${successfulPayments.length} успешных платежей (покупки + апселлы)\n`);

    // Группируем платежи по клиентам
    const customerGroups = new Map();
    for (const payment of successfulPayments) {
      const customerId = payment.customer;
      if (!customerId) continue;
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }

    console.log(`👥 Группировка: ${customerGroups.size} уникальных клиентов\n`);

    // Проверяем недостающие покупки
    const missingCustomers = [];
    const missingPayments = [];
    const customersWithMissingPayments = [];

    for (const [customerId, payments] of customerGroups.entries()) {
      const existingRow = customerIdToRow.get(customerId);
      
      if (!existingRow) {
        // Клиент полностью отсутствует
        const paymentIds = payments.map(p => p.id);
        missingCustomers.push({
          customerId,
          paymentCount: payments.length,
          paymentIds,
          payments: payments.map(p => ({
            id: p.id,
            amount: (p.amount / 100).toFixed(2),
            currency: p.currency,
            created: new Date(p.created * 1000).toISOString(),
            description: p.description || 'N/A'
          }))
        });
      } else {
        // Клиент есть, проверяем недостающие платежи
        const existingPaymentIdsStr = existingRow.get('Payment Intent IDs') || '';
        const existingPaymentIdsForCustomer = new Set(
          existingPaymentIdsStr.split(',').map(id => id.trim()).filter(Boolean)
        );
        
        const missingPaymentIds = payments
          .map(p => p.id)
          .filter(id => !existingPaymentIdsForCustomer.has(id));
        
        if (missingPaymentIds.length > 0) {
          const missingPaymentsForCustomer = payments.filter(p => missingPaymentIds.includes(p.id));
          customersWithMissingPayments.push({
            customerId,
            existingPaymentCount: existingPaymentIdsForCustomer.size,
            missingPaymentCount: missingPaymentIds.length,
            missingPaymentIds,
            missingPayments: missingPaymentsForCustomer.map(p => ({
              id: p.id,
              amount: (p.amount / 100).toFixed(2),
              currency: p.currency,
              created: new Date(p.created * 1000).toISOString(),
              description: p.description || 'N/A'
            }))
          });
        }
      }
    }

    // Выводим результаты
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 РЕЗУЛЬТАТЫ ПРОВЕРКИ');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Всего клиентов в Stripe: ${customerGroups.size}`);
    console.log(`✅ Всего клиентов в листе: ${customerIdToRow.size}`);
    console.log(`❌ Полностью отсутствующих клиентов: ${missingCustomers.length}`);
    console.log(`⚠️ Клиентов с недостающими платежами: ${customersWithMissingPayments.length}\n`);

    if (missingCustomers.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ ПОЛНОСТЬЮ ОТСУТСТВУЮЩИЕ КЛИЕНТЫ:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      for (const missing of missingCustomers.slice(0, 20)) {
        console.log(`👤 Customer ID: ${missing.customerId}`);
        console.log(`   Платежей: ${missing.paymentCount}`);
        console.log(`   Payment IDs: ${missing.paymentIds.join(', ')}`);
        console.log(`   Платежи:`);
        missing.payments.forEach(p => {
          console.log(`     - ${p.id}: $${p.amount} ${p.currency.toUpperCase()} (${p.created}) - ${p.description}`);
        });
        console.log('');
      }
      
      if (missingCustomers.length > 20) {
        console.log(`   ... и еще ${missingCustomers.length - 20} клиентов\n`);
      }
    }

    if (customersWithMissingPayments.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('⚠️ КЛИЕНТЫ С НЕДОСТАЮЩИМИ ПЛАТЕЖАМИ:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      for (const customer of customersWithMissingPayments.slice(0, 20)) {
        console.log(`👤 Customer ID: ${customer.customerId}`);
        console.log(`   В листе: ${customer.existingPaymentCount} платежей`);
        console.log(`   Не хватает: ${customer.missingPaymentCount} платежей`);
        console.log(`   Недостающие Payment IDs: ${customer.missingPaymentIds.join(', ')}`);
        console.log(`   Недостающие платежи:`);
        customer.missingPayments.forEach(p => {
          console.log(`     - ${p.id}: $${p.amount} ${p.currency.toUpperCase()} (${p.created}) - ${p.description}`);
        });
        console.log('');
      }
      
      if (customersWithMissingPayments.length > 20) {
        console.log(`   ... и еще ${customersWithMissingPayments.length - 20} клиентов\n`);
      }
    }

    // Итоговая статистика
    const totalMissingPayments = missingCustomers.reduce((sum, c) => sum + c.paymentCount, 0) +
                                  customersWithMissingPayments.reduce((sum, c) => sum + c.missingPaymentCount, 0);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 ИТОГОВАЯ СТАТИСТИКА:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`✅ Всего платежей в Stripe: ${successfulPayments.length}`);
    console.log(`✅ Всего Payment IDs в листе: ${existingPaymentIds.size}`);
    console.log(`❌ Недостающих платежей: ${totalMissingPayments}`);
    console.log(`   - От полностью отсутствующих клиентов: ${missingCustomers.reduce((sum, c) => sum + c.paymentCount, 0)}`);
    console.log(`   - От клиентов с частичными платежами: ${customersWithMissingPayments.reduce((sum, c) => sum + c.missingPaymentCount, 0)}`);

    return {
      totalCustomersInStripe: customerGroups.size,
      totalCustomersInSheet: customerIdToRow.size,
      missingCustomers: missingCustomers.length,
      customersWithMissingPayments: customersWithMissingPayments.length,
      totalMissingPayments,
      missingCustomersList: missingCustomers,
      customersWithMissingPaymentsList: customersWithMissingPayments
    };

  } catch (error) {
    console.error('❌ Ошибка при проверке:', error);
    throw error;
  }
}

// Запускаем проверку
checkMissingPurchases()
  .then(results => {
    console.log('\n✅ Проверка завершена!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });






