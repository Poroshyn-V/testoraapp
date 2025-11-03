// Скрипт для обновления времени LA для всех существующих записей в основном листе
import { config } from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';

config();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const GOOGLE_SHEETS_DOC_ID = process.env.GOOGLE_SHEETS_DOC_ID;
const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const GOOGLE_SERVICE_PRIVATE_KEY = (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// Format LA time from payment
function formatLaTime(payment) {
  const createdDate = new Date(payment.created * 1000);
  const createdUTC = createdDate.toISOString();
  
  // Convert to LA time (America/Los_Angeles timezone)
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
  const year = laParts.find(p => p.type === 'year').value;
  const month = laParts.find(p => p.type === 'month').value;
  const day = laParts.find(p => p.type === 'day').value;
  const hours = laParts.find(p => p.type === 'hour').value;
  const minutes = laParts.find(p => p.type === 'minute').value;
  const seconds = laParts.find(p => p.type === 'second').value;
  
  // Format as YYYY-MM-DD HH:MM:SS.000 LA Time
  const createdLATime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}.000 LA Time`;
  
  return {
    'Created Local (LA Time)': createdLATime,
    'Created UTC': createdUTC
  };
}

async function updateMainSheetLaTime() {
  console.log('🔄 Начинаем обновление времени LA для основного листа...\n');

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
    console.log(`📋 Текущие заголовки: ${sheet.headerValues.join(', ')}\n`);

    // Проверяем, есть ли колонка LA Time
    let hasLaTimeColumn = sheet.headerValues.includes('Created Local (LA Time)');
    
    if (!hasLaTimeColumn) {
      console.log('⚠️ Колонка "Created Local (LA Time)" не найдена!');
      console.log('   Добавляем колонку в таблицу...\n');
      
      // Добавляем новую колонку в заголовки
      const currentHeaders = sheet.headerValues;
      // Находим индекс колонки "Created Local (UTC+1)" и добавляем LA Time после неё
      const utcPlus1Index = currentHeaders.indexOf('Created Local (UTC+1)');
      if (utcPlus1Index >= 0) {
        // Добавляем после UTC+1
        currentHeaders.splice(utcPlus1Index + 1, 0, 'Created Local (LA Time)');
      } else {
        // Или после Created UTC если UTC+1 нет
        const utcIndex = currentHeaders.indexOf('Created UTC');
        if (utcIndex >= 0) {
          currentHeaders.splice(utcIndex + 1, 0, 'Created Local (LA Time)');
        } else {
          // Добавляем в конец
          currentHeaders.push('Created Local (LA Time)');
        }
      }
      
      // Обновляем заголовки в Google Sheets
      await sheet.setHeaderRow(currentHeaders);
      await sheet.loadHeaderRow(); // Перезагружаем заголовки
      hasLaTimeColumn = true;
      console.log('✅ Колонка "Created Local (LA Time)" успешно добавлена!\n');
    }

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const paymentIntentIds = row.get('Payment Intent IDs') || '';
        const existingLATime = row.get('Created Local (LA Time)') || '';
        
        // Пропускаем, если LA время уже заполнено
        if (existingLATime && existingLATime !== '' && existingLATime !== 'N/A') {
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

        // Форматируем время по LA
        const timeData = formatLaTime(payment);

        // Обновляем только LA время (если колонка существует)
        if (hasLaTimeColumn) {
          await row.save({
            'Created Local (LA Time)': timeData['Created Local (LA Time)']
          });
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
    console.log(`   ⏭️ Пропущено: ${skipped} записей`);
    
    if (!hasLaTimeColumn) {
      console.log(`\n⚠️ ВАЖНО: Колонка "Created Local (LA Time)" не найдена в таблице!`);
      console.log(`   Добавьте эту колонку вручную в Google Sheets, или она создастся автоматически при следующей покупке.`);
    }

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error);
    process.exit(1);
  }
}

updateMainSheetLaTime();

