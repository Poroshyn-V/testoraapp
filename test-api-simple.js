// Простой тест API
const testApi = async () => {
  try {
    console.log('🧪 Тестируем API...');
    
    const response = await fetch('https://stripe-ops.onrender.com/api/send-last-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    console.log('📊 Статус:', response.status);
    console.log('📋 Ответ:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log('✅ API работает!');
      console.log(`📱 Telegram: ${data.telegram ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
      console.log(`💬 Slack: ${data.slack ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}`);
      console.log(`💳 Платеж: ${data.payment_id}`);
      console.log(`📧 Email: ${data.customer_email}`);
    } else {
      console.log('❌ API не работает:', data.message);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
};

testApi();
