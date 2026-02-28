import { config } from 'dotenv';
import { resolve } from 'path';
import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';

config({ path: resolve(process.cwd(), '.env') });

const { ENV } = await import('./src/config/env.js');
const STRIPE_KEY = ENV.STRIPE_SECRET_KEY_LOW_PRICE;
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-12-18.acacia' });

const customerId = 'cus_TS5ecvabmwLQNU'; // parkyuka0829@gmail.com

async function fix() {
  console.log(`🔧 Исправление суммы для parkyuka0829@gmail.com (добавление апселла)\n`);

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

  const row = rows.find(r => r.get('Customer ID') === customerId);
  if (!row) {
    console.log('❌ Клиент не найден в таблице');
    return;
  }

  const currentAmount = parseFloat(row.get('Total Amount') || 0);
  const paymentIds = (row.get('Payment Intent IDs') || '').split(',').map(id => id.trim()).filter(Boolean);

  console.log(`Текущая сумма в таблице: $${currentAmount.toFixed(2)}`);
  console.log(`Payment IDs в таблице: ${paymentIds.join(', ')}\n`);

  // Получаем все платежи клиента
  const payments = await stripe.paymentIntents.list({
    customer: customerId,
    limit: 100
  });

  // Фильтруем правильно (включая апселлы, исключая $0.6)
  const validPayments = payments.data.filter(p => {
    if (p.status !== 'succeeded' || !p.customer) return false;
    if (p.amount === 60) return false; // $0.6
    // ВКЛЮЧАЕМ subscription update - это апселлы!
    return true;
  });

  const correctTotal = validPayments.reduce((sum, p) => sum + p.amount, 0) / 100;
  const validIds = validPayments.map(p => p.id).sort();

  console.log(`Платежи в Stripe:`);
  validPayments.forEach(p => {
    console.log(`   💳 ${p.id} - $${(p.amount/100).toFixed(2)} - ${p.description || 'N/A'}`);
  });

  console.log(`\n💰 Результат:`);
  console.log(`   Было: $${currentAmount.toFixed(2)}`);
  console.log(`   Станет: $${correctTotal.toFixed(2)}`);
  console.log(`   Платежей: ${validPayments.length}`);
  console.log(`   Payment IDs: ${validIds.join(', ')}\n`);

  if (Math.abs(currentAmount - correctTotal) > 0.01) {
    // Сортируем платежи для получения первого и последнего
    validPayments.sort((a, b) => a.created - b.created);
    const firstPayment = validPayments[0];
    const latestPayment = validPayments[validPayments.length - 1];
    
    const firstDate = new Date(firstPayment.created * 1000).toISOString();
    const latestDate = new Date(latestPayment.created * 1000).toISOString();
    
    await row.save({
      'Total Amount': correctTotal.toFixed(2),
      'Payment Count': validPayments.length.toString(),
      'Payment Intent IDs': validIds.join(', '),
      'Created UTC': firstDate,
      'Created Local (LA Time)': new Date(firstPayment.created * 1000).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(',', '').replace(/\//g, '-') + '.000 LA Time'
    });
    console.log('✅ Исправлено! Апселл добавлен.');
  } else {
    console.log('✅ Сумма уже правильная');
  }
}

fix().catch(console.error);


