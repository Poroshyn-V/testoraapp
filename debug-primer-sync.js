#!/usr/bin/env node
/**
 * Скрипт для отладки синхронизации Primer покупок
 * Показывает какие платежи получены из API и почему они не добавляются в таблицу
 */

import dotenv from 'dotenv';
dotenv.config();

if (!process.env.PRIMER_API_KEY) {
  console.error('❌ Ошибка: PRIMER_API_KEY не настроен!');
  process.exit(1);
}

async function debugPrimerSync() {
  const { ENV } = await import('./src/config/env.js');
  const { logger } = await import('./src/utils/logging.js');
  const { getRecentPaymentsPrimer, normalizePrimerPayment } = await import('./src/services/primer.js');
  const googleSheetsModule = await import('./src/services/googleSheets.js');
  const googleSheets = googleSheetsModule.default;
  
  try {
    console.log('🔍 Отладка синхронизации Primer...\n');
    
    // 1. Получаем платежи из API
    console.log('1️⃣ Получаем платежи из Primer API (последние 30 дней)...');
    const primerPayments = await getRecentPaymentsPrimer(100, 30);
    console.log(`   ✅ Получено ${primerPayments.length} платежей из API\n`);
    
    if (primerPayments.length === 0) {
      console.log('⚠️ Нет платежей в API за последние 30 дней');
      return;
    }
    
    // Показываем примеры платежей
    console.log('📋 Примеры платежей из API:');
    primerPayments.slice(0, 3).forEach((p, i) => {
      console.log(`\n   Платеж ${i + 1}:`);
      console.log(`   - ID: ${p.id}`);
      console.log(`   - Status: ${p.status}`);
      console.log(`   - Amount: ${p.amount} ${p.currencyCode || p.currency || 'USD'}`);
      console.log(`   - Date: ${p.date || p.createdAt || 'N/A'}`);
      console.log(`   - Customer ID: ${p.customerId || p.customer?.id || p.metadata?.customer_id || 'N/A'}`);
      console.log(`   - Application: ${p.metadata?.application || 'N/A'}`);
      console.log(`   - Metadata keys: ${Object.keys(p.metadata || {}).join(', ')}`);
    });
    
    // 2. Нормализуем платежи
    console.log('\n2️⃣ Нормализуем платежи...');
    const normalizedPayments = primerPayments.map(normalizePrimerPayment);
    console.log(`   ✅ Нормализовано ${normalizedPayments.length} платежей\n`);
    
    // Показываем примеры нормализованных платежей
    console.log('📋 Примеры нормализованных платежей:');
    normalizedPayments.slice(0, 3).forEach((p, i) => {
      console.log(`\n   Платеж ${i + 1}:`);
      console.log(`   - ID: ${p.id}`);
      console.log(`   - Status: ${p.status} (из ${primerPayments[i].status})`);
      console.log(`   - Amount: ${p.amount} cents (${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()})`);
      console.log(`   - Customer: ${p.customer || 'N/A'}`);
      console.log(`   - Created: ${new Date(p.created * 1000).toISOString()}`);
    });
    
    // 3. Фильтруем успешные платежи
    console.log('\n3️⃣ Фильтруем успешные платежи...');
    const successfulPayments = normalizedPayments.filter(p => {
      if (p.status !== 'succeeded') {
        console.log(`   ⏭️ Пропущен ${p.id}: status=${p.status} (не succeeded)`);
        return false;
      }
      if (!p.customer) {
        console.log(`   ⏭️ Пропущен ${p.id}: нет customer ID`);
        return false;
      }
      if (p.status === 'reversed' || p.status === 'refunded' || p.status === 'canceled') {
        console.log(`   ⏭️ Пропущен ${p.id}: status=${p.status} (reversed/refunded/canceled)`);
        return false;
      }
      return true;
    });
    console.log(`   ✅ Найдено ${successfulPayments.length} успешных платежей из ${normalizedPayments.length} нормализованных\n`);
    
    // 4. Проверяем существующие платежи в таблице
    console.log('4️⃣ Проверяем существующие платежи в таблице Primer...');
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    const existingRows = await primerSheet.getRows();
    
    const existingPaymentIds = new Set();
    for (const row of existingRows) {
      const paymentIdsField = row.get('Payment Intent IDs') || row.get('Payment ID') || '';
      if (paymentIdsField) {
        const ids = paymentIdsField.split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => existingPaymentIds.add(id));
      }
    }
    
    console.log(`   ✅ Найдено ${existingPaymentIds.size} существующих платежей в таблице\n`);
    
    // 5. Фильтруем новые платежи
    console.log('5️⃣ Фильтруем новые платежи (которых нет в таблице)...');
    const newPayments = successfulPayments.filter(p => {
      if (existingPaymentIds.has(p.id)) {
        console.log(`   ⏭️ Пропущен ${p.id}: уже есть в таблице`);
        return false;
      }
      return true;
    });
    console.log(`   ✅ Найдено ${newPayments.length} новых платежей из ${successfulPayments.length} успешных\n`);
    
    // 6. Группируем по клиентам
    console.log('6️⃣ Группируем по клиентам...');
    const customerGroups = new Map();
    for (const payment of newPayments) {
      const customerId = payment.customer;
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(payment);
    }
    console.log(`   ✅ Сгруппировано в ${customerGroups.size} групп клиентов\n`);
    
    // Итоговая статистика
    console.log('\n📊 ИТОГОВАЯ СТАТИСТИКА:');
    console.log(`   - Платежей из API: ${primerPayments.length}`);
    console.log(`   - Нормализовано: ${normalizedPayments.length}`);
    console.log(`   - Успешных: ${successfulPayments.length}`);
    console.log(`   - Уже в таблице: ${successfulPayments.length - newPayments.length}`);
    console.log(`   - Новых для добавления: ${newPayments.length}`);
    console.log(`   - Групп клиентов: ${customerGroups.size}`);
    
    if (newPayments.length > 0) {
      console.log('\n✅ Есть новые платежи для добавления!');
      console.log('\n📋 Примеры новых платежей:');
      newPayments.slice(0, 5).forEach((p, i) => {
        console.log(`\n   ${i + 1}. Payment ID: ${p.id}`);
        console.log(`      Customer: ${p.customer}`);
        console.log(`      Amount: $${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`);
        console.log(`      Date: ${new Date(p.created * 1000).toISOString()}`);
      });
    } else {
      console.log('\n⚠️ Нет новых платежей для добавления');
      if (successfulPayments.length > 0) {
        console.log('\n💡 Возможные причины:');
        console.log('   - Все платежи уже есть в таблице');
        console.log('   - Проверьте что Payment Intent IDs правильно сохраняются');
      }
    }
    
  } catch (error) {
    logger.error('❌ Ошибка при отладке', error);
    console.error('❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

debugPrimerSync()
  .then(() => {
    console.log('\n✅ Отладка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  });

