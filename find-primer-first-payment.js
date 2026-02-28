#!/usr/bin/env node
/**
 * Скрипт для поиска первого платежа клиента в Primer API
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');

async function findFirstPayment(customerId) {
  console.log(`🔍 Ищу все платежи для Customer ID: ${customerId}\n`);

  try {
    const PRIMER_API_URL = ENV.PRIMER_API_URL || 'https://api.primer.io';
    const PRIMER_API_KEY = ENV.PRIMER_API_KEY;
    const PRIMER_API_VERSION = ENV.PRIMER_API_VERSION || '2.4';

    if (!PRIMER_API_KEY) {
      console.error('❌ Primer API key не настроен');
      return;
    }

    // Получаем все платежи за последние 30 дней
    const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toDate = new Date().toISOString();
    
    const url = `${PRIMER_API_URL}/payments?limit=100&from_date=${fromDate}&to_date=${toDate}&status=SETTLED,AUTHORIZED`;
    console.log(`📡 Запрос к Primer API...\n`);

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': PRIMER_API_KEY,
        'X-API-VERSION': PRIMER_API_VERSION,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Ошибка API: ${response.status} ${response.statusText}`);
      console.error(`   Ответ: ${errorText}`);
      return;
    }

    const data = await response.json();
    const allPayments = data.data || [];
    
    // Фильтруем только для testora
    const testoraPayments = allPayments.filter(p => {
      const app = p.metadata?.application || '';
      return app.toLowerCase() === 'testora';
    });

    // Фильтруем по customer_id
    const customerPayments = testoraPayments.filter(p => {
      const pCustomerId = p.customerId || p.metadata?.customer_id;
      return pCustomerId === customerId;
    });

    if (customerPayments.length === 0) {
      console.log(`❌ Платежи для Customer ID ${customerId} не найдены в последних 30 днях`);
      return;
    }

    console.log(`✅ Найдено ${customerPayments.length} платежей для этого клиента:\n`);

    // Сортируем по дате
    customerPayments.sort((a, b) => new Date(a.date) - new Date(b.date));

    for (let i = 0; i < customerPayments.length; i++) {
      const payment = customerPayments[i];
      const paymentDate = new Date(payment.date);
      const daysDiff = i > 0 ? Math.floor((paymentDate - new Date(customerPayments[0].date)) / (24 * 60 * 60 * 1000)) : 0;
      
      const description = payment.metadata?.description || '';
      const isUpdate = description.toLowerCase().includes('subscription update');
      const isCreation = description.toLowerCase().includes('subscription creation') || description.toLowerCase().includes('subscription');
      
      console.log(`   ${i === 0 ? '✅ ПЕРВЫЙ' : isUpdate ? '⏭️ РЕКУРЕНТ' : '📋'} Платеж ${i + 1}: ${payment.id}`);
      console.log(`      Дата: ${paymentDate.toISOString()}${daysDiff > 0 ? ` (через ${daysDiff} дней после первого)` : ''}`);
      console.log(`      Сумма: $${(payment.amount / 100).toFixed(2)} ${payment.currencyCode || 'USD'}`);
      console.log(`      Статус: ${payment.status}`);
      console.log(`      Description: ${description || 'N/A'}`);
      console.log(`      Email: ${payment.customer?.emailAddress || payment.metadata?.email || 'N/A'}`);
      console.log('');
    }

    const firstPayment = customerPayments[0];
    const recurringPayments = customerPayments.slice(1);
    
    console.log(`\n📊 Итоги:`);
    console.log(`   Первый платеж: ${firstPayment.id} - $${(firstPayment.amount / 100).toFixed(2)} (${new Date(firstPayment.date).toISOString()})`);
    console.log(`   Рекурентных платежей: ${recurringPayments.length}`);
    
    if (recurringPayments.length > 0) {
      const recurringTotal = recurringPayments.reduce((sum, p) => sum + p.amount, 0) / 100;
      console.log(`   Сумма рекурентных: $${recurringTotal.toFixed(2)}`);
      console.log(`\n   ⚠️ В таблице должны быть только первый платеж!`);
      console.log(`   Рекурентные платежи нужно удалить из таблицы.`);
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error.stack);
  }
}

// Получаем Customer ID из аргументов командной строки
const customerId = process.argv[2] || '54b2630c-e5a3-4844-9964-4d610d43a3bb';

findFirstPayment(customerId)
  .then(() => {
    console.log('\n✅ Проверка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
