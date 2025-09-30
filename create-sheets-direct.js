import fetch from 'node-fetch';
import { JWT } from 'google-auth-library';

// Заголовки для Google Sheets
const HEADERS = [
  'created_at', 'session_id', 'payment_status', 'amount', 'currency', 'email', 'country', 'gender', 'age',
  'product_tag', 'creative_link',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'platform_placement', 'ad_name', 'adset_name', 'campaign_name', 'web_campaign',
  'customer_id', 'client_reference_id', 'mode', 'status', 'raw_metadata_json'
];

// Тестовые данные
const testData = [
  new Date().toISOString(),
  'test_session_12345',
  'paid',
  99.99,
  'USD',
  'test@example.com',
  'US',
  'male',
  '25-34',
  'premium',
  'https://example.com/creative',
  'facebook',
  'social',
  'summer_sale',
  'video_ad',
  'premium_product',
  'feed',
  'Summer Sale Video',
  'Premium Users',
  'Summer Campaign 2024',
  'summer_2024',
  'cus_test123',
  'ref_12345',
  'payment',
  'complete',
  JSON.stringify({
    test: true,
    source: 'manual_test',
    created_by: 'system'
  })
];

async function createGoogleSheetsStructure() {
  try {
    console.log('🔧 Создаем структуру Google Sheets через API...');
    
    const docId = process.env.GOOGLE_SHEETS_DOC_ID;
    const serviceEmail = process.env.GOOGLE_SERVICE_EMAIL;
    const privateKey = (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    
    // Создаем JWT токен
    const jwt = new JWT({
      email: serviceEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const accessToken = await jwt.getAccessToken();
    
    console.log('✅ JWT токен получен!');
    
    // Создаем лист "payments"
    const createSheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${docId}:batchUpdate`;
    
    const createSheetRequest = {
      requests: [
        {
          addSheet: {
            properties: {
              title: 'payments',
              gridProperties: {
                rowCount: 1000,
                columnCount: 26
              }
            }
          }
        }
      ]
    };
    
    console.log('📝 Создаем лист "payments"...');
    
    const createResponse = await fetch(createSheetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createSheetRequest)
    });
    
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log('⚠️ Лист уже существует или ошибка:', error);
    } else {
      console.log('✅ Лист "payments" создан!');
    }
    
    // Добавляем заголовки
    const updateHeadersUrl = `https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/payments!A1:Z1?valueInputOption=RAW`;
    
    console.log('📊 Добавляем заголовки...');
    
    const headersResponse = await fetch(updateHeadersUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [HEADERS]
      })
    });
    
    if (headersResponse.ok) {
      console.log('✅ Заголовки добавлены!');
    } else {
      console.log('⚠️ Ошибка при добавлении заголовков:', await headersResponse.text());
    }
    
    // Добавляем тестовую строку
    const addTestDataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/payments!A2:Z2?valueInputOption=RAW`;
    
    console.log('📝 Добавляем тестовую строку...');
    
    const testDataResponse = await fetch(addTestDataUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [testData]
      })
    });
    
    if (testDataResponse.ok) {
      console.log('✅ Тестовая строка добавлена!');
    } else {
      console.log('⚠️ Ошибка при добавлении тестовых данных:', await testDataResponse.text());
    }
    
    console.log('🎉 Структура Google Sheets создана успешно!');
    console.log('🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/' + docId);
    
  } catch (error) {
    console.error('❌ Ошибка при создании структуры Google Sheets:', error);
    console.error('Проверьте переменные окружения:');
    console.error('- GOOGLE_SHEETS_DOC_ID:', process.env.GOOGLE_SHEETS_DOC_ID ? '✅' : '❌');
    console.error('- GOOGLE_SERVICE_EMAIL:', process.env.GOOGLE_SERVICE_EMAIL ? '✅' : '❌');
    console.error('- GOOGLE_SERVICE_PRIVATE_KEY:', process.env.GOOGLE_SERVICE_PRIVATE_KEY ? '✅' : '❌');
  }
}

createGoogleSheetsStructure();
