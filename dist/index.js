import express from 'express';
import pino from 'pino';
import webhookRouter from './api/stripe-webhook.js';
import createCheckoutRouter from './api/create-checkout.js';
import sendLastPaymentRouter from './api/send-last-payment.js';
import syncPaymentsRouter from './api/sync-payments-endpoint.js';
import { ENV } from './lib/env.js';
const app = express();
const logger = pino({ level: 'info' });
app.get('/health', (_req, res) => res.status(200).send('ok'));
// Success page
app.get('/success', (_req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Покупка успешна!</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .success { color: green; font-size: 24px; }
        .info { color: #666; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="success">✅ Покупка успешна!</div>
      <div class="info">
        <p>Проверьте уведомления в Telegram и Slack</p>
        <p>Данные сохранены в Google Sheets</p>
      </div>
    </body>
    </html>
  `);
});
// Cancel page
app.get('/cancel', (_req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Покупка отменена</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .cancel { color: red; font-size: 24px; }
      </style>
    </head>
    <body>
      <div class="cancel">❌ Покупка отменена</div>
    </body>
    </html>
  `);
});
// Test API page
app.get('/test', (_req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test API - Send Last Payment</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
                text-align: center;
            }
            .button {
                background: #007bff;
                color: white;
                padding: 15px 30px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
                width: 100%;
                margin: 20px 0;
            }
            .button:hover {
                background: #0056b3;
            }
            .button:disabled {
                background: #ccc;
                cursor: not-allowed;
            }
            .button.sync {
                background: #28a745;
            }
            .button.sync:hover {
                background: #218838;
            }
            .result {
                margin-top: 20px;
                padding: 15px;
                border-radius: 5px;
                white-space: pre-wrap;
            }
            .success {
                background: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
            }
            .error {
                background: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Test API - Payment Operations</h1>
            
            <p><strong>🔄 Полная синхронизация с Google Sheets:</strong></p>
            <button id="syncButton" class="button sync" onclick="syncPayments()">
                📊 Синхронизировать все покупки
            </button>
            
            <hr style="margin: 30px 0;">
            
            <p><strong>📱 Отправить уведомление о последней покупке:</strong></p>
            <button id="sendButton" class="button" onclick="sendLastPayment()">
                📱 Отправить последнюю покупку
            </button>
            
            <div id="result"></div>
        </div>

        <script>
            async function syncPayments() {
                const button = document.getElementById('syncButton');
                const result = document.getElementById('result');
                
                button.disabled = true;
                button.textContent = '⏳ Синхронизация...';
                result.innerHTML = '';
                
                try {
                    const response = await fetch('/api/sync-payments', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        result.className = 'result success';
                        let paymentsHtml = '';
                        if (data.payments && data.payments.length > 0) {
                            paymentsHtml = '\\n\\n📋 Обработанные покупки:\\n' + 
                                data.payments.map(p => 
                                    \`- \${p.session_id}: \${p.email} (\${p.amount} USD)\`
                                ).join('\\n');
                        }
                        result.innerHTML = \`✅ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА!
                        
📊 Всего сессий: \${data.total_sessions}
✨ Обработано: \${data.processed}\${paymentsHtml}

🎉 Проверьте Google Sheets!\`;
                    } else {
                        result.className = 'result error';
                        result.innerHTML = \`❌ ОШИБКА: \${data.message}\\n\${data.error || ''}\`;
                    }
                } catch (error) {
                    result.className = 'result error';
                    result.innerHTML = \`❌ ОШИБКА СЕТИ: \${error.message}\`;
                } finally {
                    button.disabled = false;
                    button.textContent = '📊 Синхронизировать все покупки';
                }
            }
        
            async function sendLastPayment() {
                const button = document.getElementById('sendButton');
                const result = document.getElementById('result');
                
                button.disabled = true;
                button.textContent = '⏳ Отправляем...';
                result.innerHTML = '';
                
                try {
                    const response = await fetch('/api/send-last-payment', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        result.className = 'result success';
                        result.innerHTML = \`✅ УСПЕШНО ОТПРАВЛЕНО!
                        
📱 Telegram: \${data.telegram ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}
💬 Slack: \${data.slack ? 'ОТПРАВЛЕНО' : 'НЕ ОТПРАВЛЕНО'}

💳 Платеж: \${data.payment_id}
📧 Email: \${data.customer_email}

🎉 Проверьте ваши каналы!\`;
                    } else {
                        result.className = 'result error';
                        result.innerHTML = \`❌ ОШИБКА: \${data.message}\`;
                    }
                } catch (error) {
                    result.className = 'result error';
                    result.innerHTML = \`❌ ОШИБКА СЕТИ: \${error.message}\`;
                } finally {
                    button.disabled = false;
                    button.textContent = '📱 Отправить последнюю покупку';
                }
            }
        </script>
    </body>
    </html>
  `);
});
app.use(express.json());
app.use(webhookRouter);
app.use('/api', createCheckoutRouter);
app.use('/api', sendLastPaymentRouter);
app.use('/api', syncPaymentsRouter);
app.listen(ENV.PORT, () => {
    logger.info(`Server listening on port ${ENV.PORT}`);
    
    // Запускаем автоматическую синхронизацию каждые 5 минут
    logger.info('🔄 Starting automatic sync every 5 minutes...');
    
    // Первый запуск через 30 секунд после старта
    setTimeout(async () => {
        try {
            logger.info('🚀 Running initial sync...');
            const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            logger.info({ result }, 'Initial sync completed');
        }
        catch (error) {
            logger.error({ error }, 'Initial sync failed');
        }
    }, 30000);
    
    // Затем каждые 5 минут
    setInterval(async () => {
        try {
            logger.info('🔄 Running scheduled sync...');
            const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            logger.info({ result }, 'Scheduled sync completed');
        }
        catch (error) {
            logger.error({ error }, 'Scheduled sync failed');
        }
    }, 5 * 60 * 1000); // 5 минут
});
