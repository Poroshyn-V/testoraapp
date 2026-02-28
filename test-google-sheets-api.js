import fetch from 'node-fetch';
import crypto from 'crypto';

// Тестируем Google Sheets API напрямую
async function testGoogleSheets() {
  console.log('🔍 Тестируем Google Sheets API...');
  
  const GOOGLE_SHEETS_DOC_ID = process.env.GOOGLE_SHEETS_DOC_ID;
  const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
  const GOOGLE_SERVICE_PRIVATE_KEY = process.env.GOOGLE_SERVICE_PRIVATE_KEY;
  
  console.log('GOOGLE_SHEETS_DOC_ID:', GOOGLE_SHEETS_DOC_ID ? 'Настроен' : 'НЕ НАСТРОЕН');
  console.log('GOOGLE_SERVICE_EMAIL:', GOOGLE_SERVICE_EMAIL ? 'Настроен' : 'НЕ НАСТРОЕН');
  console.log('GOOGLE_SERVICE_PRIVATE_KEY:', GOOGLE_SERVICE_PRIVATE_KEY ? 'Настроен' : 'НЕ НАСТРОЕН');
  
  if (!GOOGLE_SHEETS_DOC_ID || !GOOGLE_SERVICE_EMAIL || !GOOGLE_SERVICE_PRIVATE_KEY) {
    console.log('❌ Google Sheets не настроен полностью');
    return;
  }
  
  try {
    // Создаем JWT токен
    const header = {
      "alg": "RS256",
      "typ": "JWT"
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    // Кодируем header и payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createSign('RSA-SHA256')
      .update(`${encodedHeader}.${encodedPayload}`)
      .sign(GOOGLE_SERVICE_PRIVATE_KEY, 'base64url');
    
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
    
    // Тестируем запись в Google Sheets
    const testData = [
      ['Payment ID', 'Amount', 'Currency', 'Status', 'Created', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name']
    ];
    
    const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_DOC_ID}/values/A1:O1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: testData })
    });
    
    if (sheetsResponse.ok) {
      console.log('✅ Google Sheets тест успешен!');
    } else {
      const errorText = await sheetsResponse.text();
      console.log('❌ Google Sheets error:', errorText);
    }
    
  } catch (error) {
    console.log('❌ Google Sheets error:', error.message);
  }
}

testGoogleSheets();