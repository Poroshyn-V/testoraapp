import express from 'express';
import pino from 'pino';
import webhookRouter from './api/stripe-webhook.js';
import createCheckoutRouter from './api/create-checkout.js';
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

app.use(express.json());
app.use(webhookRouter);
app.use('/api', createCheckoutRouter);

app.listen(ENV.PORT, () => {
  logger.info(`Server listening on port ${ENV.PORT}`);
});
