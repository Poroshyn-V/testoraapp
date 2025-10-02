import { ENV } from './env.js';
import Stripe from 'stripe';

export async function sendSlack(text: string) {
  console.log('🔍 Slack debug - checking configuration...');
  console.log('SLACK_BOT_TOKEN exists:', !!ENV.SLACK_BOT_TOKEN);
  console.log('SLACK_CHANNEL_ID exists:', !!ENV.SLACK_CHANNEL_ID);
  
  if (!ENV.SLACK_BOT_TOKEN || !ENV.SLACK_CHANNEL_ID) {
    console.log('❌ Slack not configured, skipping notification');
    console.log('Missing:', {
      token: !ENV.SLACK_BOT_TOKEN,
      channel: !ENV.SLACK_CHANNEL_ID
    });
    return;
  }

  try {
    console.log('📤 Sending Slack notification...');
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
    console.log('📥 Slack API response:', result);
    
    if (result.ok) {
      console.log('✅ Slack notification sent successfully');
    } else {
      console.error('❌ Slack API error:', result.error);
    }
  } catch (error) {
    console.error('❌ Error sending Slack notification:', error);
  }
}

export function formatSlack(session: Stripe.Checkout.Session, customerMetadata: any = {}): string {
  const m = { ...session.metadata, ...customerMetadata };
  const amount = (session.amount_total ?? 0) / 100;
  const currency = (session.currency || 'usd').toUpperCase();
  const pm = session.payment_method_types?.[0] || 'card';
  const email = session.customer_details?.email || session.customer_email || 'N/A';
  
  // Используем полный ID платежа
  const paymentId = session.id;
  const paymentCount = m.payment_count || '1 payment';
  
  const country = m.geo_country || m.country || session.customer_details?.address?.country || 'N/A';
  const gender = m.gender || 'N/A';
  const creative_link = m.creative_link || 'N/A';
  const utm_source = m.utm_source || 'N/A';
  const platform_placement = m.platform_placement || 'N/A';
  const ad_name = m.ad_name || 'N/A';
  const adset_name = m.adset_name || 'N/A';
  const campaign_name = m.campaign_name || m.utm_campaign || 'N/A';
  
  return `🟢 *Purchase ${paymentId} was processed!*
---------------------------
💳 ${pm}
💰 ${amount} ${currency}
🏷️ ${paymentCount}
---------------------------
📧 ${email}
---------------------------
🌪️ ${paymentId}
📍 ${country}
🧍 ${gender}
🔗 ${creative_link}
${utm_source}
${platform_placement}
${ad_name}
${adset_name}
${campaign_name}`;
}
