import express from 'express';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import pino from 'pino';
import { ENV } from '../lib/env.js';
import { sendTelegram } from '../lib/telegram.js';
import { formatTelegram } from '../lib/format.js';
import { appendPaymentRow } from '../lib/sheets.js';
import { sendSlack, formatSlack } from '../lib/slack.js';
import { wasHandled, markHandled } from '../lib/store.js';
const logger = pino({ level: 'info' });
const router = express.Router();
const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
// raw body is required for signature verification
router.post('/webhook/stripe', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
        const sig = req.headers['stripe-signature'];
        event = stripe.webhooks.constructEvent(req.body, sig, ENV.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        logger.error({ err }, 'Stripe signature verification failed');
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            if (wasHandled(session.id)) {
                return res.json({ ok: true, dedup: true });
            }
            // Получаем metadata клиента если есть
            let customerMetadata = {};
            if (session.customer) {
                try {
                    const customer = await stripe.customers.retrieve(session.customer);
                    if (customer && !('deleted' in customer)) {
                        customerMetadata = customer.metadata || {};
                    }
                }
                catch (err) {
                    logger.warn({ err }, 'Failed to retrieve customer metadata');
                }
            }
            const text = formatTelegram(session, customerMetadata);
            await sendTelegram(text);
            // Send Slack notification
            const slackText = formatSlack(session, customerMetadata);
            await sendSlack(slackText);
            await appendPaymentRow(session);
            markHandled(session.id);
            return res.json({ ok: true });
        }
        res.json({ ok: true, ignored: event.type });
    }
    catch (e) {
        logger.error({ e }, 'Webhook handler error');
        res.status(500).send('Server error');
    }
});
export default router;
