import Stripe from 'stripe';
import fetch from 'node-fetch';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function exportAllPaymentsToGoogleSheets() {
  try {
    console.log('🔄 Экспорт ВСЕХ платежей в Google Sheets...');
    
    // Получаем ВСЕ платежи
    const payments = await stripe.paymentIntents.list({ limit: 100 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    // Создаем правильный JWT токен
    const header = {
      "alg": "RS256",
      "typ": "JWT"
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    // Кодируем header и payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    // Исправляем формат приватного ключа
    const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .replace(/"/g, '');
    
    const signature = crypto.createSign('RSA-SHA256')
      .update(`${encodedHeader}.${encodedPayload}`)
      .sign(privateKey, 'base64url');
    
    const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Получаем access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.log('❌ Ошибка получения токена:', errorText);
      return;
    }
    
    const tokenData = await tokenResponse.json();
    console.log('✅ Токен получен успешно');
    
    // Подготавливаем данные для экспорта
    const exportData = [
      ['Payment ID', 'Amount', 'Currency', 'Status', 'Created', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name']
    ];
    
    for (const payment of payments.data) {
      // Получаем данные клиента
      let customer = null;
      if (payment.customer) {
        customer = await stripe.customers.retrieve(payment.customer);
      }
      
      // Формируем GEO данные
      let geoData = 'N/A';
      if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
        geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
      } else if (customer?.address?.country) {
        geoData = customer.address.country;
      }
      
      const row = [
        payment.id,
        (payment.amount / 100).toFixed(2),
        payment.currency.toUpperCase(),
        payment.status,
        new Date(payment.created * 1000).toISOString(),
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        geoData,
        customer?.metadata?.utm_source || 'N/A',
        customer?.metadata?.utm_medium || 'N/A',
        customer?.metadata?.utm_campaign || 'N/A',
        customer?.metadata?.utm_content || 'N/A',
        customer?.metadata?.utm_term || 'N/A',
        customer?.metadata?.ad_name || 'N/A',
        customer?.metadata?.adset_name || 'N/A'
      ];
      
      exportData.push(row);
    }
    
    console.log(`📝 Подготовлено ${exportData.length} строк для экспорта`);
    
    // Очищаем лист и записываем новые данные
    const range = `A1:O${exportData.length}`;
    const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/${range}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: exportData })
    });
    
    if (sheetsResponse.ok) {
      console.log('✅ Google Sheets экспорт успешен!');
      console.log(`📊 Экспортировано ${exportData.length - 1} платежей`);
      console.log(`🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_DOC_ID}`);
    } else {
      const errorText = await sheetsResponse.text();
      console.log('❌ Google Sheets error:', errorText);
    }
    
  } catch (error) {
    console.log('❌ Ошибка экспорта:', error.message);
  }
}

exportAllPaymentsToGoogleSheets();
