// Скрипт для массовой выгрузки всех платежей из второго Stripe аккаунта
import { config } from 'dotenv';
import fetch from 'node-fetch';

config();

const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.RAILWAY_URL || 'http://localhost:3000';

async function exportAllLowPricePayments() {
  console.log('🚀 Запускаем массовую выгрузку всех платежей из второго Stripe аккаунта...\n');
  console.log(`📍 URL: ${RAILWAY_URL}\n`);

  try {
    const response = await fetch(`${RAILWAY_URL}/api/export-all-lowprice-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.success) {
      console.log('✅ Массовая выгрузка завершена успешно!\n');
      console.log('📊 Результаты:');
      console.log(`   Всего платежей в Stripe: ${result.totalPayments}`);
      console.log(`   Успешных платежей: ${result.successfulPayments}`);
      console.log(`   Новых платежей: ${result.newPayments}`);
      console.log(`   Дубликатов пропущено: ${result.duplicatesAvoided}`);
      console.log(`   Клиентов обработано: ${result.customersProcessed}`);
      console.log(`   Новых покупок добавлено: ${result.newPurchases}`);
      console.log(`   Существующих покупок обновлено: ${result.updatedPurchases}`);
      console.log(`   Ошибок: ${result.failed}`);
      
      if (result.errors && result.errors.length > 0) {
        console.log(`\n⚠️ Ошибки (первые 10):`);
        result.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. Customer ${error.customerId}: ${error.error}`);
        });
      }
      
      console.log('\n✅ Все платежи выгружены в лист "LowPrice"!\n');
    } else {
      console.error('❌ Ошибка при выгрузке:', result.message || result.error);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error('\n💡 Убедитесь, что:');
    console.error('   1. Приложение запущено на Railway');
    console.error('   2. Установлена переменная RAILWAY_PUBLIC_DOMAIN или RAILWAY_URL');
    console.error('   3. Или запустите локально: node export-all-lowprice.js (приложение должно быть на localhost:3000)');
    process.exit(1);
  }
}

exportAllLowPricePayments();

