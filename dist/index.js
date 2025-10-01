import express from 'express';
import pino from 'pino';
import webhookRouter from './api/stripe-webhook.js';
import createCheckoutRouter from './api/create-checkout.js';
import sendLastPaymentRouter from './api/send-last-payment.js';
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
            <h1>🚀 Test API - Send Last Payment</h1>
            <p>Нажмите кнопку ниже, чтобы отправить последнюю покупку в Telegram и Slack:</p>
            
            <button id="sendButton" class="button" onclick="sendLastPayment()">
                📱 Отправить последнюю покупку
            </button>
            
            <div id="result"></div>
        </div>

        <script>
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
app.listen(ENV.PORT, () => {
    logger.info(`Server listening on port ${ENV.PORT}`);
});
