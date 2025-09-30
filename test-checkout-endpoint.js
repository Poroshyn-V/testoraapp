import express from 'express';
import Stripe from 'stripe';

const app = express();
app.use(express.json());

const stripe = new Stripe('sk_test_51S95aiLGc4AZl8D4LBucx6SeyHpr5atnp44MOqd9EOhsmh8faSY0ydSCIP8q1eRo5jvmkJsLPNJrqvRRSpPCxEnu00p48AJ5Er');

app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Тестовый продукт',
          },
          unit_amount: 100, // $1.00
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://stripe-ops.onrender.com/success',
      cancel_url: 'https://stripe-ops.onrender.com/cancel',
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Ошибка создания сессии:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/success', (req, res) => {
  res.send('✅ Покупка успешна! Проверьте уведомления в Telegram и Slack!');
});

app.get('/cancel', (req, res) => {
  res.send('❌ Покупка отменена');
});

app.listen(3001, () => {
  console.log('🧪 Тестовый сервер запущен на порту 3001');
  console.log('📱 Откройте create-test-payment.html в браузере');
});
