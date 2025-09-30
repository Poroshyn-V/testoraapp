import Stripe from 'stripe';

const stripe = new Stripe('sk_test_51S95aiLGc4AZl8D4LBucx6SeyHpr5atnp44MOqd9EOhsmh8faSY0ydSCIP8q1eRo5jvmkJsLPNJrqvRRSpPCxEnu00p48AJ5Er');

async function getLast15Payments() {
  console.log('🔍 ПОЛУЧАЮ ПОСЛЕДНИЕ 15 ПОКУПОК ИЗ STRIPE...\n');

  try {
    // Получаем последние 15 платежей
    const payments = await stripe.paymentIntents.list({ 
      limit: 15,
      created: {
        gte: Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000) // Последние 30 дней
      }
    });

    console.log(`📊 Найдено платежей: ${payments.data.length}\n`);

    for (let i = 0; i < payments.data.length; i++) {
      const payment = payments.data[i];
      
      console.log(`💳 ПЛАТЕЖ ${i + 1}:`);
      console.log(`   ID: ${payment.id}`);
      console.log(`   Сумма: ${payment.amount / 100} ${payment.currency.toUpperCase()}`);
      console.log(`   Статус: ${payment.status}`);
      console.log(`   Дата: ${new Date(payment.created * 1000).toLocaleString()}`);
      console.log(`   Email: ${payment.receipt_email || 'N/A'}`);
      console.log(`   Metadata:`, payment.metadata);
      console.log(`   Description: ${payment.description || 'N/A'}`);
      console.log('---');
    }

    // Получаем соответствующие checkout sessions
    console.log('\n🛒 ПОИСК СООТВЕТСТВУЮЩИХ CHECKOUT SESSIONS...\n');
    
    const sessions = await stripe.checkout.sessions.list({ 
      limit: 20,
      created: {
        gte: Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)
      }
    });

    console.log(`📊 Найдено сессий: ${sessions.data.length}\n`);

    for (let i = 0; i < Math.min(15, sessions.data.length); i++) {
      const session = sessions.data[i];
      
      console.log(`🛒 СЕССИЯ ${i + 1}:`);
      console.log(`   ID: ${session.id}`);
      console.log(`   Сумма: ${(session.amount_total || 0) / 100} ${(session.currency || 'usd').toUpperCase()}`);
      console.log(`   Статус: ${session.status}`);
      console.log(`   Дата: ${new Date(session.created * 1000).toLocaleString()}`);
      console.log(`   Email: ${session.customer_details?.email || session.customer_email || 'N/A'}`);
      console.log(`   Страна: ${session.customer_details?.address?.country || 'N/A'}`);
      console.log(`   Metadata:`, session.metadata);
      console.log('---');
    }

    // Анализируем metadata
    console.log('\n🔍 АНАЛИЗ METADATA:');
    let hasUtmData = false;
    let hasOtherData = false;
    
    for (const session of sessions.data) {
      if (session.metadata && Object.keys(session.metadata).length > 0) {
        console.log(`\n📊 Сессия ${session.id}:`);
        for (const [key, value] of Object.entries(session.metadata)) {
          console.log(`   ${key}: ${value}`);
          if (key.toLowerCase().includes('utm') || key.toLowerCase().includes('campaign') || key.toLowerCase().includes('ad')) {
            hasUtmData = true;
          } else {
            hasOtherData = true;
          }
        }
      }
    }

    console.log('\n🎯 ВЫВОД:');
    if (hasUtmData) {
      console.log('✅ Найдены UTM метки в некоторых сессиях');
    } else {
      console.log('❌ UTM метки не найдены');
    }
    
    if (hasOtherData) {
      console.log('✅ Найдены другие metadata');
    } else {
      console.log('❌ Другие metadata не найдены');
    }

    // Показываем статистику
    console.log('\n📈 СТАТИСТИКА:');
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded');
    const totalAmount = successfulPayments.reduce((sum, p) => sum + p.amount, 0);
    const avgAmount = successfulPayments.length > 0 ? totalAmount / successfulPayments.length / 100 : 0;
    
    console.log(`💰 Общая сумма: $${(totalAmount / 100).toFixed(2)}`);
    console.log(`📊 Средняя сумма: $${avgAmount.toFixed(2)}`);
    console.log(`✅ Успешных платежей: ${successfulPayments.length}`);
    console.log(`📅 Период: последние 30 дней`);

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

getLast15Payments();
