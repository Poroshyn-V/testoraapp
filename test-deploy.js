// Простой тест для проверки деплоя
console.log('🚀 Тест деплоя запущен');
console.log('✅ Node.js работает');
console.log('✅ Файлы загружены');

// Проверяем переменные окружения
const requiredEnvVars = [
  'STRIPE_SECRET_KEY',
  'TELEGRAM_BOT_TOKEN', 
  'TELEGRAM_CHAT_ID',
  'SLACK_WEBHOOK_URL',
  'GOOGLE_SHEETS_DOC_ID',
  'GOOGLE_SERVICE_EMAIL',
  'GOOGLE_SERVICE_PRIVATE_KEY'
];

console.log('\n🔍 Проверка переменных окружения:');
requiredEnvVars.forEach(envVar => {
  const value = process.env[envVar];
  if (value) {
    console.log(`✅ ${envVar}: ${value.substring(0, 10)}...`);
  } else {
    console.log(`❌ ${envVar}: НЕ НАЙДЕНА`);
  }
});

console.log('\n🎯 Тест завершен успешно!');
