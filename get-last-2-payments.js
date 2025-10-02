import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function getLast2Payments() {
  try {
    console.log('🔍 ПОЛУЧАЮ ПОСЛЕДНИЕ 2 ПОКУПКИ ИЗ STRIPE...');
    
    // Получаем последние платежи
    const payments = await stripe.paymentIntents.list({
      limit: 2,
      created: {
        gte: Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60) // последние 7 дней
      }
    });
    
    console.log(`✅ Найдено ${payments.data.length} платежей`);
    
    for (let i = 0; i < payments.data.length; i++) {
      const payment = payments.data[i];
      const customer = payment.customer ? await stripe.customers.retrieve(payment.customer) : null;
      const date = new Date(payment.created * 1000);
      const dateKey = `${payment.customer}_${date.toISOString().split('T')[0]}`;
      const purchaseId = `purchase_${payment.customer}_${date.toISOString().split('T')[0]}`;
      
      console.log(`\n📄 ПЛАТЕЖ ${i + 1}:`);
      console.log(`  ID: ${payment.id}`);
      console.log(`  Customer: ${payment.customer}`);
      console.log(`  Amount: ${(payment.amount / 100).toFixed(2)} ${payment.currency}`);
      console.log(`  Status: ${payment.status}`);
      console.log(`  Date: ${date.toISOString()}`);
      console.log(`  Date Key: ${dateKey}`);
      console.log(`  Purchase ID: ${purchaseId}`);
      console.log(`  Email: ${customer?.email || 'N/A'}`);
      console.log(`  GEO: ${customer?.metadata?.geo_country || 'N/A'}, ${customer?.metadata?.geo_city || 'N/A'}`);
      console.log(`  UTM Source: ${customer?.metadata?.utm_source || 'N/A'}`);
      console.log(`  UTM Medium: ${customer?.metadata?.utm_medium || 'N/A'}`);
      console.log(`  UTM Campaign: ${customer?.metadata?.utm_campaign || 'N/A'}`);
      console.log(`  Ad Name: ${customer?.metadata?.ad_name || 'N/A'}`);
      console.log(`  Adset Name: ${customer?.metadata?.adset_name || 'N/A'}`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

getLast2Payments();
