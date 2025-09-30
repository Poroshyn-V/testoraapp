import Stripe from 'stripe';
import fetch from 'node-fetch';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function debugGoogleSheets() {
  try {
    console.log('🔍 ДЕБАГ GOOGLE SHEETS И ГЕО ДАННЫХ...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({ limit: 3 });
    
    for (const payment of payments.data) {
      console.log(`\n💳 Платеж: ${payment.id}`);
      console.log(`   Amount: $${(payment.amount / 100).toFixed(2)}`);
      console.log(`   Status: ${payment.status}`);
      
      if (payment.customer) {
        const customer = await stripe.customers.retrieve(payment.customer);
        const metadata = customer?.metadata || {};
        
        console.log(`   Customer Email: ${customer?.email || 'НЕТ'}`);
        console.log(`   UTM Source: ${metadata.utm_source || 'НЕТ'}`);
        console.log(`   UTM Campaign: ${metadata.utm_campaign || 'НЕТ'}`);
        console.log(`   Ad Name: ${metadata.ad_name || 'НЕТ'}`);
        console.log(`   IP Address: ${metadata.ip_address || 'НЕТ'}`);
        console.log(`   Geo Country: ${metadata.geo_country || 'НЕТ'}`);
        console.log(`   Geo City: ${metadata.geo_city || 'НЕТ'}`);
        
        // Тестируем ГЕО по IP
        const ipAddress = metadata.ip_address;
        if (ipAddress && ipAddress !== 'N/A' && !ipAddress.includes(':')) {
          try {
            console.log(`   🔍 Тестируем ГЕО для IP: ${ipAddress}`);
            const geoResponse = await fetch(`https://ipinfo.io/${ipAddress}/json`);
            const geoData = await geoResponse.json();
            console.log(`   🌍 ГЕО результат:`, geoData);
            
            const country = geoData.country || 'N/A';
            const city = geoData.city || 'N/A';
            const geo = `${country}, ${city}`;
            console.log(`   📍 Итоговый ГЕО: ${geo}`);
          } catch (error) {
            console.log(`   ❌ Ошибка ГЕО: ${error.message}`);
          }
        } else {
          console.log(`   ⚠️ IP не подходит для ГЕО: ${ipAddress}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

debugGoogleSheets();
