// Тестовый скрипт для проверки второго Stripe аккаунта
import { config } from 'dotenv';
import Stripe from 'stripe';

config();

const SECOND_STRIPE_KEY = process.env.STRIPE_SECRET_KEY_LOW_PRICE;
const LOW_PRICE_SHEET_NAME = process.env.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';

console.log('🧪 Тестирование подключения ко второму Stripe аккаунту...\n');

if (!SECOND_STRIPE_KEY) {
  console.error('❌ ОШИБКА: STRIPE_SECRET_KEY_LOW_PRICE не найден в .env');
  process.exit(1);
}

// Маскируем ключ для безопасности
const maskedKey = SECOND_STRIPE_KEY.substring(0, 20) + '...' + SECOND_STRIPE_KEY.substring(SECOND_STRIPE_KEY.length - 10);
console.log(`✅ Ключ найден: ${maskedKey}`);
console.log(`✅ Название листа: ${LOW_PRICE_SHEET_NAME}\n`);

async function testConnection() {
  try {
    console.log('📡 Подключаемся к Stripe...');
    const stripe = new Stripe(SECOND_STRIPE_KEY);
    
    // Тест 1: Проверка подключения
    console.log('  🔍 Проверка подключения...');
    const customers = await stripe.customers.list({ limit: 1 });
    console.log('  ✅ Подключение успешно!\n');
    
    // Тест 2: Получение последних платежей
    console.log('  💳 Получение последних платежей...');
    const payments = await stripe.paymentIntents.list({ 
      limit: 5,
      created: {
        gte: Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000) // Последние 7 дней
      }
    });
    
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded');
    console.log(`  ✅ Найдено ${payments.data.length} платежей за последние 7 дней`);
    console.log(`  ✅ Успешных платежей: ${successfulPayments.length}\n`);
    
    if (successfulPayments.length > 0) {
      console.log('📊 Пример последнего успешного платежа:');
      const lastPayment = successfulPayments[0];
      console.log(`  - ID: ${lastPayment.id}`);
      console.log(`  - Amount: $${(lastPayment.amount / 100).toFixed(2)}`);
      console.log(`  - Currency: ${lastPayment.currency?.toUpperCase()}`);
      console.log(`  - Status: ${lastPayment.status}`);
      console.log(`  - Created: ${new Date(lastPayment.created * 1000).toLocaleString()}\n`);
    }
    
    // Тест 3: Проверка Google Sheets настроек
    console.log('📊 Проверка настроек Google Sheets...');
    const GOOGLE_SHEETS_DOC_ID = process.env.GOOGLE_SHEETS_DOC_ID;
    const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
    
    if (GOOGLE_SHEETS_DOC_ID && GOOGLE_SERVICE_EMAIL) {
      console.log(`  ✅ Google Sheets настроены`);
      console.log(`  ✅ Sheet ID: ${GOOGLE_SHEETS_DOC_ID.substring(0, 20)}...`);
      console.log(`  ✅ Service Email: ${GOOGLE_SERVICE_EMAIL}\n`);
    } else {
      console.log('  ⚠️ Google Sheets не настроены полностью\n');
    }
    
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');
    console.log('\n📝 Готово к выгрузке данных!');
    console.log('   Запустите: node export-second-stripe.js\n');
    
  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    
    if (error.type === 'StripeAuthenticationError') {
      console.error('   Проблема с ключом Stripe. Проверьте:');
      console.error('   - Правильность ключа');
      console.error('   - Что ключ активен в Stripe Dashboard');
    }
    
    process.exit(1);
  }
}

testConnection();
