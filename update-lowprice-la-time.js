// Скрипт для обновления времени по LA для всех существующих записей в листе LowPrice
import { config } from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';

config();

const SECOND_STRIPE_KEY = process.env.STRIPE_SECRET_KEY_LOW_PRICE;
const LOW_PRICE_SHEET_NAME = process.env.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
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
  const createdLocal = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}.000 LA Time`;
  
  return {
    'Created Local (LA Time)': createdLocal,
    'Created UTC': createdUTC
  };
}

async function updateLowPriceLaTime() {
  console.log('🔄 Начинаем обновление времени по LA для листа LowPrice...\n');

  try {
    // Подключаемся к Stripe
    if (!SECOND_STRIPE_KEY) {
      throw new Error('STRIPE_SECRET_KEY_LOW_PRICE not configured');
    }
    const stripe = new Stripe(SECOND_STRIPE_KEY);

    // Подключаемся к Google Sheets
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_EMAIL,
      key: GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    const lowPriceSheet = doc.sheetsByTitle[LOW_PRICE_SHEET_NAME];
    if (!lowPriceSheet) {
      throw new Error(`Sheet "${LOW_PRICE_SHEET_NAME}" not found`);
    }

    await lowPriceSheet.loadHeaderRow();
    const rows = await lowPriceSheet.getRows();
    
    console.log(`📋 Найдено ${rows.length} записей в листе "${LOW_PRICE_SHEET_NAME}"\n`);

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const customerId = row.get('Customer ID');
        const paymentIntentIds = row.get('Payment Intent IDs') || '';
        
        if (!customerId || customerId === 'N/A' || !paymentIntentIds) {
          skipped++;
          continue;
        }

        // Получаем первый Payment Intent ID
        const firstPaymentId = paymentIntentIds.split(',')[0].trim();
        
        // Получаем данные платежа из Stripe
        const payment = await stripe.paymentIntents.retrieve(firstPaymentId);

        // Форматируем время по LA
        const timeData = formatLaTime(payment);

        // Обновляем только время
        await row.save(timeData);

        updated++;
        
        if (updated % 10 === 0) {
          console.log(`   ✅ Обновлено ${updated} записей...`);
        }

      } catch (error) {
        console.error(`   ❌ Ошибка при обновлении строки ${row.rowNumber}:`, error.message);
        skipped++;
      }
    }

    console.log(`\n✅ ГОТОВО!`);
    console.log(`   📊 Обновлено: ${updated} записей`);
    console.log(`   ⏭️ Пропущено: ${skipped} записей`);

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error);
    process.exit(1);
  }
}

updateLowPriceLaTime();

