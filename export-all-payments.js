import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function exportAllPayments() {
  try {
    console.log('🔄 Получаю все платежи из Stripe...');
    
    // Получаем все платежи
    const payments = await stripe.paymentIntents.list({
      limit: 100,
      expand: ['data.customer']
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
    
    // Заголовки
    const headers = [
      'Payment ID',
      'Amount',
      'Currency',
      'Status',
      'Created',
      'Customer ID',
      'Customer Email',
      'UTM Source',
      'UTM Medium',
      'UTM Campaign',
      'UTM Content',
      'UTM Term',
      'Ad Name',
      'Adset Name',
      'Campaign Name',
      'Campaign ID',
      'Ad ID',
      'Adset ID',
      'FBCLID',
      'FBP',
      'FBC'
    ];
    
    // Очищаем лист и добавляем заголовки
    await sheet.clear();
    await sheet.addRow(headers);
    
    console.log('📝 Добавляю данные в Google Sheets...');
    
    // Добавляем каждую покупку
    for (const payment of payments.data) {
      const customer = payment.customer;
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
        metadata.utm_term || 'N/A',
        metadata.ad_name || 'N/A',
        metadata.adset_name || 'N/A',
        metadata.campaign_name || 'N/A',
        metadata.campaign_id || 'N/A',
        metadata.ad_id || 'N/A',
        metadata.adset_id || 'N/A',
        metadata.fbclid || 'N/A',
        metadata.fbp || 'N/A',
        metadata.fbc || 'N/A'
      ];
      
      await sheet.addRow(row);
      console.log(`✅ Добавлен платеж: ${payment.id}`);
    }
    
    console.log(`🎉 Успешно экспортировано ${payments.data.length} платежей в Google Sheets!`);
    console.log(`📊 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_DOC_ID}`);
    
  } catch (error) {
    console.error('❌ Ошибка экспорта:', error.message);
  }
}

exportAllPayments();
