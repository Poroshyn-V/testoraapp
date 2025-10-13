import Stripe from 'stripe';

// Format campaign names with proper separators
function formatCampaignName(name: string): string {
  if (!name || name === 'N/A') return name;
  
  // Add separators for common patterns
  return name
    // Add separators before numbers
    .replace(/([a-zA-Z])(\d)/g, '$1_$2')
    // Add separators after numbers before letters
    .replace(/(\d)([a-zA-Z])/g, '$1_$2')
    // Add separators before uppercase letters (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    // Add separators for common abbreviations
    .replace(/([a-zA-Z])(WEB|EN|US|CA|AU|Broad|testora|LC|ABO|Core|ABO|cpi|fcb)([a-zA-Z])/g, '$1_$2_$3')
    // Add separators for dates
    .replace(/(\d{2})\.(\d{2})\.(\d{4})/g, '$1.$2.$3')
    // Clean up multiple underscores
    .replace(/_+/g, '_')
    // Remove leading/trailing underscores
    .replace(/^_|_$/g, '');
}

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
  const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '0.00';
  const currency = (session.currency || 'usd').toUpperCase();
  const email = session.customer_details?.email || session.customer_email || 'N/A';
  const customerId = session.customer || 'unknown';
  
  // Extract geo data
  const geoCountry = m.geo_country || m.country || session.customer_details?.address?.country || 'Unknown';
  const geoCity = m.geo_city || session.customer_details?.address?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  
  // Get data from metadata and format it nicely
  const rawAdName = m.ad_name && m.ad_name !== 'N/A' ? m.ad_name : null;
  const rawAdsetName = m.adset_name && m.adset_name !== 'N/A' ? m.adset_name : null;
  const rawCampaignName = m.campaign_name && m.campaign_name !== 'N/A' ? m.campaign_name : null;
  const creativeLink = m.creative_link && m.creative_link !== 'N/A' ? m.creative_link : null;
  
  // Format names with proper separators
  const adName = rawAdName ? formatCampaignName(rawAdName) : null;
  const adsetName = rawAdsetName ? formatCampaignName(rawAdsetName) : null;
  const campaignName = rawCampaignName ? formatCampaignName(rawCampaignName) : null;
  
  // Create STRUCTURED notification message
  let message = `🟢 Purchase purchase_${customerId} was processed!
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
