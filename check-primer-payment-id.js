#!/usr/bin/env node
/**
 * Скрипт для проверки конкретного платежа Primer по Payment ID
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');

async function checkPrimerPaymentById(paymentId) {
  console.log(`🔍 Проверяю платеж Primer по ID: ${paymentId}\n`);

  try {
    const PRIMER_API_URL = ENV.PRIMER_API_URL || 'https://api.primer.io';
    const PRIMER_API_KEY = ENV.PRIMER_API_KEY;
    const PRIMER_API_VERSION = ENV.PRIMER_API_VERSION || '2.4';

    if (!PRIMER_API_KEY) {
      console.error('❌ Primer API key не настроен');
      return;
    }

    const url = `${PRIMER_API_URL}/payments/${paymentId}`;
    console.log(`📡 Запрос к Primer API: ${url}\n`);

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

    const payment = await response.json();
    
    console.log(`✅ Платеж найден в Primer API:\n`);
    console.log(`   ID: ${payment.id}`);
    console.log(`   Status: ${payment.status}`);
    console.log(`   Amount: ${payment.amount} (${payment.currencyCode || 'USD'})`);
    console.log(`   Date: ${payment.date}`);
    console.log(`   Customer ID: ${payment.customerId || payment.metadata?.customer_id || 'N/A'}`);
    console.log(`   Email: ${payment.customer?.emailAddress || payment.paymentMethod?.paymentMethodData?.externalPayerInfo?.email || payment.metadata?.email || 'N/A'}`);
    console.log(`   Country: ${payment.order?.countryCode || payment.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode || payment.metadata?.geo_country || 'N/A'}`);
    console.log(`   Metadata:`, JSON.stringify(payment.metadata || {}, null, 2));
    
    // Проверяем, есть ли другие платежи для этого customer
    if (payment.customerId || payment.metadata?.customer_id) {
      const customerId = payment.customerId || payment.metadata.customer_id;
      console.log(`\n🔍 Ищу другие платежи для Customer ID: ${customerId}...`);
      
      const listUrl = `${PRIMER_API_URL}/payments?limit=100&status=SETTLED,AUTHORIZED`;
      const listResponse = await fetch(listUrl, {
        headers: {
          'X-API-KEY': PRIMER_API_KEY,
          'X-API-VERSION': PRIMER_API_VERSION,
          'Content-Type': 'application/json'
        }
      });

      if (listResponse.ok) {
        const listData = await listResponse.json();
        const customerPayments = (listData.data || []).filter(p => {
          const pCustomerId = p.customerId || p.metadata?.customer_id;
          return pCustomerId === customerId;
        });

        console.log(`   Найдено ${customerPayments.length} платежей для этого клиента:`);
        customerPayments.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (let i = 0; i < customerPayments.length; i++) {
          const p = customerPayments[i];
          const pDate = new Date(p.date);
          const daysDiff = i > 0 ? Math.floor((pDate - new Date(customerPayments[0].date)) / (24 * 60 * 60 * 1000)) : 0;
          
          console.log(`   ${i === 0 ? '✅' : '⏭️'} Платеж ${i + 1}: ${p.id}`);
          console.log(`      Дата: ${pDate.toISOString()}${daysDiff > 0 ? ` (через ${daysDiff} дней)` : ' (ПЕРВЫЙ)'}`);
          console.log(`      Сумма: $${(p.amount / 100).toFixed(2)} ${p.currencyCode || 'USD'}`);
          console.log(`      Статус: ${p.status}`);
          console.log('');
        }

        if (customerPayments.length > 1) {
          const totalAmount = customerPayments.reduce((sum, p) => sum + p.amount, 0) / 100;
          console.log(`   ⚠️ ВНИМАНИЕ: У клиента ${customerPayments.length} платежей!`);
          console.log(`      Общая сумма: $${totalAmount.toFixed(2)}`);
          console.log(`      В таблице указано: $39.98`);
          console.log(`      Разница: ${Math.abs(39.98 - totalAmount) < 0.01 ? '✅ Совпадает' : '❌ НЕ СОВПАДАЕТ'}`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error.stack);
  }
}

// Получаем Payment ID из аргументов командной строки
const paymentId = process.argv[2] || 'x5SSQ4mT1';

checkPrimerPaymentById(paymentId)
  .then(() => {
    console.log('\n✅ Проверка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
