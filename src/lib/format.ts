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
  
  // Get beautiful names from Google Sheets data (metadata)
  const adName = m['Ad Name'] && m['Ad Name'] !== 'N/A' ? m['Ad Name'] : null;
  const adsetName = m['Adset Name'] && m['Adset Name'] !== 'N/A' ? m['Adset Name'] : null;
  const campaignName = m['UTM Campaign'] && m['UTM Campaign'] !== 'N/A' ? m['UTM Campaign'] : null;
  const creativeLink = m['Creative Link'] && m['Creative Link'] !== 'N/A' ? m['Creative Link'] : null;
  
  // Create STRUCTURED notification message
  let message = `🟢 Purchase purchase_cus_${session.customer || 'unknown'}_${session.created} was processed!
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
