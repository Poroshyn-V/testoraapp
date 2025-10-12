import { GoogleSpreadsheet } from 'google-spreadsheet';
import { ENV } from './src/lib/env.js';

async function testGoogleSheets() {
  console.log('🧪 ТЕСТИРУЮ GOOGLE SHEETS НАПРЯМУЮ...\n');

  try {
    // Проверяем переменные окружения
    console.log('🔍 Проверяю переменные окружения:');
    console.log('GOOGLE_SHEETS_DOC_ID:', ENV.GOOGLE_SHEETS_DOC_ID ? '✅ Настроен' : '❌ Не настроен');
    console.log('GOOGLE_SERVICE_EMAIL:', ENV.GOOGLE_SERVICE_EMAIL ? '✅ Настроен' : '❌ Не настроен');
    console.log('GOOGLE_SERVICE_PRIVATE_KEY:', ENV.GOOGLE_SERVICE_PRIVATE_KEY ? '✅ Настроен' : '❌ Не настроен');

    if (!ENV.GOOGLE_SHEETS_DOC_ID || !ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY) {
      console.log('\n❌ Google Sheets не настроен! Нужно добавить переменные в Render.');
      return;
    }

    console.log('\n📊 Подключаюсь к Google Sheets...');
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID);

    console.log('🔐 Аутентификация...');
    await doc.useServiceAccountAuth({
      client_email: ENV.GOOGLE_SERVICE_EMAIL,
      private_key: ENV.GOOGLE_SERVICE_PRIVATE_KEY
    });

    console.log('📋 Загружаю информацию о документе...');
    await doc.loadInfo();

    console.log('✅ Google Sheets подключен успешно!');
    console.log('📄 Название документа:', doc.title);
    console.log('📊 Количество листов:', doc.sheetCount);

    // Проверяем лист payments
    let sheet = doc.sheetsByTitle['payments'];
    if (!sheet) {
      console.log('📋 Создаю лист "payments"...');
      sheet = await doc.addSheet({ title: 'payments' });
    }

    console.log('📋 Лист "payments" найден/создан');

    // Добавляем тестовую строку
    console.log('➕ Добавляю тестовую строку...');
    await sheet.addRow({
      created_at: new Date().toISOString(),
      session_id: 'test_manual_' + Date.now(),
      payment_status: 'paid',
      amount: 1.00,
      currency: 'USD',
      email: 'test@example.com',
      country: 'US',
      test_mode: 'MANUAL_TEST'
    });

    console.log('✅ Тестовая строка добавлена в Google Sheets!');
    console.log('🔗 Проверьте таблицу: https://docs.google.com/spreadsheets/d/' + ENV.GOOGLE_SHEETS_DOC_ID);

  } catch (error) {
    console.error('❌ Ошибка Google Sheets:', error.message);
    console.error('🔍 Детали:', error);
  }
}

testGoogleSheets();
