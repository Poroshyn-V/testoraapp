// Скрипт для обновления времени UTC+1 для всех существующих записей (где время пустое)
import { config } from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';

config();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const GOOGLE_SHEETS_DOC_ID = process.env.GOOGLE_SHEETS_DOC_ID;
const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const GOOGLE_SERVICE_PRIVATE_KEY = (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// Format UTC+1 and LA time from payment
function formatTimes(payment) {
  const createdDate = new Date(payment.created * 1000);
  const createdUTC = createdDate.toISOString();
  
  // Format UTC+1: YYYY-MM-DD HH:MM:SS.000 UTC+1
  const utcPlus1Date = new Date(createdDate.getTime() + 60 * 60 * 1000);
  const year = utcPlus1Date.getFullYear();
  const month = String(utcPlus1Date.getMonth() + 1).padStart(2, '0');
  const day = String(utcPlus1Date.getDate()).padStart(2, '0');
  const hours = String(utcPlus1Date.getHours()).padStart(2, '0');
  const minutes = String(utcPlus1Date.getMinutes()).padStart(2, '0');
  const seconds = String(utcPlus1Date.getSeconds()).padStart(2, '0');
  const createdLocal = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.000 UTC+1`;
  
  // Format LA time (Pacific Time)
  const laFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const laParts = laFormatter.formatToParts(createdDate);
  const laYear = laParts.find(p => p.type === 'year').value;
  const laMonth = laParts.find(p => p.type === 'month').value;
  const laDay = laParts.find(p => p.type === 'day').value;
  const laHours = laParts.find(p => p.type === 'hour').value;
  const laMinutes = laParts.find(p => p.type === 'minute').value;
  const laSeconds = laParts.find(p => p.type === 'second').value;
  const createdLATime = `${laYear}-${laMonth.padStart(2, '0')}-${laDay.padStart(2, '0')} ${laHours.padStart(2, '0')}:${laMinutes.padStart(2, '0')}:${laSeconds.padStart(2, '0')}.000 LA Time`;
  
  return {
    'Created UTC': createdUTC,
    'Created Local (UTC+1)': createdLocal,
    'Created Local (LA Time)': createdLATime
  };
}

async function updateExistingUtcTime() {
  console.log('🔄 Начинаем обновление времени UTC+1 для существующих записей...\n');

  try {
    // Подключаемся к Stripe
    if (!STRIPE_KEY) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    const stripe = new Stripe(STRIPE_KEY);

    // Подключаемся к Google Sheets
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_EMAIL,
      key: GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0]; // Основной лист
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    
    console.log(`📋 Найдено ${rows.length} записей в основном листе\n`);

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const paymentIntentIds = row.get('Payment Intent IDs') || '';
        const existingLocalTime = row.get('Created Local (UTC+1)') || row.get('Created Local (UTC+10)') || '';
        const existingLATime = row.get('Created Local (LA Time)') || '';
        
        // Пропускаем, если время уже заполнено (проверяем UTC+1 и LA)
        if (existingLocalTime && existingLocalTime !== '' && existingLocalTime !== 'N/A' &&
            existingLATime && existingLATime !== '' && existingLATime !== 'N/A') {
          skipped++;
          continue;
        }
        
        if (!paymentIntentIds || paymentIntentIds === 'N/A') {
          skipped++;
          continue;
        }

        // Получаем первый Payment Intent ID
        const firstPaymentId = paymentIntentIds.split(',')[0].trim();
        
        // Получаем данные платежа из Stripe
        const payment = await stripe.paymentIntents.retrieve(firstPaymentId);

        // Форматируем время UTC+1 и LA
        const timeData = formatTimes(payment);

        // Обновляем все колонки времени
        const updateData = {};
        
        // Проверяем какие колонки есть и обновляем их
        if (sheet.headerValues.includes('Created UTC')) {
          updateData['Created UTC'] = timeData['Created UTC'];
        }
        
        if (sheet.headerValues.includes('Created Local (UTC+1)')) {
          updateData['Created Local (UTC+1)'] = timeData['Created Local (UTC+1)'];
        } else if (sheet.headerValues.includes('Created Local (UTC+10)')) {
          updateData['Created Local (UTC+10)'] = timeData['Created Local (UTC+1)'];
        }
        
        if (sheet.headerValues.includes('Created Local (LA Time)')) {
          updateData['Created Local (LA Time)'] = timeData['Created Local (LA Time)'];
        }
        
        if (Object.keys(updateData).length > 0) {
          await row.save(updateData);
          updated++;
          
          if (updated % 10 === 0) {
            console.log(`   ✅ Обновлено ${updated} записей...`);
          }
        } else {
          skipped++;
        }

      } catch (error) {
        console.error(`   ❌ Ошибка при обновлении строки ${row.rowNumber}:`, error.message);
        skipped++;
      }
    }

    console.log(`\n✅ ГОТОВО!`);
    console.log(`   📊 Обновлено: ${updated} записей`);
    console.log(`   ⏭️ Пропущено: ${skipped} записей (время уже заполнено или нет данных)`);

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error);
    process.exit(1);
  }
}

updateExistingUtcTime();

