import express from 'express';
import Stripe from 'stripe';
import { ENV } from '../lib/env.js';
import { appendPaymentRow } from '../lib/sheets.js';
import { sendTelegram } from '../lib/telegram.js';
import { formatTelegram } from '../lib/format.js';
import { sendSlack, formatSlack } from '../lib/slack.js';

const router = express.Router();
const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Endpoint для запуска полной синхронизации
router.post('/sync-payments', async (req, res) => {
  try {
    console.log('🔄 Starting payment sync...');
    
    // Получаем PAYMENT INTENTS (не checkout sessions!) за последние 24 часа
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
    const successfulPayments = payments.data.filter(p => p.status === 'succeeded');
    console.log(`📊 Found ${successfulPayments.length} successful payments`);
    
    let newPayments = 0;
    const processedPayments: any[] = [];
    
    // Обрабатываем каждый платеж
    for (const payment of successfulPayments) {
      try {
        // Конвертируем PaymentIntent в формат похожий на CheckoutSession
        const sessionLike: any = {
          id: payment.id,
          amount_total: payment.amount,
          currency: payment.currency,
          created: payment.created,
          customer: payment.customer,
          customer_details: {
            email: payment.receipt_email || null,
            address: null
          },
          customer_email: payment.receipt_email,
          payment_method_types: [payment.payment_method_types?.[0] || 'card'],
          payment_status: payment.status,
          status: payment.status,
          metadata: payment.metadata || {},
          mode: 'payment',
          client_reference_id: null
        };
        
        // Получаем metadata клиента если есть
        let customerMetadata: any = {};
        if (payment.customer) {
          try {
            const customer = await stripe.customers.retrieve(payment.customer as string);
            if (customer && !('deleted' in customer)) {
              customerMetadata = customer.metadata || {};
              // Если нет email в payment, берем из customer
              if (!sessionLike.customer_email && customer.email) {
                sessionLike.customer_email = customer.email;
                sessionLike.customer_details.email = customer.email;
              }
            }
          } catch (err) {
            console.error('Error loading customer:', err);
          }
        }
        
        // Пытаемся добавить в Google Sheets (с проверкой на дубликаты внутри)
        const wasAdded = await appendPaymentRow(sessionLike);
        
        // Отправляем уведомления ТОЛЬКО для новых платежей
        if (wasAdded) {
          try {
            const text = formatTelegram(sessionLike, customerMetadata);
            await sendTelegram(text);
            console.log('📱 Telegram notification sent for:', payment.id);
          } catch (error: any) {
            console.error('Error sending Telegram:', error.message);
          }
          
          try {
            const slackText = formatSlack(sessionLike, customerMetadata);
            await sendSlack(slackText);
            console.log('💬 Slack notification sent for:', payment.id);
          } catch (error: any) {
            console.error('Error sending Slack:', error.message);
          }
          
          newPayments++;
          processedPayments.push({
            session_id: payment.id,
            email: sessionLike.customer_email || 'N/A',
            amount: payment.amount / 100
          });
        } else {
          console.log('⏭️  Payment already exists, skipping notifications:', payment.id);
        }
        
      } catch (error: any) {
        console.error(`Error processing payment ${payment.id}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      message: `Sync completed! Processed ${newPayments} payment(s)`,
      total_sessions: successfulPayments.length,
      processed: newPayments,
      payments: processedPayments
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
