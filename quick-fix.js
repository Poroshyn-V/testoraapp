import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

config();

const ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID
};

async function quickFix() {
  try {
    console.log('🔧 БЫСТРОЕ ИСПРАВЛЕНИЕ');
    
    const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📋 Всего записей: ${rows.length}`);
    
    // 1. Удаляем все записи с "Subscription update"
    console.log('\n🗑️ Удаляем "Subscription update"...');
    let deletedCount = 0;
    
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const description = row.get('Description') || '';
      
      if (description.toLowerCase().includes('subscription update')) {
        await row.delete();
        deletedCount++;
        console.log(`✅ Удален: ${row.get('Email')}`);
      }
    }
    
    console.log(`✅ Удалено "Subscription update": ${deletedCount}`);
    
    // 2. Исправляем конкретные email'ы
    console.log('\n🔧 Исправляем конкретные записи...');
    
    const targetEmails = ['silentrocktree@gmail.com', 'emond68@gmail.com'];
    const updatedRows = await sheet.getRows();
    
    for (const email of targetEmails) {
      const row = updatedRows.find(r => r.get('Email') === email);
      if (!row) continue;
      
      const paymentIds = row.get('Payment Intent IDs') || '';
      if (!paymentIds) continue;
      
      const paymentId = paymentIds.split(', ')[0];
      const payment = await stripe.paymentIntents.retrieve(paymentId);
      
      if (payment && payment.status === 'succeeded') {
        let customer = null;
        if (payment.customer) {
          customer = await stripe.customers.retrieve(payment.customer);
        }
        
        const m = { ...payment.metadata, ...(customer?.metadata || {}) };
        const amount = `$${(payment.amount / 100).toFixed(2)} USD`;
        const geo = m.country && m.city ? `${m.country}, ${m.city}` : (m.geo || '');
        
        row.set('Amount', amount);
        row.set('Status', payment.status);
        row.set('GEO', geo);
        row.set('Country', m.country || '');
        row.set('City', m.city || '');
        
        await row.save();
        console.log(`✅ Исправлен: ${email}`);
      }
    }
    
    console.log('\n🎉 ГОТОВО!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

quickFix();
