import { config } from 'dotenv';
import { resolve } from 'path';
import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';

config({ path: resolve(process.cwd(), '.env') });

const { ENV } = await import('./src/config/env.js');
const STRIPE_KEY = ENV.STRIPE_SECRET_KEY_LOW_PRICE;
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-12-18.acacia' });

async function checkTable() {
  console.log(`🔍 Проверка таблицы LowPrice\n`);

  const { JWT } = await import('google-auth-library');
  const auth = new JWT({
    email: ENV.GOOGLE_SERVICE_EMAIL,
    key: ENV.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, auth);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle['LowPrice'];
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();

  // Получаем сегодняшнюю дату в UTC
  const today = new Date();
  const todayUTC = today.toISOString().split('T')[0]; // YYYY-MM-DD
  console.log(`📅 Ищем покупки за сегодня: ${todayUTC}\n`);

  let checkedCount = 0;
  let needsFixCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const customerId = row.get('Customer ID');
    const createdUTC = row.get('Created UTC');
    
    if (!customerId || !createdUTC) continue;
    
    // Проверяем, что покупка за сегодня
    const rowDate = createdUTC.split('T')[0];
    if (rowDate !== todayUTC) continue;
    
    checkedCount++;
    const email = row.get('Email') || customerId;
    const currentAmount = parseFloat(row.get('Total Amount') || 0);
    const paymentIds = (row.get('Payment Intent IDs') || '').split(',').map(id => id.trim()).filter(Boolean);

    try {
      // Получаем все платежи клиента из Stripe
      const payments = await stripe.paymentIntents.list({
        customer: customerId,
        limit: 100
      });

      // Фильтруем правильно (включая апселлы, исключая $0.6)
      const validPayments = payments.data.filter(p => {
        if (p.status !== 'succeeded' || !p.customer) return false;
        if (p.amount === 60) return false; // $0.6
        return true;
      });

      const correctTotal = validPayments.reduce((sum, p) => sum + p.amount, 0) / 100;
      const validIds = validPayments.map(p => p.id).sort();

      // Проверяем, нужно ли обновлять
      const needsUpdate = 
        Math.abs(currentAmount - correctTotal) > 0.01 || 
        validIds.length !== paymentIds.length ||
        validIds.some(id => !paymentIds.includes(id));

      if (needsUpdate) {
        needsFixCount++;
        console.log(`\n❌ ${email} (${customerId}):`);
        console.log(`   В таблице: $${currentAmount.toFixed(2)} (${paymentIds.length} платежей)`);
        console.log(`   Должно быть: $${correctTotal.toFixed(2)} (${validPayments.length} платежей)`);
        console.log(`   Payment IDs в таблице: ${paymentIds.join(', ')}`);
        console.log(`   Payment IDs должны быть: ${validIds.join(', ')}`);
        
        // Показываем какие платежи есть в Stripe
        validPayments.forEach(p => {
          const desc = p.description || 'N/A';
          const isUpsell = desc.toLowerCase().includes('subscription update');
          console.log(`      💳 ${p.id} - $${(p.amount/100).toFixed(2)} ${isUpsell ? '(АПСЕЛЛ)' : ''}`);
        });
      }
    } catch (error) {
      console.log(`\n❌ Ошибка для ${email}: ${error.message}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Итого:`);
  console.log(`   Проверено покупок за сегодня: ${checkedCount}`);
  console.log(`   Нужно исправить: ${needsFixCount}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

checkTable().catch(console.error);


