import { GoogleSpreadsheet } from 'google-spreadsheet';
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
const testData = {
  created_at: new Date().toISOString(),
  session_id: 'test_session_12345',
  payment_status: 'paid',
  amount: 99.99,
  currency: 'USD',
  email: 'test@example.com',
  country: 'US',
  gender: 'male',
  age: '25-34',
  product_tag: 'premium',
  creative_link: 'https://example.com/creative',
  utm_source: 'facebook',
  utm_medium: 'social',
  utm_campaign: 'summer_sale',
  utm_content: 'video_ad',
  utm_term: 'premium_product',
  platform_placement: 'feed',
  ad_name: 'Summer Sale Video',
  adset_name: 'Premium Users',
  campaign_name: 'Summer Campaign 2024',
  web_campaign: 'summer_2024',
  customer_id: 'cus_test123',
  client_reference_id: 'ref_12345',
  mode: 'payment',
  status: 'complete',
  raw_metadata_json: JSON.stringify({
    test: true,
    source: 'manual_test',
    created_by: 'system'
  })
};

async function createGoogleSheetsStructure() {
  try {
    console.log('🔧 Создаем структуру Google Sheets...');
    
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_DOC_ID);
    
    // Аутентификация
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_EMAIL,
      key: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    await doc.useServiceAccountAuth(serviceAccountAuth);
    await doc.loadInfo();
    
    console.log('✅ Подключение к Google Sheets успешно!');
    console.log(`📊 Таблица: ${doc.title}`);
    
    // Создаем или получаем лист "payments"
    let sheet = doc.sheetsByTitle['payments'];
    if (!sheet) {
      console.log('📝 Создаем новый лист "payments"...');
      sheet = await doc.addSheet({ 
        title: 'payments',
        headerValues: HEADERS
      });
      console.log('✅ Лист "payments" создан!');
    } else {
      console.log('📋 Лист "payments" уже существует');
      // Обновляем заголовки
      await sheet.setHeaderRow(HEADERS);
      console.log('✅ Заголовки обновлены!');
    }
    
    // Добавляем тестовую строку
    console.log('📝 Добавляем тестовую строку...');
    await sheet.addRow(testData);
    console.log('✅ Тестовая строка добавлена!');
    
    // Показываем информацию о листе
    await sheet.loadHeaderRow();
    console.log('📊 Заголовки таблицы:', sheet.headerValues);
    console.log('📈 Количество строк:', sheet.rowCount);
    
    console.log('🎉 Структура Google Sheets создана успешно!');
    console.log('🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/' + process.env.GOOGLE_SHEETS_DOC_ID);
    
  } catch (error) {
    console.error('❌ Ошибка при создании структуры Google Sheets:', error);
    console.error('Проверьте переменные окружения:');
    console.error('- GOOGLE_SHEETS_DOC_ID:', process.env.GOOGLE_SHEETS_DOC_ID ? '✅' : '❌');
    console.error('- GOOGLE_SERVICE_EMAIL:', process.env.GOOGLE_SERVICE_EMAIL ? '✅' : '❌');
    console.error('- GOOGLE_SERVICE_PRIVATE_KEY:', process.env.GOOGLE_SERVICE_PRIVATE_KEY ? '✅' : '❌');
  }
}

createGoogleSheetsStructure();
