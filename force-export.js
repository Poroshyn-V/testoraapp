const Stripe = require('stripe');
const crypto = require('crypto');

// Инициализация Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function forceExportAll() {
  try {
    console.log('🚀 ПРИНУДИТЕЛЬНАЯ ПОЛНАЯ ВЫГРУЗКА ВСЕХ ПОКУПОК...');
    
    // Получаем ВСЕ платежи (без лимита)
    const allPayments = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
      
      const payments = await stripe.paymentIntents.list(params);
      allPayments.push(...payments.data);
      
      hasMore = payments.has_more;
      if (hasMore && payments.data.length > 0) {
        startingAfter = payments.data[payments.data.length - 1].id;
      }
    }
    
    console.log(`📊 Всего найдено платежей: ${allPayments.length}`);
    
    const successfulPayments = allPayments.filter(p => p.status === 'succeeded' && p.customer);
    console.log(`✅ Успешных платежей с клиентами: ${successfulPayments.length}`);
    
    // Группируем покупки по клиенту и дате
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      const customer = await stripe.customers.retrieve(payment.customer);
      const customerIdForExport = customer?.id;
      const purchaseDateForExport = new Date(payment.created * 1000);
      const dateKeyForExport = `${customerIdForExport}_${purchaseDateForExport.toISOString().split('T')[0]}`;
      
      if (!groupedPurchases.has(dateKeyForExport)) {
        groupedPurchases.set(dateKeyForExport, {
          customer,
          payments: [],
          totalAmount: 0,
          firstPayment: payment
        });
      }
      
      const group = groupedPurchases.get(dateKeyForExport);
      group.payments.push(payment);
      group.totalAmount += payment.amount;
    }
    
    console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);
    
    // Сортируем группированные покупки по дате (старые → новые)
    const sortedGroups = Array.from(groupedPurchases.entries()).sort((a, b) => {
      const dateA = new Date(a[1].firstPayment.created * 1000);
      const dateB = new Date(b[1].firstPayment.created * 1000);
      return dateA - dateB; // старые сверху
    });
    
    console.log('📅 Покупки отсортированы: старые → новые');
    
    // Обновляем Google Sheets
    if (process.env.GOOGLE_SHEETS_DOC_ID && process.env.GOOGLE_SERVICE_EMAIL && process.env.GOOGLE_SERVICE_PRIVATE_KEY) {
      // Создаем JWT токен для Google Sheets
      const header = { "alg": "RS256", "typ": "JWT" };
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: process.env.GOOGLE_SERVICE_EMAIL,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
      };

      const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

      const privateKey = process.env.GOOGLE_SERVICE_PRIVATE_KEY
        .replace(/\\n/g, '\n')
        .replace(/"/g, '');

      const signature = crypto.createSign('RSA-SHA256')
        .update(`${encodedHeader}.${encodedPayload}`)
        .sign(privateKey, 'base64url');

      const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;

      // Получаем access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        
        // Очищаем весь лист
        const clearResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/A:Z:clear?valueInputOption=RAW`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (clearResponse.ok) {
          console.log('🧹 Google Sheets полностью очищен');
        }
        
        // Подготавливаем данные для экспорта
        const exportData = [
          ['Purchase ID', 'Total Amount', 'Currency', 'Status', 'Created UTC', 'Created Local (UTC+1)', 'Customer ID', 'Customer Email', 'GEO', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'Ad Name', 'Adset Name', 'Payment Count']
        ];
        
        for (const [dateKeyForExport, group] of sortedGroups) {
          const customer = group.customer;
          const firstPayment = group.firstPayment;
          
          // Формируем GEO данные
          let geoData = 'N/A';
          if (customer?.metadata?.geo_country && customer?.metadata?.geo_city) {
            geoData = `${customer.metadata.geo_country}, ${customer.metadata.geo_city}`;
          } else if (customer?.metadata?.geo_country) {
            geoData = customer.metadata.geo_country;
          }
          
          const utcTime = new Date(firstPayment.created * 1000).toISOString();
          const localTime = new Date(firstPayment.created * 1000 + 3600000).toISOString().replace('T', ' ').replace('Z', ' UTC+1');
          
          // Создаем уникальный ID покупки на основе клиента и даты
          const purchaseId = `purchase_${customer?.id}_${dateKeyForExport.split('_')[1]}`;
          
          const row = [
            purchaseId,
            (group.totalAmount / 100).toFixed(2),
            firstPayment.currency.toUpperCase(),
            'succeeded',
            utcTime,
            localTime,
            customer?.id || 'N/A',
            customer?.email || 'N/A',
            geoData,
            customer?.metadata?.utm_source || 'N/A',
            customer?.metadata?.utm_medium || 'N/A',
            customer?.metadata?.utm_campaign || 'N/A',
            customer?.metadata?.utm_content || 'N/A',
            customer?.metadata?.utm_term || 'N/A',
            customer?.metadata?.ad_name || 'N/A',
            customer?.metadata?.adset_name || 'N/A',
            group.payments.length // Payment Count
          ];
          
          exportData.push(row);
        }
        
        // Записываем ВСЕ данные в Google Sheets (полная перезапись)
        const range = `A1:Q${exportData.length}`;
        const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_DOC_ID}/values/${range}?valueInputOption=RAW`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: exportData })
        });
          
        if (sheetsResponse.ok) {
          console.log('✅ ВСЕ ПОКУПКИ ЗАПИСАНЫ В GOOGLE SHEETS:', exportData.length - 1, 'покупок');
          console.log(`📊 Всего платежей: ${allPayments.length}`);
          console.log(`✅ Успешных платежей: ${successfulPayments.length}`);
          console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);
          console.log(`📝 Экспортировано покупок: ${exportData.length - 1}`);
          console.log(`🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_DOC_ID}`);
        } else {
          const errorText = await sheetsResponse.text();
          console.log('❌ Ошибка записи в Google Sheets:', errorText);
        }
      } else {
        console.log('❌ Ошибка получения токена Google Sheets');
      }
    } else {
      console.log('❌ Google Sheets не настроен');
    }
  } catch (error) {
    console.log('❌ Ошибка принудительной выгрузки:', error.message);
  }
}

// Запускаем функцию
forceExportAll();










