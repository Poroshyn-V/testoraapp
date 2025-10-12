// Быстрое исправление Google Sheets данных
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

async function quickFix() {
  try {
    console.log('🚀 Быстрое исправление Google Sheets...');
    
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
    
    let fixed = 0;
    
    // Исправляем только последние 10 строк для быстрого теста
    const lastRows = rows.slice(-10);
    
    for (let i = 0; i < lastRows.length; i++) {
      const row = lastRows[i];
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      if (!customerId || customerId === 'N/A' || !email || email === 'N/A') {
        continue;
      }
      
      console.log(`\n🔍 Исправляю строку ${rows.length - lastRows.length + i + 1}: ${email}`);
      
      try {
        // 1. Исправляем GEO
        const currentGeo = row.get('GEO') || '';
        if (currentGeo.includes('Unknown') || currentGeo === '') {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer && !('deleted' in customer && customer.deleted)) {
            const customerMetadata = customer.metadata || {};
            let geoCountry = customerMetadata.geo_country || customer?.address?.country || 'Unknown';
            let geoCity = customerMetadata.geo_city || customer?.address?.city || '';
            
            if (geoCountry === 'Unknown' && customer?.id) {
              try {
                const paymentMethods = await stripe.paymentMethods.list({
                  customer: customer.id,
                  type: 'card',
                  limit: 1
                });
                
                if (paymentMethods.data.length > 0 && paymentMethods.data[0].card && paymentMethods.data[0].card.country) {
                  geoCountry = paymentMethods.data[0].card.country;
                }
              } catch (pmError) {
                // Игнорируем ошибки
              }
            }
            
            const newGeo = geoCity ? `${geoCountry}, ${geoCity}` : geoCountry;
            row.set('GEO', newGeo);
            console.log(`  ✅ GEO: "${currentGeo}" -> "${newGeo}"`);
          }
        }
        
        // 2. Исправляем суммы
        const currentPaymentIds = row.get('Payment Intent IDs') || '';
        if (currentPaymentIds) {
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
            
            row.set('Total Amount', correctTotalAmountFormatted);
            row.set('Payment Count', correctPaymentCount.toString());
            row.set('Payment Intent IDs', correctPaymentIdsString);
            
            console.log(`  ✅ Суммы: $${(correctTotalAmount / 100).toFixed(2)} (${correctPaymentCount} платежей)`);
          }
        }
        
        await row.save();
        fixed++;
        console.log(`  💾 Строка сохранена`);
        
        // Задержка для избежания лимитов
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  ❌ Ошибка: ${error.message}`);
      }
    }
    
    console.log(`\n🎉 Быстрое исправление завершено! Исправлено ${fixed} строк`);
    
  } catch (error) {
    console.error('❌ Ошибка быстрого исправления:', error.message);
  }
}

quickFix();
