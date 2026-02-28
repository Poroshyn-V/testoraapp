#!/usr/bin/env node
/**
 * Скрипт для проверки валидности Google OAuth credentials
 * Помогает диагностировать проблемы с токенами
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');

async function checkGoogleCredentials() {
  console.log('🔍 Проверка Google OAuth credentials...\n');
  
  // Проверяем наличие переменных окружения
  const checks = {
    hasEmail: !!ENV.GOOGLE_SERVICE_EMAIL,
    hasPrivateKey: !!ENV.GOOGLE_SERVICE_PRIVATE_KEY,
    hasDocId: !!ENV.GOOGLE_SHEETS_DOC_ID,
    emailValue: ENV.GOOGLE_SERVICE_EMAIL ? `${ENV.GOOGLE_SERVICE_EMAIL.substring(0, 20)}...` : 'NOT SET',
    docIdValue: ENV.GOOGLE_SHEETS_DOC_ID ? `${ENV.GOOGLE_SHEETS_DOC_ID.substring(0, 20)}...` : 'NOT SET',
    privateKeyLength: ENV.GOOGLE_SERVICE_PRIVATE_KEY ? ENV.GOOGLE_SERVICE_PRIVATE_KEY.length : 0
  };
  
  console.log('📋 Конфигурация:');
  console.log(`   ✅ GOOGLE_SERVICE_EMAIL: ${checks.hasEmail ? '✅ Set' : '❌ NOT SET'}`);
  console.log(`   ${checks.hasEmail ? `   Email: ${checks.emailValue}` : ''}`);
  console.log(`   ✅ GOOGLE_SERVICE_PRIVATE_KEY: ${checks.hasPrivateKey ? '✅ Set' : '❌ NOT SET'}`);
  console.log(`   ${checks.hasPrivateKey ? `   Key length: ${checks.privateKeyLength} chars` : ''}`);
  console.log(`   ✅ GOOGLE_SHEETS_DOC_ID: ${checks.hasDocId ? '✅ Set' : '❌ NOT SET'}`);
  console.log(`   ${checks.hasDocId ? `   Doc ID: ${checks.docIdValue}` : ''}\n`);
  
  if (!checks.hasEmail || !checks.hasPrivateKey || !checks.hasDocId) {
    console.error('❌ Не все переменные окружения настроены!');
    process.exit(1);
  }
  
  // Проверяем формат приватного ключа
  console.log('🔑 Проверка формата приватного ключа...');
  const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
  const hasBeginEnd = privateKey.includes('-----BEGIN') && privateKey.includes('-----END');
  const hasNewlines = privateKey.includes('\\n') || privateKey.includes('\n');
  
  console.log(`   ${hasBeginEnd ? '✅' : '❌'} Содержит BEGIN/END маркеры: ${hasBeginEnd}`);
  console.log(`   ${hasNewlines ? '✅' : '⚠️'} Содержит переносы строк: ${hasNewlines}\n`);
  
  if (!hasBeginEnd) {
    console.error('❌ Приватный ключ не содержит BEGIN/END маркеры!');
    console.error('   Убедитесь, что ключ в правильном формате PEM');
    process.exit(1);
  }
  
  // Пытаемся создать JWT клиент
  console.log('🔐 Создание JWT клиента...');
  let serviceAccountAuth;
  try {
    // Нормализуем приватный ключ (заменяем \\n на \n)
    const normalizedKey = privateKey.replace(/\\n/g, '\n');
    
    serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: normalizedKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    console.log('   ✅ JWT клиент создан успешно\n');
  } catch (error) {
    console.error('   ❌ Ошибка создания JWT клиента:', error.message);
    console.error('   Возможные причины:');
    console.error('   - Неправильный формат приватного ключа');
    console.error('   - Ключ не соответствует email');
    console.error('   - Ключ поврежден или неполный');
    process.exit(1);
  }
  
  // Пытаемся получить access token
  console.log('🎫 Получение access token...');
  try {
    const token = await serviceAccountAuth.getAccessToken();
    if (token) {
      console.log('   ✅ Access token получен успешно');
      console.log(`   Token: ${token.token.substring(0, 20)}...`);
      console.log(`   Expires: ${token.res ? 'Available' : 'N/A'}\n`);
    } else {
      console.error('   ❌ Не удалось получить access token');
      process.exit(1);
    }
  } catch (error) {
    console.error('   ❌ Ошибка получения access token:', error.message);
    console.error('   Возможные причины:');
    console.error('   - Неправильные credentials');
    console.error('   - Service account не активирован');
    console.error('   - Проблемы с сетью');
    console.error('   - Истек срок действия ключа');
    process.exit(1);
  }
  
  // Пытаемся подключиться к Google Sheets
  console.log('📊 Подключение к Google Sheets...');
  try {
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    console.log('   ✅ Подключение успешно!');
    console.log(`   📄 Название документа: ${doc.title}`);
    console.log(`   📋 Количество листов: ${doc.sheetCount}`);
    console.log(`   📝 Листы: ${Object.keys(doc.sheetsByTitle).join(', ')}\n`);
    
    // Пытаемся загрузить первый лист
    if (doc.sheetCount > 0) {
      const firstSheet = doc.sheetsByIndex[0];
      console.log(`📋 Тестирование доступа к листу "${firstSheet.title}"...`);
      try {
        await firstSheet.loadHeaderRow();
        const rows = await firstSheet.getRows({ limit: 1 });
        console.log(`   ✅ Доступ к листу успешен!`);
        console.log(`   📊 Всего строк: ${firstSheet.rowCount}`);
        console.log(`   📝 Заголовки: ${Object.keys(firstSheet.headerValues || {}).join(', ')}\n`);
      } catch (sheetError) {
        console.error('   ❌ Ошибка доступа к листу:', sheetError.message);
        console.error('   Возможные причины:');
        console.error('   - Нет прав доступа к листу');
        console.error('   - Лист слишком большой');
        console.error('   - Проблемы с сетью');
      }
    }
  } catch (error) {
    console.error('   ❌ Ошибка подключения к Google Sheets:', error.message);
    console.error('   Возможные причины:');
    console.error('   - Неправильный GOOGLE_SHEETS_DOC_ID');
    console.error('   - Service account не имеет доступа к документу');
    console.error('   - Проблемы с сетью');
    console.error('   - Истек срок действия токена');
    process.exit(1);
  }
  
  console.log('✅ Все проверки пройдены успешно!');
  console.log('   Google OAuth credentials валидны и работают корректно.\n');
}

// Запускаем проверку
checkGoogleCredentials()
  .then(() => {
    console.log('✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Критическая ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
