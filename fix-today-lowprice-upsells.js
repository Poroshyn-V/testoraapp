import { config } from 'dotenv';
import { resolve } from 'path';
import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';

config({ path: resolve(process.cwd(), '.env') });

const { ENV } = await import('./src/config/env.js');
const STRIPE_KEY = ENV.STRIPE_SECRET_KEY_LOW_PRICE;
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-12-18.acacia' });

async function fixTodayPurchases() {
  console.log(`🔧 Исправление покупок за сегодня в листе LowPrice (добавление апселлов)\n`);

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

  let fixedCount = 0;
  let checkedCount = 0;

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

    console.log(`\n${checkedCount}. Проверяю: ${email}`);
    console.log(`   Customer ID: ${customerId}`);
    console.log(`   Текущая сумма: $${currentAmount.toFixed(2)}`);
    console.log(`   Payment IDs в таблице: ${paymentIds.length} шт`);

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
        // ВКЛЮЧАЕМ subscription update - это апселлы!
        return true;
      });

      // Сортируем по дате
      validPayments.sort((a, b) => a.created - b.created);

      const correctTotal = validPayments.reduce((sum, p) => sum + p.amount, 0) / 100;
      const validIds = validPayments.map(p => p.id).sort();

      console.log(`   Платежей в Stripe: ${validPayments.length}`);
      validPayments.forEach(p => {
        const desc = p.description || 'N/A';
        const isUpsell = desc.toLowerCase().includes('subscription update');
        console.log(`      💳 ${p.id} - $${(p.amount/100).toFixed(2)} ${isUpsell ? '(АПСЕЛЛ)' : ''} - ${desc}`);
      });

      // Проверяем, нужно ли обновлять
      const needsUpdate = 
        Math.abs(currentAmount - correctTotal) > 0.01 || 
        validIds.length !== paymentIds.length ||
        validIds.some(id => !paymentIds.includes(id));

      if (needsUpdate) {
        console.log(`   ⚠️  Нужно обновить!`);
        console.log(`      Было: $${currentAmount.toFixed(2)} (${paymentIds.length} платежей)`);
        console.log(`      Станет: $${correctTotal.toFixed(2)} (${validPayments.length} платежей)`);

        const firstPayment = validPayments[0];
        
        const firstDate = new Date(firstPayment.created * 1000).toISOString();
        const laTime = new Date(firstPayment.created * 1000).toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).replace(',', '').replace(/\//g, '-') + '.000 LA Time';

        // Обновляем поля напрямую через set()
        row.set('Total Amount', correctTotal.toFixed(2));
        row.set('Payment Count', validPayments.length.toString());
        row.set('Payment Intent IDs', validIds.join(', '));
        row.set('Created UTC', firstDate);
        row.set('Created Local (LA Time)', laTime);
        
        // Сохраняем изменения
        try {
          await row.save();
          console.log(`   ✅ Исправлено!`);
          fixedCount++;
        } catch (saveError) {
          console.log(`   ❌ Ошибка сохранения: ${saveError.message}`);
          // Пробуем альтернативный способ
          try {
            await row.save({
              'Total Amount': correctTotal.toFixed(2),
              'Payment Count': validPayments.length.toString(),
              'Payment Intent IDs': validIds.join(', '),
              'Created UTC': firstDate,
              'Created Local (LA Time)': laTime
            });
            console.log(`   ✅ Исправлено (альтернативный способ)!`);
            fixedCount++;
          } catch (saveError2) {
            console.log(`   ❌ Ошибка сохранения (альтернативный способ): ${saveError2.message}`);
          }
        }
      } else {
        console.log(`   ✅ Уже правильно (сумма и платежи совпадают)`);
      }
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Итого:`);
  console.log(`   Проверено покупок: ${checkedCount}`);
  console.log(`   Исправлено: ${fixedCount}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

fixTodayPurchases().catch(console.error);

