// Простой тест Google Sheets локально
require('dotenv').config();
const crypto = require('crypto');

async function testGoogleSheets() {
  try {
    console.log('🧪 ТЕСТ GOOGLE SHEETS ЛОКАЛЬНО...');
    
    console.log('GOOGLE_SHEETS_DOC_ID:', process.env.GOOGLE_SHEETS_DOC_ID ? 'Настроен' : 'НЕ НАСТРОЕН');
    console.log('GOOGLE_SERVICE_EMAIL:', process.env.GOOGLE_SERVICE_EMAIL ? 'Настроен' : 'НЕ НАСТРОЕН');
    console.log('GOOGLE_SERVICE_PRIVATE_KEY:', process.env.GOOGLE_SERVICE_PRIVATE_KEY ? 'Настроен' : 'НЕ НАСТРОЕН');
    
    if (!process.env.GOOGLE_SHEETS_DOC_ID || !process.env.GOOGLE_SERVICE_EMAIL || !process.env.GOOGLE_SERVICE_PRIVATE_KEY) {
      console.log('❌ Google Sheets не настроен полностью');
      return;
    }
    
    // Создаем JWT токен
    const header = { "alg": "RS256", "typ": "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    // Пробуем разные варианты форматирования ключа
    let privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY;
    
    // Вариант 1: убираем кавычки и заменяем \n
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/"/g, '');
    
    let signature;
    try {
      signature = crypto.createSign('RSA-SHA256')
        .update(`${encodedHeader}.${encodedPayload}`)
        .sign(privateKey, 'base64url');
      console.log('✅ Вариант 1 сработал');
    } catch (error) {
      console.log('❌ Ошибка с вариантом 1:', error.message);
      
      // Вариант 2: добавляем заголовки и подвал
      privateKey = `-----BEGIN PRIVATE KEY-----\n${process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '')}\n-----END PRIVATE KEY-----`;
      
      try {
        signature = crypto.createSign('RSA-SHA256')
          .update(`${encodedHeader}.${encodedPayload}`)
          .sign(privateKey, 'base64url');
        console.log('✅ Вариант 2 сработал');
      } catch (error2) {
        console.log('❌ Ошибка с вариантом 2:', error2.message);
        return;
      }
    }
    
    const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
    console.log('✅ JWT токен создан');
    
    // Получаем access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (tokenResponse.ok) {
      const tokenData = await tokenResponse.json();
      console.log('✅ Access token получен');
      
      // Очищаем весь лист
      const clearResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Z:clear?valueInputOption=RAW`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (clearResponse.ok) {
        console.log('✅ Google Sheets очищен');
      } else {
        console.log('⚠️ Не удалось очистить лист');
      }
      
      // Записываем простые тестовые данные
      const testData = [
        ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count'],
        ['test_1', '9.99', 'USD', 'succeeded', '2025-01-01T00:00:00.000Z', '2025-01-01 01:00:00.000 UTC+1', 'cus_test1', 'test@example.com', 'US, New York', 'google', 'cpc', 'test_campaign', 'test_content', 'test_term', 'test_ad', 'test_adset', 1],
        ['test_2', '19.99', 'USD', 'succeeded', '2025-01-02T00:00:00.000Z', '2025-01-02 01:00:00.000 UTC+1', 'cus_test2', 'test2@example.com', 'DE, Berlin', 'facebook', 'cpc', 'test_campaign2', 'test_content2', 'test_term2', 'test_ad2', 'test_adset2', 1]
      ];
      
      const range = `A1:Q${testData.length}`;
      const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/${range}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: testData })
      });
        
      if (sheetsResponse.ok) {
        console.log('✅ ТЕСТОВЫЕ ДАННЫЕ ЗАПИСАНЫ В GOOGLE SHEETS');
        console.log(`🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_DOC_ID}`);
      } else {
        const errorText = await sheetsResponse.text();
        console.log('❌ Ошибка записи в Google Sheets:', errorText);
      }
    } else {
      const errorText = await tokenResponse.text();
      console.log('❌ Ошибка получения токена Google Sheets:', errorText);
    }
  } catch (error) {
    console.log('❌ Ошибка теста Google Sheets:', error.message);
  }
}

// Запускаем тест
testGoogleSheets();

