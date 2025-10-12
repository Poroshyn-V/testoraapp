// Скрипт для исправления всех сумм в Google Sheets на основе данных из Stripe
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: process.env.GOOGLE_SERVICE_PRIVATE_KEY,
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY
};

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function fixAllSums() {
  try {
    console.log('🔧 Исправляю ВСЕ суммы в Google Sheets на основе данных из Stripe...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Отсутствуют переменные окружения');
      return;
    }
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📊 Найдено ${rows.length} строк для проверки`);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    // Обрабатываем каждую строку
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      const currentAmount = row.get('Total Amount');
      const currentPaymentCount = row.get('Payment Count');
      
      if (!customerId || customerId === 'N/A' || !email || email === 'N/A') {
        console.log(`⏭️ Строка ${i + 1}: пропускаю - нет Customer ID или Email`);
        continue;
      }
      
      console.log(`\n🔍 Строка ${i + 1}: ${email} (${customerId})`);
      console.log(`  Текущая сумма: $${currentAmount} (${currentPaymentCount} платежей)`);
      
      try {
        // Получаем ВСЕ платежи клиента из Stripe
        const payments = await stripe.paymentIntents.list({
          customer: customerId,
          limit: 100
        });
        
        const successfulPayments = payments.data.filter(p => {
          if (p.status !== 'succeeded' || !p.customer) return false;
          if (p.description && p.description.toLowerCase().includes('subscription update')) {
            return false;
          }
          return true;
        });
        
        console.log(`  📊 Найдено ${successfulPayments.length} успешных платежей в Stripe`);
        
        if (successfulPayments.length === 0) {
          console.log(`  ⚠️ Нет платежей в Stripe - оставляю как есть`);
          continue;
        }
        
        // Группируем платежи в течение 3 часов
        const groupedPayments = [];
        const processedPayments = new Set();
        
        for (const payment of successfulPayments) {
          if (processedPayments.has(payment.id)) continue;
          
          const group = [payment];
          processedPayments.add(payment.id);
          
          for (const otherPayment of successfulPayments) {
            if (processedPayments.has(otherPayment.id)) continue;
            
            const timeDiff = Math.abs(payment.created - otherPayment.created);
            const hoursDiff = timeDiff / 3600;
            
            if (hoursDiff <= 3) {
              group.push(otherPayment);
              processedPayments.add(otherPayment.id);
            }
          }
          
          groupedPayments.push(group);
        }
        
        console.log(`  📊 Сгруппировано в ${groupedPayments.length} групп`);
        
        // Вычисляем ПРАВИЛЬНЫЕ суммы
        let correctTotalAmount = 0;
        let correctPaymentCount = 0;
        const correctPaymentIds = [];
        
        for (const group of groupedPayments) {
          for (const payment of group) {
            correctTotalAmount += payment.amount;
            correctPaymentCount++;
            correctPaymentIds.push(payment.id);
          }
        }
        
        const correctTotalAmountFormatted = (correctTotalAmount / 100).toFixed(2);
        const correctPaymentIdsString = correctPaymentIds.join(', ');
        
        console.log(`  ✅ Правильная сумма: $${correctTotalAmountFormatted} (${correctPaymentCount} платежей)`);
        
        // Проверяем нужно ли обновление
        const currentAmountNum = parseFloat(currentAmount || '0');
        const correctAmountNum = correctTotalAmount / 100;
        const currentCountNum = parseInt(currentPaymentCount || '0');
        
        if (Math.abs(currentAmountNum - correctAmountNum) > 0.01 || currentCountNum !== correctPaymentCount) {
          // Обновляем строку
          row.set('Total Amount', correctTotalAmountFormatted);
          row.set('Payment Count', correctPaymentCount.toString());
          row.set('Payment Intent IDs', correctPaymentIdsString);
          
          await row.save();
          console.log(`  💾 ОБНОВЛЕНО: $${currentAmount} -> $${correctTotalAmountFormatted}`);
          console.log(`  💾 ОБНОВЛЕНО: ${currentPaymentCount} -> ${correctPaymentCount} платежей`);
          fixedCount++;
        } else {
          console.log(`  ✅ Сумма уже правильная`);
        }
        
        // Задержка для избежания лимитов
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  ❌ Ошибка: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log(`\n🎉 Исправление сумм завершено!`);
    console.log(`  Всего строк: ${rows.length}`);
    console.log(`  Исправлено: ${fixedCount}`);
    console.log(`  Ошибок: ${errorCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка исправления сумм:', error.message);
  }
}

fixAllSums();
