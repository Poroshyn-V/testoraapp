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

async function findUnknownGeo() {
  try {
    console.log('🔍 ПОИСК ОСТАВШИХСЯ UNKNOWN GEO');
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
      const email = row.get('Email');
      
      if (geo === 'Unknown, Unknown' && customerId) {
        unknownRows.push({ row, customerId, email });
      }
    }
    
    console.log(`❓ Найдено записей с Unknown: ${unknownRows.length}`);
    
    if (unknownRows.length === 0) {
      console.log('🎉 Все GEO данные исправлены!');
      return;
    }
    
    console.log('\n🔍 ДЕТАЛЬНАЯ ПРОВЕРКА UNKNOWN ЗАПИСЕЙ:');
    console.log('==========================================');
    
    let foundGeoCount = 0;
    let notFoundCount = 0;
    
    for (let i = 0; i < unknownRows.length; i++) {
      const { row, customerId, email } = unknownRows[i];
      
      console.log(`\n${i + 1}/${unknownRows.length}. ${email} (${customerId}):`);
      
      try {
        // Получаем клиента из Stripe
        const customer = await stripe.customers.retrieve(customerId);
        
        if (customer && !('deleted' in customer && customer.deleted)) {
          console.log('   📋 Данные клиента:');
          console.log(`   - Email: ${customer.email || 'N/A'}`);
          console.log(`   - Name: ${customer.name || 'N/A'}`);
          console.log(`   - Created: ${new Date(customer.created * 1000).toISOString()}`);
          
          // Проверяем metadata
          if (customer.metadata && Object.keys(customer.metadata).length > 0) {
            console.log('   📝 Metadata:');
            Object.entries(customer.metadata).forEach(([key, value]) => {
              if (key.toLowerCase().includes('geo') || key.toLowerCase().includes('country') || key.toLowerCase().includes('city')) {
                console.log(`     🔍 ${key}: ${value}`);
              } else {
                console.log(`     ${key}: ${value}`);
              }
            });
          } else {
            console.log('   📝 Metadata: пусто');
          }
          
          // Проверяем address
          if (customer.address) {
            console.log('   🏠 Address:');
            console.log(`     Country: ${customer.address.country || 'N/A'}`);
            console.log(`     City: ${customer.address.city || 'N/A'}`);
            console.log(`     Line1: ${customer.address.line1 || 'N/A'}`);
            console.log(`     Postal: ${customer.address.postal_code || 'N/A'}`);
            console.log(`     State: ${customer.address.state || 'N/A'}`);
          } else {
            console.log('   🏠 Address: нет');
          }
          
          // Проверяем shipping
          if (customer.shipping && customer.shipping.address) {
            console.log('   📦 Shipping Address:');
            console.log(`     Country: ${customer.shipping.address.country || 'N/A'}`);
            console.log(`     City: ${customer.shipping.address.city || 'N/A'}`);
            console.log(`     Line1: ${customer.shipping.address.line1 || 'N/A'}`);
            console.log(`     Postal: ${customer.shipping.address.postal_code || 'N/A'}`);
            console.log(`     State: ${customer.shipping.address.state || 'N/A'}`);
          } else {
            console.log('   📦 Shipping Address: нет');
          }
          
          // Проверяем payment methods
          try {
            const paymentMethods = await stripe.paymentMethods.list({
              customer: customerId,
              type: 'card',
              limit: 1
            });
            
            if (paymentMethods.data.length > 0) {
              const pm = paymentMethods.data[0];
              if (pm.card && pm.card.country) {
                console.log(`   💳 Card Country: ${pm.card.country}`);
              }
            }
          } catch (pmError) {
            console.log('   💳 Payment Methods: не удалось получить');
          }
          
          // Пробуем найти GEO данные
          let country = 'Unknown';
          let city = 'Unknown';
          
          // 1. Из metadata (все возможные варианты)
          if (customer.metadata) {
            country = customer.metadata.geo_country || 
                     customer.metadata.country || 
                     customer.metadata.Country || 
                     customer.metadata.geo_country_code ||
                     customer.metadata.country_code ||
                     'Unknown';
            city = customer.metadata.geo_city || 
                   customer.metadata.city || 
                   customer.metadata.City || 
                   customer.metadata.geo_city_name ||
                   customer.metadata.city_name ||
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
          
          // 4. Из payment methods
          if (country === 'Unknown') {
            try {
              const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card',
                limit: 1
              });
              
              if (paymentMethods.data.length > 0 && paymentMethods.data[0].card && paymentMethods.data[0].card.country) {
                country = paymentMethods.data[0].card.country;
                console.log(`   💳 Используем страну из карты: ${country}`);
              }
            } catch (pmError) {
              // Игнорируем ошибки
            }
          }
          
          const newGeo = `${country}, ${city}`;
          console.log(`   🎯 Найденное GEO: ${newGeo}`);
          
          if (country !== 'Unknown' || city !== 'Unknown') {
            console.log(`   ✅ МОЖНО ИСПРАВИТЬ!`);
            foundGeoCount++;
            
            // Обновляем в таблице
            row.set('GEO', newGeo);
            row.set('Country', country);
            row.set('City', city);
            await row.save();
            console.log(`   💾 Обновлено в таблице`);
          } else {
            console.log(`   ❌ GEO данные действительно отсутствуют`);
            notFoundCount++;
          }
          
        } else {
          console.log('   ❌ Клиент не найден или удален');
          notFoundCount++;
        }
        
        // Пауза между запросами
        await new Promise(resolve => setTimeout(resolve, 1500));
        
      } catch (error) {
        console.log(`   ❌ Ошибка: ${error.message}`);
        notFoundCount++;
      }
    }
    
    console.log('\n=====================================');
    console.log('🎯 РЕЗУЛЬТАТЫ ПОИСКА:');
    console.log(`✅ Найдено GEO: ${foundGeoCount}`);
    console.log(`❌ Не найдено: ${notFoundCount}`);
    console.log(`📈 Процент успеха: ${((foundGeoCount / unknownRows.length) * 100).toFixed(1)}%`);
    console.log('=====================================');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

findUnknownGeo();
