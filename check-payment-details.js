import Stripe from 'stripe';
import { config } from 'dotenv';

config();

const ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY
};

async function checkPaymentDetails() {
  try {
    console.log('🔍 ПРОВЕРКА ДЕТАЛЕЙ ПЛАТЕЖЕЙ');
    console.log('==============================');
    
    const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
    
    // Получаем последние 10 платежей
    const payments = await stripe.paymentIntents.list({ limit: 10 });
    
    for (const payment of payments.data) {
      if (payment.status !== 'succeeded') continue;
      
      console.log(`\n💳 Payment Intent: ${payment.id}`);
      console.log(`   Amount: $${(payment.amount / 100).toFixed(2)}`);
      console.log(`   Description: ${payment.description || 'No description'}`);
      
      // Проверяем charges
      if (payment.charges?.data?.length > 0) {
        const charge = payment.charges.data[0];
        console.log(`   Charge Description: ${charge.description || 'No charge description'}`);
        console.log(`   Charge Statement Descriptor: ${charge.statement_descriptor || 'No statement descriptor'}`);
      }
      
      // Проверяем subscription
      if (payment.invoice) {
        try {
          const invoice = await stripe.invoices.retrieve(payment.invoice);
          console.log(`   Invoice Description: ${invoice.description || 'No invoice description'}`);
          
          if (invoice.lines?.data?.length > 0) {
            const line = invoice.lines.data[0];
            console.log(`   Line Description: ${line.description || 'No line description'}`);
          }
        } catch (error) {
          console.log(`   Invoice error: ${error.message}`);
        }
      }
      
      // Проверяем subscription напрямую
      if (payment.metadata?.subscription_id) {
        try {
          const subscription = await stripe.subscriptions.retrieve(payment.metadata.subscription_id);
          console.log(`   Subscription Status: ${subscription.status}`);
          console.log(`   Subscription Description: ${subscription.description || 'No subscription description'}`);
        } catch (error) {
          console.log(`   Subscription error: ${error.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkPaymentDetails();
