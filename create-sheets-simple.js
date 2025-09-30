// Простой скрипт для создания структуры Google Sheets
const headers = [
  'created_at', 'session_id', 'payment_status', 'amount', 'currency', 'email', 'country', 'gender', 'age',
  'product_tag', 'creative_link',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'platform_placement', 'ad_name', 'adset_name', 'campaign_name', 'web_campaign',
  'customer_id', 'client_reference_id', 'mode', 'status', 'raw_metadata_json'
];

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

console.log('🎯 СОЗДАНИЕ СТРУКТУРЫ GOOGLE SHEETS');
console.log('=====================================');
console.log('');
console.log('📊 ЗАГОЛОВКИ (скопируйте в A1-Z1):');
console.log(headers.join('\t'));
console.log('');
console.log('📝 ТЕСТОВЫЕ ДАННЫЕ (скопируйте в A2-Z2):');
console.log(testData.join('\t'));
console.log('');
console.log('🔗 ССЫЛКА НА ТАБЛИЦУ:');
console.log('https://docs.google.com/spreadsheets/d/146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4');
console.log('');
console.log('📋 ИНСТРУКЦИЯ:');
console.log('1. Откройте ссылку выше');
console.log('2. Создайте новый лист "payments"');
console.log('3. Скопируйте заголовки в первую строку');
console.log('4. Скопируйте тестовые данные во вторую строку');
console.log('');
console.log('✅ ГОТОВО! Система будет работать автоматически!');
