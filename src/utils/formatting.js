// Data formatting utilities
import { logInfo } from './logging.js';

// Format payment data for Google Sheets
export function formatPaymentForSheets(payment, customer, metadata = {}) {
  const m = { ...payment.metadata, ...(customer?.metadata || {}), ...metadata };
  
  // Extract GEO data
  const geoCountry = m.geo_country || customer?.address?.country || 'Unknown';
  const geoCity = m.geo_city || customer?.address?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  
  // Format UTM data
  const utmSource = m.utm_source || 'N/A';
  const utmMedium = m.utm_medium || 'N/A';
  const utmCampaign = m.utm_campaign || 'N/A';
  const utmContent = m.utm_content || 'N/A';
  const utmTerm = m.utm_term || 'N/A';
  
  // Format ad data
  const adName = m.ad_name || 'N/A';
  const adsetName = m.adset_name || 'N/A';
  const campaignName = m.campaign_name || 'N/A';
  
  // Format customer data
  const customerName = customer?.name || 'N/A';
  const customerEmail = customer?.email || 'N/A';
  const customerId = customer?.id || 'N/A';
  
  // Format payment data
  const amount = (payment.amount / 100).toFixed(2);
  const currency = payment.currency?.toUpperCase() || 'USD';
  const status = payment.status || 'N/A';
  
  // Format dates
  const createdDate = new Date(payment.created * 1000);
  const createdUTC = createdDate.toISOString();
  // Format UTC+1 properly: YYYY-MM-DD HH:MM:SS.000 UTC+1
  const utcPlus1Date = new Date(createdDate.getTime() + 60 * 60 * 1000);
  const year = utcPlus1Date.getFullYear();
  const month = String(utcPlus1Date.getMonth() + 1).padStart(2, '0');
  const day = String(utcPlus1Date.getDate()).padStart(2, '0');
  const hours = String(utcPlus1Date.getHours()).padStart(2, '0');
  const minutes = String(utcPlus1Date.getMinutes()).padStart(2, '0');
  const seconds = String(utcPlus1Date.getSeconds()).padStart(2, '0');
  const createdLocal = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.000 UTC+1`;
  
  return {
    'Purchase ID': `purchase_${customerId}_${payment.created}`,
    'Created UTC': createdUTC,
    'Created Local (UTC+1)': createdLocal,
    'Payment Intent IDs': payment.id,
    'Payment Status': status,
    'Total Amount': amount,
    'Currency': currency,
    'Email': customerEmail,
    'GEO': geo,
    'Gender': m.gender || 'N/A',
    'Age': m.age || 'N/A',
    'Product Tag': m.product_tag || 'N/A',
    'Creative Link': m.creative_link || 'N/A',
    'UTM Source': utmSource,
    'UTM Medium': utmMedium,
    'UTM Campaign': utmCampaign,
    'UTM Content': utmContent,
    'UTM Term': utmTerm,
    'Platform Placement': m.platform_placement || 'N/A',
    'Ad Name': adName,
    'Adset Name': adsetName,
    'Campaign Name': campaignName,
    'Web Campaign': m.web_campaign || 'N/A',
    'Customer ID': customerId,
    'Client Reference ID': m.client_reference_id || 'N/A',
    'Mode': payment.mode || 'N/A',
    'Status': status,
    'Raw Metadata JSON': JSON.stringify(m)
  };
}

// Format notification message for Telegram (STRUCTURED FORMAT)
export function formatTelegramNotification(payment, customer, metadata = {}) {
  const m = { ...payment.metadata, ...(customer?.metadata || {}), ...metadata };
  
  // Extract data
  const amount = (payment.amount / 100).toFixed(2);
  const currency = payment.currency?.toUpperCase() || 'USD';
  const email = customer?.email || 'N/A';
  const geoCountry = m.geo_country || customer?.address?.country || 'Unknown';
  const geoCity = m.geo_city || customer?.address?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  
  // Get data from metadata (same as Google Sheets)
  const adName = m.ad_name && m.ad_name !== 'N/A' ? m.ad_name : null;
  const adsetName = m.adset_name && m.adset_name !== 'N/A' ? m.adset_name : null;
  const campaignName = m.campaign_name && m.campaign_name !== 'N/A' ? m.campaign_name : null;
  const creativeLink = m.creative_link && m.creative_link !== 'N/A' ? m.creative_link : null;
  
  // Create STRUCTURED notification message
  let message = `🟢 Purchase purchase_cus_${customer?.id || 'unknown'}_${payment.created} was processed!
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

// Format weekly report
export function formatWeeklyReport(data) {
  const { 
    weekStart, 
    weekEnd, 
    totalRevenue, 
    totalSales, 
    revenueGrowth, 
    salesGrowth, 
    topCountries, 
    topCreatives, 
    dailyBreakdown 
  } = data;
  
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  
  return `📊 **Weekly Report - Past Week (${weekStartStr} - ${weekEndStr})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 **Total Revenue:** $${totalRevenue.toFixed(2)}
📈 **Revenue Growth:** ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}% vs week before
🛒 **Total Sales:** ${totalSales}
📊 **Sales Growth:** ${salesGrowth > 0 ? '+' : ''}${salesGrowth}% vs week before
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 **Top Countries (Past Week):**
${topCountries.map(([country, count], i) => `${i + 1}. ${country}: ${count} sales`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 **Top Creatives (Past Week):**
${topCreatives.map(([creative, count], i) => `${i + 1}. ${creative}: ${count} sales`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 **Daily Breakdown (Past Week):**
${dailyBreakdown.join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ **Report generated:** ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' })} UTC+1`;
}

// Format GEO alert
export function formatGeoAlert(data) {
  const { topCountries, totalSales, date } = data;
  
  return `🌍 **GEO Alert - ${date}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **Total Sales Today:** ${totalSales}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 **Top Countries:**
${topCountries.map(([country, count], i) => `${i + 1}. ${country}: ${count} sales`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ **Alert generated:** ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' })} UTC+1`;
}

// Format creative alert
export function formatCreativeAlert(data) {
  const { topCreatives, totalSales, date } = data;
  
  return `🎨 **Creative Alert - ${date}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **Total Sales Today:** ${totalSales}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 **Top Creatives:**
${topCreatives.map(([creative, count], i) => `${i + 1}. ${creative}: ${count} sales`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ **Alert generated:** ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' })} UTC+1`;
}

// Format notification message for Slack (SAME AS TELEGRAM - STRUCTURED FORMAT)
export function formatSlackNotification(payment, customer, metadata = {}) {
  const m = { ...payment.metadata, ...(customer?.metadata || {}), ...metadata };
  
  // Extract data
  const amount = (payment.amount / 100).toFixed(2);
  const currency = payment.currency?.toUpperCase() || 'USD';
  const email = customer?.email || 'N/A';
  const geoCountry = m.geo_country || customer?.address?.country || 'Unknown';
  const geoCity = m.geo_city || customer?.address?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  
  // Get data from metadata (same as Google Sheets)
  const adName = m.ad_name && m.ad_name !== 'N/A' ? m.ad_name : null;
  const adsetName = m.adset_name && m.adset_name !== 'N/A' ? m.adset_name : null;
  const campaignName = m.campaign_name && m.campaign_name !== 'N/A' ? m.campaign_name : null;
  const creativeLink = m.creative_link && m.creative_link !== 'N/A' ? m.creative_link : null;
  
  // Create STRUCTURED notification message (SAME AS TELEGRAM)
  let message = `🟢 Purchase purchase_cus_${customer?.id || 'unknown'}_${payment.created} was processed!
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
