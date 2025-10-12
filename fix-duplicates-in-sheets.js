// Скрипт для исправления дубликатов в Google Sheets
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

async function fixDuplicates() {
  try {
    console.log('🔧 Исправляю дубликаты в Google Sheets...');
    
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
    
    console.log(`📊 Найдено ${rows.length} строк`);
    
    // Группируем по Customer ID
    const customerGroups = new Map();
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      if (!customerId || customerId === 'N/A' || !email || email === 'N/A') {
        continue;
      }
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push({ row, index: i });
    }
    
    console.log(`📊 Найдено ${customerGroups.size} уникальных клиентов`);
    
    let duplicatesFixed = 0;
    let rowsToDelete = [];
    
    // Обрабатываем каждую группу клиентов
    for (const [customerId, customerRows] of customerGroups.entries()) {
      if (customerRows.length > 1) {
        console.log(`\n🔍 Клиент ${customerId} имеет ${customerRows.length} записей`);
        
        // Сортируем по дате (первая запись остается)
        customerRows.sort((a, b) => {
          const dateA = new Date(a.row.get('Created Local (UTC+1)') || '');
          const dateB = new Date(b.row.get('Created Local (UTC+1)') || '');
          return dateA - dateB;
        });
        
        const firstRow = customerRows[0].row;
        const duplicateRows = customerRows.slice(1);
        
        console.log(`  📅 Первая запись: ${firstRow.get('Created Local (UTC+1)')}`);
        console.log(`  📅 Дубликаты: ${duplicateRows.length}`);
        
        // Получаем все платежи для этого клиента из Stripe
        try {
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
          
          if (successfulPayments.length > 0) {
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
            
            // Вычисляем правильные суммы
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
            
            // Обновляем первую запись
            firstRow.set('Total Amount', correctTotalAmountFormatted);
            firstRow.set('Payment Count', correctPaymentCount.toString());
            firstRow.set('Payment Intent IDs', correctPaymentIdsString);
            
            // Обновляем Purchase ID чтобы он был уникальным для клиента
            firstRow.set('Purchase ID', `purchase_${customerId}`);
            
            await firstRow.save();
            console.log(`  ✅ Обновлена первая запись: $${correctTotalAmountFormatted} (${correctPaymentCount} платежей)`);
            
            // Помечаем дубликаты для удаления
            for (const duplicate of duplicateRows) {
              rowsToDelete.push(duplicate.index);
              console.log(`  🗑️ Помечен для удаления: строка ${duplicate.index + 1}`);
            }
            
            duplicatesFixed++;
          }
        } catch (error) {
          console.log(`  ❌ Ошибка получения платежей для ${customerId}: ${error.message}`);
        }
        
        // Задержка для избежания лимитов
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Удаляем дубликаты (в обратном порядке чтобы индексы не сбились)
    console.log(`\n🗑️ Удаляю ${rowsToDelete.length} дубликатов...`);
    rowsToDelete.sort((a, b) => b - a); // Сортируем по убыванию
    
    for (const index of rowsToDelete) {
      try {
        await rows[index].delete();
        console.log(`  ✅ Удалена строка ${index + 1}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log(`  ❌ Ошибка удаления строки ${index + 1}: ${error.message}`);
      }
    }
    
    console.log(`\n🎉 Исправление дубликатов завершено!`);
    console.log(`  Клиентов с дубликатами: ${duplicatesFixed}`);
    console.log(`  Удалено дубликатов: ${rowsToDelete.length}`);
    
  } catch (error) {
    console.error('❌ Ошибка исправления дубликатов:', error.message);
  }
}

fixDuplicates();
