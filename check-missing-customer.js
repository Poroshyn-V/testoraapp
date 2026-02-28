// Скрипт для проверки отсутствующего клиента в таблице
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');
const { getCustomerPaymentsLowPrice, getCustomerLowPrice } = await import('./src/services/stripe.js');

const customerId = 'cus_TPtN00OjbIDTfT';

async function checkCustomer() {
  console.log(`🔍 Проверяем клиента ${customerId}...\n`);

  try {
    await googleSheets.initialize();
    
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();
    
    // Проверяем в таблице
    const rows = await lowPriceSheet.getRows();
    const foundRow = rows.find(row => row.get('Customer ID') === customerId);
    
    if (foundRow) {
      console.log('✅ Клиент найден в таблице:');
      console.log(`   Email: ${foundRow.get('Email')}`);
      console.log(`   Total Amount: ${foundRow.get('Total Amount')}`);
      console.log(`   Payment Count: ${foundRow.get('Payment Count')}`);
      console.log(`   Payment IDs: ${foundRow.get('Payment Intent IDs')}`);
    } else {
      console.log('❌ Клиент НЕ найден в таблице!');
    }
    
    // Проверяем в Stripe
    console.log('\n📊 Проверяем данные в Stripe...');
    const customer = await getCustomerLowPrice(customerId);
    if (customer) {
      console.log(`✅ Клиент найден в Stripe:`);
      console.log(`   Email: ${customer.email}`);
      console.log(`   Created: ${new Date(customer.created * 1000).toISOString()}`);
    } else {
      console.log('❌ Клиент не найден в Stripe');
      return;
    }
    
    // Проверяем платежи
    const payments = await getCustomerPaymentsLowPrice(customerId);
    const successfulPayments = payments.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      if (p.amount === 60) return false;
      
      const isSubscriptionUpdate = p.description && p.description.toLowerCase().includes('subscription update');
      if (isSubscriptionUpdate) {
        const paymentDate = new Date(p.created * 1000);
        const dateKey = paymentDate.toISOString().split('T')[0];
        
        const hasCreationSameDay = payments.some(otherPayment => {
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
    
    console.log(`\n💰 Найдено ${successfulPayments.length} успешных платежей:`);
    successfulPayments.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.id} - $${(p.amount / 100).toFixed(2)} - ${new Date(p.created * 1000).toISOString()}`);
      console.log(`      Description: ${p.description || 'N/A'}`);
    });
    
    if (!foundRow && successfulPayments.length > 0) {
      console.log('\n⚠️ ПРОБЛЕМА: Клиент есть в Stripe с платежами, но отсутствует в таблице!');
      console.log('   Нужно добавить его вручную или запустить синхронизацию.');
    }
    
  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkCustomer();



