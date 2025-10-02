import express from 'express';
import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { ENV } from '../lib/env.js';
import { sendTelegram } from '../lib/telegram.js';
import { formatTelegram } from '../lib/format.js';
import { sendSlack, formatSlack } from '../lib/slack.js';

const router = express.Router();
const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Endpoint для запуска полной синхронизации с группировкой покупок
router.post('/sync-payments', async (req, res) => {
  try {
    console.log('🔄 Starting payment sync with grouping...');
    
    // Получаем PAYMENT INTENTS за последние 7 дней (чтобы не пропустить)
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    const payments = await stripe.paymentIntents.list({
      limit: 100,
      created: {
        gte: sevenDaysAgo
      }
    });
    
    if (payments.data.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No payments found',
        processed: 0 
      });
    }
    
    // Фильтруем только успешные платежи
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded' && p.customer);
    console.log(`📊 Found ${successfulPayments.length} successful payments`);
    
    // ГРУППИРУЕМ покупки по клиенту + дате (как в старом коде!)
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      const customer = await stripe.customers.retrieve(payment.customer as string);
      const customerId = customer?.id;
      const purchaseDate = new Date(payment.created * 1000);
      const dateKey = `${customerId}_${purchaseDate.toISOString().split('T')[0]}`;
      
      if (!groupedPurchases.has(dateKey)) {
        groupedPurchases.set(dateKey, {
          customer,
          payments: [],
          totalAmount: 0,
          firstPayment: payment
        });
      }
      
      const group = groupedPurchases.get(dateKey);
      group.payments.push(payment);
      group.totalAmount += payment.amount;
    }
    
    console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);
    
    // Инициализируем Google Sheets
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    // Используем первый лист (главный)
    let sheet = doc.sheetsByIndex[0];
    if (!sheet) {
      console.error('❌ No sheets found in document!');
      return res.status(500).json({ success: false, message: 'Sheet not found' });
    }
    console.log(`📄 Using sheet: "${sheet.title}"`);
    
    // Загружаем существующие строки
    const rows = await sheet.getRows();
    console.log(`📋 Existing rows in sheet: ${rows.length}`);
    
    let newPurchases = 0;
    const processedPurchases: any[] = [];
    
    // Обрабатываем каждую группированную покупку
    for (const [dateKey, group] of groupedPurchases) {
      try {
        const customer = group.customer as any;
        const firstPayment = group.firstPayment;
        
        // Генерируем Purchase ID (как в старом коде!)
        const purchaseId = `purchase_${customer?.id}_${dateKey.split('_')[1]}`;
        
        // Проверяем существует ли уже эта покупка
        const exists = rows.some((row: any) => row.get('Purchase ID') === purchaseId);
        
        if (exists) {
          console.log(`⏭️  Purchase already exists: ${purchaseId}`);
          continue;
        }
        
        // Формируем GEO данные
        let geoData = 'N/A';
        if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
          geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
        } else if (customer?.metadata?.geo_country) {
          geoData = customer.metadata.geo_country;
        }
        
        const utcTime = new Date(firstPayment.created * 1000).toISOString();
        const localTime = new Date(firstPayment.created * 1000 + 3600000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ' UTC+1');
        
        // Добавляем новую строку
        await sheet.addRow({
          'Purchase ID': purchaseId,
          'Total Amount': (group.totalAmount / 100).toFixed(2),
          'Currency': firstPayment.currency.toUpperCase(),
          'Status': 'succeeded',
          'Created UTC': utcTime,
          'Created Local (UTC+1)': localTime,
          'Customer ID': customer?.id || 'N/A',
          'Customer Email': customer?.email || 'N/A',
          'GEO': geoData,
          'UTM Source': customer?.metadata?.utm_source || 'N/A',
          'UTM Medium': customer?.metadata?.utm_medium || 'N/A',
          'UTM Campaign': customer?.metadata?.utm_campaign || 'N/A',
          'UTM Content': customer?.metadata?.utm_content || 'N/A',
          'UTM Term': customer?.metadata?.utm_term || 'N/A',
          'Ad Name': customer?.metadata?.ad_name || 'N/A',
          'Adset Name': customer?.metadata?.adset_name || 'N/A',
          'Payment Count': group.payments.length
        });
        
        console.log(`✅ Added to Google Sheets: ${purchaseId}`);
        
        // Отправляем уведомления ТОЛЬКО для новых покупок
        try {
          // Конвертируем в формат для уведомлений
          const sessionLike: any = {
            id: purchaseId,
            amount_total: group.totalAmount,
            currency: firstPayment.currency,
            created: firstPayment.created,
            customer: customer?.id,
            customer_details: {
              email: customer?.email,
              address: null
            },
            customer_email: customer?.email,
            payment_method_types: ['card'],
            payment_status: 'succeeded',
            status: 'succeeded',
            metadata: {
              ...customer?.metadata,
              payment_count: `${group.payments.length} payment${group.payments.length > 1 ? 's' : ''}`
            },
            mode: 'payment',
            client_reference_id: null
          };
          
          const text = formatTelegram(sessionLike, customer?.metadata || {});
          await sendTelegram(text);
          console.log('📱 Telegram notification sent');
        } catch (error: any) {
          console.error('Error sending Telegram:', error.message);
        }
        
        try {
          const sessionLike: any = {
            id: purchaseId,
            amount_total: group.totalAmount,
            currency: firstPayment.currency,
            customer_details: { email: customer?.email },
            customer_email: customer?.email,
            metadata: customer?.metadata
          };
          
          const slackText = formatSlack(sessionLike, customer?.metadata || {});
          await sendSlack(slackText);
          console.log('💬 Slack notification sent');
        } catch (error: any) {
          console.error('Error sending Slack:', error.message);
        }
        
        newPurchases++;
        processedPurchases.push({
          purchase_id: purchaseId,
          email: customer?.email || 'N/A',
          amount: (group.totalAmount / 100).toFixed(2),
          payments_count: group.payments.length
        });
        
      } catch (error: any) {
        console.error(`Error processing purchase ${dateKey}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      message: `Sync completed! Processed ${newPurchases} purchase(s)`,
      total_groups: groupedPurchases.size,
      processed: newPurchases,
      purchases: processedPurchases
    });
    
  } catch (error: any) {
    console.error('❌ Sync error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Sync failed',
      error: error.message
    });
  }
});

export default router;
