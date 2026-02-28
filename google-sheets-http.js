import Stripe from 'stripe';
import fetch from 'node-fetch';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function exportToGoogleSheets() {
  try {
    console.log('🔄 Экспорт в Google Sheets через HTTP API...');
    
    // Получаем платежи
    const payments = await stripe.paymentIntents.list({ limit: 10 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    // Создаем JWT токен для аутентификации
    const jwt = await import('jsonwebtoken');
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    const token = jwt.default.sign(payload, process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'), {
      algorithm: 'RS256'
    });
    
    console.log('🔐 JWT токен создан');
    
    // Получаем access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${token}`
    });
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    if (!accessToken) {
      throw new Error('Не удалось получить access token для Google Sheets API.');
    }
    
    console.log('✅ Access token получен');
    
    // Подготавливаем данные
    const spreadsheetId = process.env.GOOGLE_SHEETS_DOC_ID;
    const range = 'Sheet1!A1';
    const values = [
      ['Payment ID', 'Amount', 'Currency', 'Status', 'Created', 'Customer ID', 'Customer Email', 'UTM Source', 'UTM Medium', 'UTM Campaign']
    ];
    
    for (const payment of payments.data) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const metadata = customer?.metadata || {};
      
      values.push([
        payment.id,
        `$${(payment.amount / 100).toFixed(2)}`,
        payment.currency.toUpperCase(),
        payment.status,
        new Date(payment.created * 1000).toLocaleString(),
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        metadata.utm_source || 'N/A',
        metadata.utm_medium || 'N/A',
        metadata.utm_campaign || 'N/A'
      ]);
    }
    
    // Очищаем лист
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('🧹 Лист очищен');
    
    // Добавляем данные
    const updateResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    });
    
    const updateData = await updateResponse.json();
    
    if (updateData.error) {
      throw new Error(updateData.error.message);
    }
    
    console.log(`🎉 ГОТОВО! ${payments.data.length} платежей в Google Sheets`);
    console.log(`📊 Ссылка: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('🔍 Детали:', error);
  }
}

exportToGoogleSheets();