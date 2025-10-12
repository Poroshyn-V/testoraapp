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

async function fixGeoData() {
  try {
    console.log('🌍 ИСПРАВЛЕНИЕ GEO ДАННЫХ');
    console.log('==========================');
    
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
    
    console.log(`📊 Найдено ${rows.length} записей для проверки`);
    
    let fixedCount = 0;
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const customerId = row.get('Customer ID');
      const currentGeo = row.get('GEO');
      
      if (!customerId || currentGeo !== 'Unknown, Unknown') {
        continue; // Пропускаем если нет Customer ID или GEO уже правильный
      }
      
      console.log(`🔍 Исправляю GEO для ${customerId}...`);
      
      try {
        // Получаем данные клиента из Stripe
        const customer = await stripe.customers.retrieve(customerId);
        
        if (customer && !('deleted' in customer && customer.deleted)) {
          // Пробуем разные источники GEO данных
          let country = 'Unknown';
          let city = 'Unknown';
          
          // 1. Из metadata
          if (customer.metadata) {
            country = customer.metadata.country || customer.metadata.geo_country || 'Unknown';
            city = customer.metadata.city || customer.metadata.geo_city || 'Unknown';
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
          
          // Обновляем GEO
          const newGeo = `${country}, ${city}`;
          row.set('GEO', newGeo);
          row.set('Country', country);
          row.set('City', city);
          
          await row.save();
          fixedCount++;
          
          console.log(`   ✅ Обновлено: ${newGeo}`);
        }
        
        // Пауза между запросами
        if (i % 10 === 0 && i > 0) {
          console.log(`⏳ Пауза 2 секунды...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`   ❌ Ошибка для ${customerId}:`, error.message);
      }
    }
    
    console.log('==========================');
    console.log('🎉 ИСПРАВЛЕНИЕ GEO ЗАВЕРШЕНО!');
    console.log(`✅ Исправлено записей: ${fixedCount}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

fixGeoData();
