// Автоматический скрипт для запуска синхронизации
const https = require('https');

const SYNC_URL = 'https://testoraapp.vercel.app/api/sync-payments';
const PING_URL = 'https://testoraapp.vercel.app/ping';

function makeRequest(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runSync() {
  try {
    console.log('🤖 Запускаю синхронизацию...');
    const result = await makeRequest(SYNC_URL, 'POST');
    console.log('✅ Результат:', result);
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

async function keepAlive() {
  try {
    console.log('💓 Поддерживаю активность...');
    await makeRequest(PING_URL, 'GET');
  } catch (error) {
    console.error('❌ Ping ошибка:', error.message);
  }
}

// Запускаем синхронизацию каждые 5 минут
setInterval(runSync, 5 * 60 * 1000);

// Поддерживаем активность каждую минуту
setInterval(keepAlive, 60 * 1000);

// Первый запуск через 10 секунд
setTimeout(runSync, 10000);

console.log('🚀 Автоматический бот запущен!');
console.log('   - Синхронизация каждые 5 минут');
console.log('   - Поддержание активности каждую минуту');
