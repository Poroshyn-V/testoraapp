import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_key');

async function testStripeAPI() {
  try {
    console.log('🔍 Проверяем последние checkout сессии...\n');
    
    const sessions = await stripe.checkout.sessions.list({
      limit: 5,
      status: 'complete'
    });
    
    console.log(`✅ Найдено ${sessions.data.length} завершенных сессий:\n`);
    
    for (const session of sessions.data) {
      console.log('-------------------');
      console.log(`🆔 Session ID: ${session.id}`);
      console.log(`💰 Amount: ${((session.amount_total ?? 0) / 100).toFixed(2)} ${(session.currency || 'usd').toUpperCase()}`);
      console.log(`📧 Email: ${session.customer_details?.email || 'N/A'}`);
      console.log(`📅 Created: ${new Date(session.created * 1000).toLocaleString()}`);
      console.log(`🎯 Status: ${session.status}`);
      
      // Проверяем metadata
      if (session.metadata && Object.keys(session.metadata).length > 0) {
        console.log(`📋 Session Metadata: ${Object.keys(session.metadata).join(', ')}`);
      }
      
      // Проверяем customer metadata
      if (session.customer) {
        try {
          const customer = await stripe.customers.retrieve(session.customer);
          if (customer && !customer.deleted && customer.metadata && Object.keys(customer.metadata).length > 0) {
            console.log(`👤 Customer Metadata: ${Object.keys(customer.metadata).join(', ')}`);
          }
        } catch (err) {
          console.log(`⚠️  Не удалось получить данные клиента`);
        }
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

testStripeAPI();
