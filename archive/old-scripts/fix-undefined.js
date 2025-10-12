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

async function fixUndefined() {
  try {
    console.log('🔧 ИСПРАВЛЕНИЕ UNDEFINED ПОЛЕЙ');
    
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
    
    const targetEmails = ['silentrocktree@gmail.com', 'emond68@gmail.com'];
    
    for (const email of targetEmails) {
      const row = rows.find(r => r.get('Email') === email);
      if (!row) continue;
      
      console.log(`\n🔧 Исправляю: ${email}`);
      
      const paymentIds = row.get('Payment Intent IDs') || '';
      if (!paymentIds) continue;
      
      const paymentId = paymentIds.split(', ')[0];
      console.log(`   Payment ID: ${paymentId}`);
      
      const payment = await stripe.paymentIntents.retrieve(paymentId);
      console.log(`   Payment amount: ${payment.amount}, status: ${payment.status}`);
      
      if (payment && payment.status === 'succeeded') {
        let customer = null;
        if (payment.customer) {
          customer = await stripe.customers.retrieve(payment.customer);
          console.log(`   Customer: ${customer.email}`);
        }
        
        const m = { ...payment.metadata, ...(customer?.metadata || {}) };
        console.log(`   Metadata:`, m);
        
        const amount = `$${(payment.amount / 100).toFixed(2)} USD`;
        const geo = m.country && m.city ? `${m.country}, ${m.city}` : (m.geo || '');
        
        console.log(`   Setting Amount: ${amount}`);
        console.log(`   Setting GEO: ${geo}`);
        console.log(`   Setting Country: ${m.country || ''}`);
        console.log(`   Setting City: ${m.city || ''}`);
        
        // Принудительно устанавливаем значения
        row.set('Amount', amount);
        row.set('Status', payment.status);
        row.set('GEO', geo);
        row.set('Country', m.country || '');
        row.set('City', m.city || '');
        row.set('Description', payment.description || '');
        
        await row.save();
        console.log(`✅ Сохранено для: ${email}`);
      }
    }
    
    console.log('\n🎉 ГОТОВО!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

fixUndefined();
