import express from 'express';
import Stripe from 'stripe';
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
    
    // Получаем PAYMENT INTENTS за последние 24 часа
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    
    const payments = await stripe.paymentIntents.list({
      limit: 100,
      created: {
        gte: oneDayAgo
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
    
    let newPurchases = 0;
    const processedPurchases: any[] = [];
    
    // Обрабатываем каждую группированную покупку
    for (const [dateKey, group] of groupedPurchases) {
      try {
        const customer = group.customer as any;
        const firstPayment = group.firstPayment;
        
        // Генерируем Purchase ID (как в старом коде!)
        const purchaseId = `purchase_${customer?.id}_${dateKey.split('_')[1]}`;
        
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
        
        // Проверяем существует ли уже эта покупка в Google Sheets
        const sheetsCheckUrl = `https://sheets.googleapis.com/v4/spreadsheets/${ENV.GOOGLE_SHEETS_DOC_ID}/values/A:Q`;
        
        const tokenResponse = await fetch(
          'https://oauth2.googleapis.com/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_email: ENV.GOOGLE_SERVICE_EMAIL,
              private_key: ENV.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n'),
              scopes: ['https://www.googleapis.com/auth/spreadsheets'],
              grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer'
            })
          }
        );
        
        if (!tokenResponse.ok) {
          console.error('❌ Error getting token');
          continue;
        }
        
        const tokenData: any = await tokenResponse.json();
        
        const checkResponse = await fetch(sheetsCheckUrl, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`
          }
        });
        
        let exists = false;
        if (checkResponse.ok) {
          const existingData: any = await checkResponse.json();
          const rows = existingData.values || [];
          
          // Проверяем существует ли purchaseId
          for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === purchaseId) {
              exists = true;
              break;
            }
          }
        }
        
        if (exists) {
          console.log(`⏭️  Purchase already exists: ${purchaseId}`);
          continue;
        }
        
        // Добавляем новую покупку в Google Sheets
        const row = [
          purchaseId,
          (group.totalAmount / 100).toFixed(2),
          firstPayment.currency.toUpperCase(),
          'succeeded',
          utcTime,
          localTime,
          customer?.id || 'N/A',
          customer?.email || 'N/A',
          geoData,
          customer?.metadata?.utm_source || 'N/A',
          customer?.metadata?.utm_medium || 'N/A',
          customer?.metadata?.utm_campaign || 'N/A',
          customer?.metadata?.utm_content || 'N/A',
          customer?.metadata?.utm_term || 'N/A',
          customer?.metadata?.ad_name || 'N/A',
          customer?.metadata?.adset_name || 'N/A',
          group.payments.length
        ];
        
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${ENV.GOOGLE_SHEETS_DOC_ID}/values/A:Q:append?valueInputOption=RAW`;
        
        const appendResponse = await fetch(appendUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [row]
          })
        });
        
        if (appendResponse.ok) {
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
        } else {
          console.error(`❌ Failed to add to Sheets: ${purchaseId}`);
        }
        
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
