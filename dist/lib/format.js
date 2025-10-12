import Stripe from 'stripe';

export function maskEmail(email?: string): string {
  if (!email) return '-';
  const [u, d] = email.split('@');
  if (!d) return email;
  const maskedLocal = u.length <= 1 ? '*' : u[0] + '*'.repeat(Math.max(1, u.length - 1));
  return `${maskedLocal}@${d}`;
}

export function shortId(id: string): string {
  if (!id) return '-';
  return id.slice(0, 7) + '...';
}

export function formatTelegram(session: Stripe.Checkout.Session, customerMetadata: any = {}) {
  const m = { ...session.metadata, ...customerMetadata };
  const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
  const currency = (session.currency || 'usd').toUpperCase();
  const email = session.customer_details?.email || session.customer_email || 'N/A';
  
  // Extract geo data
  const geoCountry = m.geo_country || m.country || session.customer_details?.address?.country || 'Unknown';
  const geoCity = m.geo_city || session.customer_details?.address?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  
  // Format ad data (only include if not N/A)
  const adName = m.ad_name && m.ad_name !== 'N/A' ? m.ad_name : null;
  const adsetName = m.adset_name && m.adset_name !== 'N/A' ? m.adset_name : null;
  const campaignName = (m.campaign_name && m.campaign_name !== 'N/A') || 
                      (m.campaign && m.campaign !== 'N/A') || 
                      (m.campaign_id && m.campaign_id !== 'N/A') ? 
                      (m.campaign_name || m.campaign || m.campaign_id) : null;
  const creativeLink = m.creative_link && m.creative_link !== 'N/A' ? m.creative_link : null;
  
  // Create STRUCTURED notification message
  let message = `🟢 Purchase purchase_${session.customer || 'unknown'}_${session.created} was processed!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 Payment Method: Card
💰 Amount: ${amount} ${currency}
🏷️ Payments: 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 Email: ${email}
📍 Location: ${geo}`;

  // Add creative link if available
  if (creativeLink) {
    message += `\n🔗 Link: ${creativeLink}`;
  }

  // Add campaign data section if any data is available
  const hasCampaignData = adName || adsetName || campaignName;
  if (hasCampaignData) {
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 Campaign Data:`;
    
    if (adName) {
      message += `\n• Ad: ${adName}`;
    }
    if (adsetName) {
      message += `\n• Adset: ${adsetName}`;
    }
    if (campaignName) {
      message += `\n• Campaign: ${campaignName}`;
    }
  }

  return message;
}
