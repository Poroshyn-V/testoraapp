import type { VercelRequest, VercelResponse } from '@vercel/node';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import pino from 'pino';
import { ENV } from '../src/lib/env.js';
import { sendTelegram } from '../src/lib/telegram.js';
import { formatTelegram } from '../src/lib/format.js';
import { appendPaymentRow } from '../src/lib/sheets.js';
import { wasHandled, markHandled } from '../src/lib/store.js';

const logger = pino({ level: 'info' });
const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let event: Stripe.Event;
  try {
    const sig = req.headers['stripe-signature'] as string;
    const body = JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(body, sig, ENV.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    logger.error({ err }, 'Stripe signature verification failed');
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      if (wasHandled(session.id)) {
        return res.json({ ok: true, dedup: true });
      }

      const text = formatTelegram(session);
      await sendTelegram(text);
      await appendPaymentRow(session);

      markHandled(session.id);
      return res.json({ ok: true });
    }

    res.json({ ok: true, ignored: event.type });
  } catch (e: any) {
    logger.error({ e }, 'Webhook handler error');
    res.status(500).send('Server error');
  }
}
