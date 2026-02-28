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

export function formatSlack(session: Stripe.Checkout.Session): string {
  const amount = (session.amount_total ?? 0) / 100;
  const currency = (session.currency || 'usd').toUpperCase();
  const email = session.customer_details?.email || session.customer_email || 'N/A';
  
  return `💰 *New Payment Received!*
  
💳 *Amount:* ${amount} ${currency}
📧 *Email:* ${email}
🆔 *Session ID:* \`${session.id}\`
📅 *Date:* ${new Date().toLocaleString()}
🌍 *Country:* ${session.customer_details?.address?.country || 'N/A'}

✅ Payment processed successfully!`;
}
