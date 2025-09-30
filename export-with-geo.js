import Stripe from 'stripe';
import fetch from 'node-fetch';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function getGeoFromIP(ip) {
  try {
    if (!ip || ip === 'N/A') return { country: 'N/A', city: 'N/A', region: 'N/A' };
    
    // Используем ipapi.co для получения ГЕО данных
    const response = await fetch(`https://ipapi.co/${ip}/json/`);
    const data = await response.json();
    
    return {
      country: data.country_name || 'N/A',
      city: data.city || 'N/A',
      region: data.region || 'N/A',
      timezone: data.timezone || 'N/A',
      isp: data.org || 'N/A'
    };
  } catch (error) {
    console.error('Ошибка получения ГЕО:', error.message);
    return { country: 'N/A', city: 'N/A', region: 'N/A' };
  }
}

async function exportAllPaymentsWithGeo() {
  try {
    console.log('🔄 Экспорт ВСЕХ платежей с ГЕО данными...');
    
    // Получаем ВСЕ платежи
    const payments = await stripe.paymentIntents.list({ limit: 10 });
    console.log(`📊 Найдено: ${payments.data.length} платежей`);
    
    // Создаем правильный JWT токен
    const header = {
      "alg": "RS256",
      "typ": "JWT"
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.GOOGLE_SERVICE_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    
    // Кодируем header и payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    // Создаем подпись с правильным алгоритмом
    const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${encodedHeader}.${encodedPayload}`);
    const signature = sign.sign(privateKey, 'base64url');
    
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Получаем access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${token}`
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      throw new Error(`Ошибка аутентификации: ${tokenData.error_description}`);
    }
    
    const accessToken = tokenData.access_token;
    
    if (!accessToken) {
      throw new Error('Не удалось получить access token для Google Sheets API.');
    }
    
    console.log('✅ Access token получен');
    
    // Подготавливаем данные с ГЕО столбцами
    const spreadsheetId = process.env.GOOGLE_SHEETS_DOC_ID;
    const range = 'A1';
    
    // Заголовки с ГЕО данными
    const headers = [
      'Payment ID', 'Amount', 'Currency', 'Status', 'Created', 'Customer ID', 'Customer Email',
      'UTM Source', 'UTM Medium', 'UTM Campaign', 'creative_link', 'utm_source', 'utm_medium',
      'utm_campaign', 'utm_content', 'utm_term', 'platform_placement', 'ad_name', 'adset_name',
      'campaign_name', 'web_campaign', 'customer_id', 'client_reference_id', 'mode', 'status',
      'raw_metadata_json',
      // ГЕО данные
      'Customer Country', 'Customer City', 'Customer Region', 'Customer Timezone', 'Customer ISP',
      'IP Address', 'User Agent', 'Customer Name', 'Customer Phone'
    ];
    
    const values = [headers];
    
    // Обрабатываем каждый платеж
    for (const payment of payments.data) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const metadata = customer?.metadata || {};
      
      // Получаем IP из metadata
      const ipAddress = metadata.ip_address || 'N/A';
      console.log(`🌍 Получаем ГЕО для IP: ${ipAddress}`);
      
      // Получаем ГЕО данные
      const geoData = await getGeoFromIP(ipAddress);
      
      const row = [
        payment.id,
        `$${(payment.amount / 100).toFixed(2)}`,
        payment.currency.toUpperCase(),
        payment.status,
        new Date(payment.created * 1000).toLocaleString(),
        customer?.id || 'N/A',
        customer?.email || 'N/A',
        metadata.utm_source || 'N/A',
        metadata.utm_medium || 'N/A',
        metadata.utm_campaign || 'N/A',
        metadata.creative_link || 'N/A',
        metadata.utm_source || 'N/A',
        metadata.utm_medium || 'N/A',
        metadata.utm_campaign || 'N/A',
        metadata.utm_content || 'N/A',
        metadata.utm_term || 'N/A',
        metadata.platform_placement || 'N/A',
        metadata.ad_name || 'N/A',
        metadata.adset_name || 'N/A',
        metadata.campaign_name || 'N/A',
        metadata.web_campaign || 'N/A',
        customer?.id || 'N/A',
        payment.client_secret || 'N/A',
        payment.mode || 'N/A',
        payment.status || 'N/A',
        JSON.stringify(metadata) || 'N/A',
        // ГЕО данные
        geoData.country,
        geoData.city,
        geoData.region,
        geoData.timezone,
        geoData.isp,
        ipAddress,
        metadata.user_agent || 'N/A',
        customer?.name || 'N/A',
        customer?.phone || 'N/A'
      ];
      
      values.push(row);
      console.log(`✅ Добавлен: ${payment.id} - ${geoData.country}, ${geoData.city}`);
    }
    
    // Очищаем лист
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('🧹 Лист очищен');
    
    // Добавляем данные
    const updateResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    });
    
    const updateData = await updateResponse.json();
    
    if (updateData.error) {
      throw new Error(updateData.error.message);
    }
    
    console.log(`🎉 ГОТОВО! ${payments.data.length} платежей с ГЕО данными в Google Sheets`);
    console.log(`📊 Ссылка: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('🔍 Детали:', error);
  }
}

exportAllPaymentsWithGeo();
