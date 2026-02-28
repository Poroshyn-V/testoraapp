import { config } from 'dotenv';
import { resolve } from 'path';
import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';

config({ path: resolve(process.cwd(), '.env') });

const { ENV } = await import('./src/config/env.js');
const STRIPE_KEY = ENV.STRIPE_SECRET_KEY_LOW_PRICE;
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-12-18.acacia' });

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

console.log(`🔍 Проверка всех записей в листе LowPrice\n`);
console.log(`📊 Всего строк: ${rows.length}\n`);

let checked = 0;
let fixed = 0;
let errors = 0;
const issues = [];

for (const row of rows) {
  const customerId = row.get('Customer ID');
  if (!customerId || customerId === 'N/A') {
    checked++;
    continue;
  }

  checked++;
  const email = row.get('Email') || customerId;
  const currentAmount = parseFloat(row.get('Total Amount') || 0);
  const paymentIds = (row.get('Payment Intent IDs') || '').split(',').map(id => id.trim()).filter(Boolean);

  if (paymentIds.length === 0) {
    issues.push({ email, issue: 'Нет Payment IDs' });
    continue;
  }

  // Проверяем каждый платеж
  let correctTotal = 0;
  const validIds = [];
  let has06 = false;

  for (const pid of paymentIds) {
    try {
      const payment = await stripe.paymentIntents.retrieve(pid);
      if (payment.amount === 60) {
        has06 = true;
      } else if (payment.status === 'succeeded' && payment.amount !== 60) {
        correctTotal += payment.amount;
        validIds.push(pid);
      }
    } catch (e) {
      errors++;
    }
  }

  const correctAmount = (correctTotal / 100).toFixed(2);
  const diff = Math.abs(currentAmount - parseFloat(correctAmount));

  if (has06 && diff > 0.01) {
    console.log(`\n🔧 ${email}:`);
    console.log(`   Было: $${currentAmount.toFixed(2)} (включая $0.6)`);
    console.log(`   Станет: $${correctAmount}`);
    
    try {
      await row.save({
        'Total Amount': correctAmount,
        'Payment Count': validIds.length.toString(),
        'Payment Intent IDs': validIds.join(', ')
      });
      fixed++;
      console.log(`   ✅ Исправлено`);
    } catch (e) {
      console.log(`   ❌ Ошибка: ${e.message}`);
      issues.push({ email, issue: `Ошибка исправления: ${e.message}` });
    }
    await new Promise(r => setTimeout(r, 500));
  } else if (diff > 0.01) {
    issues.push({ email, issue: `Сумма не совпадает: $${currentAmount.toFixed(2)} vs $${correctAmount}` });
  }

  if (checked % 10 === 0) {
    console.log(`   Проверено: ${checked}/${rows.length}...`);
  }
}

console.log(`\n\n📊 ИТОГО:`);
console.log(`   Проверено: ${checked}`);
console.log(`   Исправлено: ${fixed}`);
console.log(`   Ошибок: ${errors}`);
if (issues.length > 0) {
  console.log(`   Проблем: ${issues.length}`);
  issues.forEach(i => console.log(`      - ${i.email}: ${i.issue}`));
} else {
  console.log(`   ✅ Все суммы правильные!`);
}
