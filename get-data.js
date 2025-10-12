import Stripe from 'stripe';
import { config } from 'dotenv';

config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function getData() {
  try {
    console.log('📊 ПОЛУЧЕНИЕ ДАННЫХ ИЗ STRIPE');
    
    const paymentIds = [
      'pi_3SHHDYLGc4AZl8D42Ybk1vHK', // silentrocktree@gmail.com
      'pi_3SHHCVLGc4AZl8D40vrnsYo5'  // emond68@gmail.com
    ];
    
    for (const paymentId of paymentIds) {
      console.log(`\n🔍 Payment ID: ${paymentId}`);
      
      const payment = await stripe.paymentIntents.retrieve(paymentId);
      console.log(`   Amount: $${(payment.amount / 100).toFixed(2)} USD`);
      console.log(`   Status: ${payment.status}`);
      console.log(`   Description: ${payment.description}`);
      
      if (payment.customer) {
        const customer = await stripe.customers.retrieve(payment.customer);
        console.log(`   Email: ${customer.email}`);
        console.log(`   Country: ${customer.address?.country || 'N/A'}`);
        console.log(`   City: ${customer.address?.city || 'N/A'}`);
        
        // Проверяем metadata
        if (customer.metadata) {
          console.log(`   Metadata:`);
          Object.entries(customer.metadata).forEach(([key, value]) => {
            if (key.includes('geo') || key.includes('country') || key.includes('city')) {
              console.log(`     ${key}: ${value}`);
            }
          });
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

getData();
