import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function fixRemainingGeo() {
  try {
    console.log('🔧 ИСПРАВЛЕНИЕ ОСТАВШИХСЯ GEO ДАННЫХ');
    console.log('=====================================');
    
    const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    
    console.log(`📊 Всего записей: ${rows.length}`);
    
    let unknownRows = [];
    
    // Находим все записи с Unknown
    for (const row of rows) {
      const geo = row.get('GEO');
      const customerId = row.get('Customer ID');
      
      if (geo === 'Unknown, Unknown' && customerId) {
        unknownRows.push({ row, customerId });
      }
    }
    
    console.log(`❓ Найдено записей с Unknown: ${unknownRows.length}`);
    
    if (unknownRows.length === 0) {
      console.log('🎉 Все GEO данные уже исправлены!');
      return;
    }
    
    let fixedCount = 0;
    let notFoundCount = 0;
    
    console.log('\n🔧 ИСПРАВЛЯЕМ GEO ДАННЫЕ...');
    console.log('============================');
    
    for (let i = 0; i < unknownRows.length; i++) {
      const { row, customerId } = unknownRows[i];
      const email = row.get('Email');
      
      console.log(`${i + 1}/${unknownRows.length}. Исправляем ${email}...`);
      
      try {
        // Получаем клиента из Stripe
        const customer = await stripe.customers.retrieve(customerId);
        
        if (customer && !('deleted' in customer && customer.deleted)) {
          // Ищем GEO данные в разных источниках
          let country = 'Unknown';
          let city = 'Unknown';
          
          // 1. Из metadata (включая geo_country и geo_city)
          if (customer.metadata) {
            country = customer.metadata.geo_country || 
                     customer.metadata.country || 
                     customer.metadata.Country || 
                     'Unknown';
            city = customer.metadata.geo_city || 
                   customer.metadata.city || 
                   customer.metadata.City || 
                   'Unknown';
          }
          
          // 2. Из address
          if (customer.address) {
            if (country === 'Unknown' && customer.address.country) {
              country = customer.address.country;
            }
            if (city === 'Unknown' && customer.address.city) {
              city = customer.address.city;
            }
          }
          
          // 3. Из shipping address
          if (customer.shipping && customer.shipping.address) {
            if (country === 'Unknown' && customer.shipping.address.country) {
              country = customer.shipping.address.country;
            }
            if (city === 'Unknown' && customer.shipping.address.city) {
              city = customer.shipping.address.city;
            }
          }
          
          const newGeo = `${country}, ${city}`;
          
          if (country !== 'Unknown' || city !== 'Unknown') {
            // Обновляем в таблице
            row.set('GEO', newGeo);
            row.set('Country', country);
            row.set('City', city);
            await row.save();
            
            console.log(`   ✅ Обновлено: ${newGeo}`);
            fixedCount++;
          } else {
            console.log(`   ❌ GEO данные отсутствуют`);
            notFoundCount++;
          }
          
        } else {
          console.log(`   ❌ Клиент не найден или удален`);
          notFoundCount++;
        }
        
        // Пауза между запросами
        if (i % 10 === 0 && i > 0) {
          console.log(`⏳ Пауза 2 секунды...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.log(`   ❌ Ошибка: ${error.message}`);
        notFoundCount++;
      }
    }
    
    console.log('\n=====================================');
    console.log('🎉 ИСПРАВЛЕНИЕ GEO ЗАВЕРШЕНО!');
    console.log(`✅ Исправлено: ${fixedCount}`);
    console.log(`❌ Не найдено: ${notFoundCount}`);
    console.log(`📈 Процент успеха: ${((fixedCount / unknownRows.length) * 100).toFixed(1)}%`);
    console.log('=====================================');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

fixRemainingGeo();
