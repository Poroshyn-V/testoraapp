import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function exportAllPayments() {
  try {
    console.log('🔄 Экспорт всех платежей в Google Sheets...');
    
    // Получаем все платежи
    const payments = await stripe.paymentIntents.list({
      limit: 100
    });
    
    console.log(`📊 Найдено платежей: ${payments.data.length}`);
    
    // Подключаемся к Google Sheets
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_DOC_ID);
    
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    });
    
    await doc.loadInfo();
    console.log(`📄 Подключен к таблице: ${doc.title}`);
    
    // Получаем первый лист
    const sheet = doc.sheetsByIndex[0];
    
    // Очищаем лист
    await sheet.clear();
    
    // Заголовки
    const headers = [
      'Payment ID', 'Amount', 'Currency', 'Status', 'Created',
      'Customer ID', 'Customer Email',
      'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content',
      'Ad Name', 'Adset Name', 'Campaign Name',
      'Campaign ID', 'Ad ID', 'Adset ID', 'FBCLID'
    ];
    
    await sheet.addRow(headers);
    console.log('📝 Заголовки добавлены');
    
    // Добавляем каждый платеж
    for (const payment of payments.data) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const metadata = customer?.metadata || {};
      
      const row = [
        payment.id,
        `$${(payment.amount / 100).toFixed(2)}`,
        payment.currency.toUpperCase(),
        payment.status,
        new Date(payment.created * 1000).toLocaleString(),
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        metadata.utm_source || 'N/A',
        metadata.utm_medium || 'N/A',
        metadata.utm_campaign || 'N/A',
        metadata.utm_content || 'N/A',
        metadata.ad_name || 'N/A',
        metadata.adset_name || 'N/A',
        metadata.campaign_name || 'N/A',
        metadata.campaign_id || 'N/A',
        metadata.ad_id || 'N/A',
        metadata.adset_id || 'N/A',
        metadata.fbclid || 'N/A'
      ];
      
      await sheet.addRow(row);
      console.log(`✅ Добавлен: ${payment.id}`);
    }
    
    console.log(`🎉 ЭКСПОРТ ЗАВЕРШЕН! ${payments.data.length} платежей в Google Sheets`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

exportAllPayments();
