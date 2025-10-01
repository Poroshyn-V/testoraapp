import { ENV } from './env.js';
import Stripe from 'stripe';

export async function sendSlack(text: string) {
  if (!ENV.SLACK_BOT_TOKEN || !ENV.SLACK_CHANNEL_ID) {
    console.log('Slack not configured, skipping notification');
    return;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENV.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: ENV.SLACK_CHANNEL_ID,
        text: text,
        username: 'Stripe Bot',
        icon_emoji: ':money_with_wings:'
      })
    });

    const result = await response.json();
    
    if (result.ok) {
      console.log('Slack notification sent successfully');
    } else {
      console.error('Slack API error:', result.error);
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error);
  }
}

export function formatSlack(session: Stripe.Checkout.Session, customerMetadata: any = {}): string {
  const m = { ...session.metadata, ...customerMetadata };
  const amount = (session.amount_total ?? 0) / 100;
  const currency = (session.currency || 'usd').toUpperCase();
  const email = session.customer_details?.email || session.customer_email || 'N/A';
  const orderId = session.id.slice(3, 14);
  const country = m.geo_country || m.country || session.customer_details?.address?.country || 'N/A';
  const product_tag = m.product_tag || 'N/A';
  const utm_campaign = m.campaign_name || m.utm_campaign || 'N/A';
  
  return `🟢 *Order ${orderId} was processed!*

💳 card
💰 ${amount} ${currency}
🏷️ ${product_tag}

📧 ${email}

🌪️ ${orderId}
📍 ${country}
🎯 ${utm_campaign}

✅ Payment processed successfully!`;
}
