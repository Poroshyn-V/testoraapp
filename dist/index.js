import express from 'express';
import pino from 'pino';
import webhookRouter from './api/stripe-webhook.js';
import { ENV } from './lib/env.js';
const app = express();
const logger = pino({ level: 'info' });
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.use(webhookRouter);
app.listen(ENV.PORT, () => {
    logger.info(`Server listening on port ${ENV.PORT}`);
});
