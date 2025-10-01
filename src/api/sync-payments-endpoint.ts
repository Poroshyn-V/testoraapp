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
    
    // Получаем сессии за последние 24 часа
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      created: {
        gte: oneDayAgo  // только за последние 24 часа
      }
    });
    
    if (sessions.data.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No completed sessions found',
        processed: 0 
      });
    }
    
    console.log(`📊 Found ${sessions.data.length} completed sessions`);
    
    let newPayments = 0;
    const processedPayments = [];
    
    // Обрабатываем каждую сессию
    for (const session of sessions.data) {
      try {
        // Получаем metadata клиента если есть
        let customerMetadata: any = {};
        if (session.customer) {
          try {
            const customer = await stripe.customers.retrieve(session.customer as string);
            if (customer && !('deleted' in customer)) {
              customerMetadata = customer.metadata || {};
            }
          } catch (err) {
            console.error('Error loading customer:', err);
          }
        }
        
        // Пытаемся добавить в Google Sheets (с проверкой на дубликаты внутри)
        await appendPaymentRow(session);
        
        // Отправляем уведомления только для новых платежей
        try {
          const text = formatTelegram(session, customerMetadata);
          await sendTelegram(text);
          console.log('📱 Telegram notification sent for:', session.id);
        } catch (error: any) {
          console.error('Error sending Telegram:', error.message);
        }
        
        try {
          const slackText = formatSlack(session);
          await sendSlack(slackText);
          console.log('💬 Slack notification sent for:', session.id);
        } catch (error: any) {
          console.error('Error sending Slack:', error.message);
        }
        
        newPayments++;
        processedPayments.push({
          session_id: session.id,
          email: session.customer_details?.email || 'N/A',
          amount: (session.amount_total ?? 0) / 100
        });
        
      } catch (error: any) {
        console.error(`Error processing session ${session.id}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      message: `Sync completed! Processed ${newPayments} payment(s)`,
      total_sessions: sessions.data.length,
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

