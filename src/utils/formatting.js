// Data formatting utilities
import { logInfo } from './logging.js';

// Format campaign names with proper separators
function formatCampaignName(name) {
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
    .replace(/^_|_$/g, '')
    // Keep test geo notation like T1 without extra underscore (fix T_1 → T1)
    .replace(/T_([0-9]+)/g, 'T$1');
}

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
  
  // Format ad data (check multiple possible field names)
  const adName = m.ad_name || m['Ad Name'] || 'N/A';
  const adsetName = m.adset_name || m['Adset Name'] || 'N/A';
  const campaignName = m.campaign_name || m['Campaign Name'] || m.utm_campaign || 'N/A';
  
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
  
  // Format LA time (Pacific Time)
  const laFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const laParts = laFormatter.formatToParts(createdDate);
  const laYear = laParts.find(p => p.type === 'year').value;
  const laMonth = laParts.find(p => p.type === 'month').value;
  const laDay = laParts.find(p => p.type === 'day').value;
  const laHours = laParts.find(p => p.type === 'hour').value;
  const laMinutes = laParts.find(p => p.type === 'minute').value;
  const laSeconds = laParts.find(p => p.type === 'second').value;
  const createdLATime = `${laYear}-${laMonth.padStart(2, '0')}-${laDay.padStart(2, '0')} ${laHours.padStart(2, '0')}:${laMinutes.padStart(2, '0')}:${laSeconds.padStart(2, '0')}.000 LA Time`;
  
  return {
    'Purchase ID': `purchase_${customerId}`,
    'Created UTC': createdUTC,
    'Created Local (UTC+1)': createdLocal,
    'Created Local (LA Time)': createdLATime,
    'Payment Intent IDs': payment.id,
    'Total Amount': amount,
    'Currency': currency,
    'Email': customerEmail,
    'GEO': geo,
    'Gender': m.gender || 'N/A',
    'Age': m.age || 'N/A',
    'Product Tag': m.product_tag || 'N/A',
    'Creative Link': m.creative_link || m['Creative Link'] || 'N/A',
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

// Format payment data for Low Price sheet (with LA time instead of UTC+1)
export function formatPaymentForSheetsLowPrice(payment, customer, metadata = {}) {
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
  const adName = m.ad_name || m['Ad Name'] || 'N/A';
  const adsetName = m.adset_name || m['Adset Name'] || 'N/A';
  const campaignName = m.campaign_name || m['Campaign Name'] || m.utm_campaign || 'N/A';
  
  // Format customer data
  const customerEmail = customer?.email || 'N/A';
  const customerId = customer?.id || 'N/A';
  
  // Format payment data
  const amount = (payment.amount / 100).toFixed(2);
  const currency = payment.currency?.toUpperCase() || 'USD';
  const status = payment.status || 'N/A';
  
  // Format dates - LA time (Pacific Time)
  const createdDate = new Date(payment.created * 1000);
  const createdUTC = createdDate.toISOString();
  
  // Convert to LA time (America/Los_Angeles timezone)
  // Using Intl.DateTimeFormat for reliable timezone conversion
  const laFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const laParts = laFormatter.formatToParts(createdDate);
  const year = laParts.find(p => p.type === 'year').value;
  const month = laParts.find(p => p.type === 'month').value;
  const day = laParts.find(p => p.type === 'day').value;
  const hours = laParts.find(p => p.type === 'hour').value;
  const minutes = laParts.find(p => p.type === 'minute').value;
  const seconds = laParts.find(p => p.type === 'second').value;
  
  // Format as YYYY-MM-DD HH:MM:SS.000 LA Time
  const createdLocal = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}.000 LA Time`;
  
  return {
    'Purchase ID': `purchase_${customerId}`,
    'Created UTC': createdUTC,  // Время из Stripe
    'Created Local (LA Time)': createdLocal,  // Время по LA
    'Payment Intent IDs': payment.id,
    'Total Amount': amount,
    'Currency': currency,
    'Email': customerEmail,
    'GEO': geo,
    'Gender': m.gender || 'N/A',
    'Age': m.age || 'N/A',
    'Product Tag': m.product_tag || 'N/A',
    'Creative Link': m.creative_link || m['Creative Link'] || 'N/A',
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

// Format payment data for Primer sheet (PayPal payments)
// ✅ Используем стандартные колонки таблицы
export function formatPaymentForSheetsPrimer(payment, customer, metadata = {}) {
  // Primer stores all data in metadata, merge everything
  const m = { 
    ...payment.metadata, 
    ...(customer?.metadata || {}), 
    ...metadata 
  };
  
  // ✅ КРИТИЧЕСКИ ВАЖНО: Extract GEO data from ALL possible sources
  // Primer API может хранить country в разных местах, проверяем все
  const geoCountry = customer?.country
    || customer?.address?.country
    || payment.country
    || m.geo_country 
    || m.country_code 
    || payment._original?.order?.countryCode // Из оригинального Primer payment объекта
    || payment._original?.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
    || payment._original?.metadata?.geo_country
    || payment._original?.metadata?.country_code
    || 'Unknown';
  const geoCity = m.geo_city || customer?.address?.city || customer?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  
  // Format UTM data from Primer metadata (utm_source, utm_campaign, etc.)
  const utmSource = m.utm_source || 'N/A';
  const utmMedium = m.utm_medium || 'N/A';
  const utmCampaign = m.utm_campaign || 'N/A';
  const utmContent = m.utm_content || 'N/A';
  const utmTerm = m.utm_term || 'N/A';
  
  // Format ad data from Primer metadata (utm_ad_name, utm_adset_name)
  const adName = m.utm_ad_name || m.ad_name || m['Ad Name'] || 'N/A';
  const adsetName = m.utm_adset_name || m.adset_name || m['Adset Name'] || 'N/A';
  
  // ✅ КРИТИЧЕСКИ ВАЖНО: Format customer data - извлекаем email из ВСЕХ возможных источников
  // Приоритет: customer.email > payment.email > metadata.email > _original объект
  const customerEmail = customer?.email 
    || payment.email
    || m.email 
    || payment._original?.customer?.emailAddress // Из оригинального Primer payment объекта
    || payment._original?.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
    || payment._original?.metadata?.email
    || 'N/A';
  const customerId = customer?.id || m.customer_id || payment.customer || 'N/A';
  
  // Format payment data
  // Primer amounts are in cents (from normalizePrimerPayment)
  const amount = payment.amount 
    ? (payment.amount / 100).toFixed(2)
    : '0.00';
  const currency = (payment.currency || 'USD').toUpperCase();
  const status = payment.status || 'N/A';
  
  // Format dates - UTC-8 (LA time, Pacific Time)
  const createdDate = new Date(payment.created * 1000);
  const createdUTC = createdDate.toISOString();
  
  // Convert to UTC-8 (America/Los_Angeles timezone)
  const laFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const laParts = laFormatter.formatToParts(createdDate);
  const year = laParts.find(p => p.type === 'year').value;
  const month = laParts.find(p => p.type === 'month').value;
  const day = laParts.find(p => p.type === 'day').value;
  const hours = laParts.find(p => p.type === 'hour').value;
  const minutes = laParts.find(p => p.type === 'minute').value;
  const seconds = laParts.find(p => p.type === 'second').value;
  
  // Format as YYYY-MM-DD HH:MM:SS.000 UTC-8
  const createdLocal = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}.000 UTC-8`;
  
  // Payment count (default 1 for new purchases)
  const paymentCount = metadata['Payment Count'] || '1';
  
  // ✅ Используем ТОЛЬКО стандартные колонки таблицы
  return {
    'Payment Intent IDs': payment.id,
    'Purchase ID': metadata['Purchase ID'] || `purchase_${customerId}`,
    'Total Amount': amount,
    'Currency': currency,
    'Status': status,
    'Created UTC': createdUTC,
    'Created Local (UTC-8)': createdLocal,
    'Customer ID': customerId,
    'Email': customerEmail,
    'GEO': geo,
    'UTM Source': utmSource,
    'UTM Medium': utmMedium,
    'UTM Campaign': utmCampaign,
    'UTM Content': utmContent,
    'UTM Term': utmTerm,
    'Ad Name': adName,
    'Adset Name': adsetName,
    'Payment Count': paymentCount
  };
}

// Format notification message for Telegram (STRUCTURED FORMAT)
export function formatTelegramNotification(payment, customer, metadata = {}) {
  const m = { ...payment.metadata, ...(customer?.metadata || {}), ...metadata };
  
  // Extract data
  const amount = metadata['Total Amount'] || (payment.amount ? (payment.amount / 100).toFixed(2) : '0.00');
  const currency = payment.currency?.toUpperCase() || 'USD';
  // ✅ Для Primer: проверяем email из разных источников
  const email = customer?.email 
    || metadata['Email'] 
    || payment.email 
    || (payment._original?.customer?.emailAddress)
    || (payment._original?.paymentMethod?.paymentMethodData?.externalPayerInfo?.email)
    || 'N/A';
  const geoCountry = m.geo_country || customer?.address?.country || 'Unknown';
  const geoCity = m.geo_city || customer?.address?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  const paymentCount = metadata['Payment Count'] || '1';
  
  // Get account source (W2W for main sheet, FL for LowPrice sheet, Primer for PayPal)
  const accountSource = metadata.accountSource || metadata.account_source || payment._source || 'W2W'; // Default to W2W for backward compatibility
  let accountLabel = 'W2W (payments)';
  if (accountSource === 'FL' || accountSource === 'lowprice') {
    accountLabel = 'FL (LowPrice)';
  } else if (accountSource === 'primer' || accountSource === 'PRIMER' || payment._primer) {
    accountLabel = 'Primer (PayPal)';
  }
  
  // Get UTM Source (Platform)
  const utmSource = (metadata['UTM Source'] && metadata['UTM Source'] !== 'N/A') 
    ? metadata['UTM Source'] 
    : (m.utm_source && m.utm_source !== 'N/A' ? m.utm_source : null);
  
  // Get data from metadata or passed sheet data and format it nicely
  const rawAdName = (metadata['Ad Name'] && metadata['Ad Name'] !== 'N/A') || (m.ad_name && m.ad_name !== 'N/A') ? (metadata['Ad Name'] || m.ad_name) : null;
  const rawAdsetName = (metadata['Adset Name'] && metadata['Adset Name'] !== 'N/A') || (m.adset_name && m.adset_name !== 'N/A') ? (metadata['Adset Name'] || m.adset_name) : null;
  // Campaign name with fallback to UTM Campaign
  let rawCampaignName = null;
  if (metadata['Campaign Name'] && metadata['Campaign Name'] !== 'N/A') {
    rawCampaignName = metadata['Campaign Name'];
  } else if (metadata['UTM Campaign'] && metadata['UTM Campaign'] !== 'N/A') {
    rawCampaignName = metadata['UTM Campaign'];
  } else if (m.campaign_name && m.campaign_name !== 'N/A') {
    rawCampaignName = m.campaign_name;
  } else if (m.utm_campaign && m.utm_campaign !== 'N/A') {
    rawCampaignName = m.utm_campaign;
  }
  const creativeLink = (metadata['Creative Link'] && metadata['Creative Link'] !== 'N/A') || (m.creative_link && m.creative_link !== 'N/A') ? (metadata['Creative Link'] || m.creative_link) : null;
  
  // Format names with proper separators
  const adName = rawAdName ? formatCampaignName(rawAdName) : null;
  const adsetName = rawAdsetName ? formatCampaignName(rawAdsetName) : null;
  const campaignName = rawCampaignName ? formatCampaignName(rawCampaignName) : null;
  
  // Check if this is a VIP purchase
  const isVip = metadata.isVip || parseFloat(amount) >= 100; // VIP threshold
  
  // Определяем Payment Method в зависимости от источника
  let paymentMethodLabel = 'Card';
  if (accountSource === 'primer' || accountSource === 'PRIMER' || payment._primer) {
    paymentMethodLabel = 'PayPal';
  }
  
  // Create STRUCTURED notification message
  let message = `${isVip ? '💎 VIP ' : ''}🟢 Purchase purchase_${customer?.id || 'unknown'} was processed!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 Payment Method: ${paymentMethodLabel}
💰 Amount: ${amount} ${currency}${isVip ? ' 💎' : ''}
🏷️ Payments: ${paymentCount}
📋 Account: ${accountLabel}
${utmSource ? `🔹 Platform: ${utmSource}` : ''}
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
  const amount = metadata['Total Amount'] || (payment.amount ? (payment.amount / 100).toFixed(2) : '0.00');
  const currency = payment.currency?.toUpperCase() || 'USD';
  // ✅ Для Primer: проверяем email из разных источников
  const email = customer?.email 
    || metadata['Email'] 
    || payment.email 
    || (payment._original?.customer?.emailAddress)
    || (payment._original?.paymentMethod?.paymentMethodData?.externalPayerInfo?.email)
    || 'N/A';
  const geoCountry = m.geo_country || customer?.address?.country || 'Unknown';
  const geoCity = m.geo_city || customer?.address?.city || 'Unknown';
  const geo = geoCity !== 'Unknown' ? `${geoCountry}, ${geoCity}` : geoCountry;
  const paymentCount = metadata['Payment Count'] || '1';
  
  // Get account source (W2W for main sheet, FL for LowPrice sheet, Primer for PayPal)
  const accountSource = metadata.accountSource || metadata.account_source || payment._source || 'W2W'; // Default to W2W for backward compatibility
  let accountLabel = 'W2W (payments)';
  if (accountSource === 'FL' || accountSource === 'lowprice') {
    accountLabel = 'FL (LowPrice)';
  } else if (accountSource === 'primer' || accountSource === 'PRIMER' || payment._primer) {
    accountLabel = 'Primer (PayPal)';
  }
  
  // Get UTM Source (Platform)
  const utmSource = (metadata['UTM Source'] && metadata['UTM Source'] !== 'N/A') 
    ? metadata['UTM Source'] 
    : (m.utm_source && m.utm_source !== 'N/A' ? m.utm_source : null);
  
  // Get data from metadata or passed sheet data and format it nicely
  const rawAdName = (metadata['Ad Name'] && metadata['Ad Name'] !== 'N/A') || (m.ad_name && m.ad_name !== 'N/A') ? (metadata['Ad Name'] || m.ad_name) : null;
  const rawAdsetName = (metadata['Adset Name'] && metadata['Adset Name'] !== 'N/A') || (m.adset_name && m.adset_name !== 'N/A') ? (metadata['Adset Name'] || m.adset_name) : null;
  // Campaign name with fallback to UTM Campaign
  let rawCampaignName = null;
  if (metadata['Campaign Name'] && metadata['Campaign Name'] !== 'N/A') {
    rawCampaignName = metadata['Campaign Name'];
  } else if (metadata['UTM Campaign'] && metadata['UTM Campaign'] !== 'N/A') {
    rawCampaignName = metadata['UTM Campaign'];
  } else if (m.campaign_name && m.campaign_name !== 'N/A') {
    rawCampaignName = m.campaign_name;
  } else if (m.utm_campaign && m.utm_campaign !== 'N/A') {
    rawCampaignName = m.utm_campaign;
  }
  const creativeLink = (metadata['Creative Link'] && metadata['Creative Link'] !== 'N/A') || (m.creative_link && m.creative_link !== 'N/A') ? (metadata['Creative Link'] || m.creative_link) : null;
  
  // Format names with proper separators
  const adName = rawAdName ? formatCampaignName(rawAdName) : null;
  const adsetName = rawAdsetName ? formatCampaignName(rawAdsetName) : null;
  const campaignName = rawCampaignName ? formatCampaignName(rawCampaignName) : null;
  
  // Определяем Payment Method в зависимости от источника
  let paymentMethodLabel = 'Card';
  if (accountSource === 'primer' || accountSource === 'PRIMER' || payment._primer) {
    paymentMethodLabel = 'PayPal';
  }
  
  // Create STRUCTURED notification message (SAME AS TELEGRAM)
  let message = `🟢 Purchase purchase_cus_${customer?.id || 'unknown'} was processed!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 Payment Method: ${paymentMethodLabel}
💰 Amount: ${amount} ${currency}
🏷️ Payments: ${paymentCount}
📋 Account: ${accountLabel}
${utmSource ? `🔹 Platform: ${utmSource}` : ''}
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
