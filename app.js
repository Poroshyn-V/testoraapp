// Чистая версия для Vercel - без синтаксических ошибок
import express from 'express';
import pino from 'pino';
import Stripe from 'stripe';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const app = express();
const logger = pino({ level: 'info' });

// Environment variables
const ENV = {
  PORT: process.env.PORT || 3000,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: process.env.GOOGLE_SERVICE_PRIVATE_KEY,
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID,
  BOT_DISABLED: process.env.BOT_DISABLED === 'true',
       NOTIFICATIONS_DISABLED: process.env.NOTIFICATIONS_DISABLED === 'true', // По умолчанию включены
       AUTO_SYNC_DISABLED: process.env.AUTO_SYNC_DISABLED === 'true' // По умолчанию включены
};

// Простое хранилище для запоминания существующих покупок
const existingPurchases = new Set();

// Глобальное хранилище для отслеживания обработанных покупок в рамках одного запуска
const processedPurchaseIds = new Set();

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Функция для детекции аномалий в продажах
async function checkSalesAnomalies() {
  try {
    console.log('🚨 Проверяю аномалии в продажах...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю проверку аномалий');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    
    // Анализируем последние 2 часа
    const twoHoursAgo = new Date(utcPlus1.getTime() - 2 * 60 * 60 * 1000);
    const recentPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      const purchaseDate = new Date(createdLocal);
      return purchaseDate >= twoHoursAgo;
    });
    
    // Анализируем тот же период вчера
    const yesterdayStart = new Date(utcPlus1);
    yesterdayStart.setDate(utcPlus1.getDate() - 1);
    yesterdayStart.setHours(utcPlus1.getHours() - 2, 0, 0, 0);
    
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setHours(yesterdayStart.getHours() + 2, 0, 0, 0);
    
    const yesterdayPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      const purchaseDate = new Date(createdLocal);
      return purchaseDate >= yesterdayStart && purchaseDate <= yesterdayEnd;
    });
    
    console.log(`📊 Последние 2 часа: ${recentPurchases.length} покупок`);
    console.log(`📊 Вчера в то же время: ${yesterdayPurchases.length} покупок`);
    
    if (yesterdayPurchases.length === 0) {
      console.log('📭 Нет данных за вчера - пропускаю проверку аномалий');
      return;
    }
    
    // Рассчитываем изменение
    const changePercent = ((recentPurchases.length - yesterdayPurchases.length) / yesterdayPurchases.length * 100);
    const isSignificantDrop = changePercent <= -50; // Падение на 50% или больше
    const isSignificantSpike = changePercent >= 100; // Рост на 100% или больше
    
    if (isSignificantDrop || isSignificantSpike) {
      const alertType = isSignificantDrop ? '🚨 SALES DROP ALERT!' : '📈 SALES SPIKE ALERT!';
      const emoji = isSignificantDrop ? '⚠️' : '🚀';
      const direction = isSignificantDrop ? 'dropped' : 'spiked';
      
      const timeStr = utcPlus1.toLocaleTimeString('ru-RU', { 
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const alertText = `${alertType}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${emoji} Sales ${direction} ${Math.abs(changePercent).toFixed(1)}% in last 2 hours
📊 Current: ${recentPurchases.length} sales vs ${yesterdayPurchases.length} yesterday
🕐 Time: ${timeStr} UTC+1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${isSignificantDrop ? '🔍 Check your campaigns!' : '🎉 Great performance!'}`;
      
      console.log('📤 Отправляю алерт об аномалии:', alertText);
      
      // Отправляем в Telegram
      if (!ENV.NOTIFICATIONS_DISABLED && ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
        try {
          await sendTelegram(alertText);
          console.log('✅ Anomaly alert sent to Telegram');
        } catch (error) {
          console.error('❌ Ошибка отправки алерта об аномалии в Telegram:', error.message);
        }
      }
      
      // Отправляем в Slack
      if (!ENV.NOTIFICATIONS_DISABLED && ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
        try {
          await sendSlack(alertText);
          console.log('✅ Anomaly alert sent to Slack');
        } catch (error) {
          console.error('❌ Ошибка отправки алерта об аномалии в Slack:', error.message);
        }
      }
    } else {
      console.log(`📊 Продажи в норме: ${changePercent.toFixed(1)}% изменение`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка проверки аномалий:', error.message);
  }
}

// Функция для еженедельных отчетов
async function sendWeeklyReport() {
  try {
    console.log('📊 Генерирую еженедельный отчет...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю еженедельный отчет');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    // Получаем текущую неделю (понедельник - воскресенье)
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const currentWeekStart = new Date(utcPlus1);
    currentWeekStart.setDate(utcPlus1.getDate() - utcPlus1.getDay() + 1); // Понедельник
    currentWeekStart.setHours(0, 0, 0, 0);
    
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6); // Воскресенье
    currentWeekEnd.setHours(23, 59, 59, 999);
    
    // Получаем прошлую неделю для сравнения
    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(currentWeekStart.getDate() - 7);
    
    const lastWeekEnd = new Date(currentWeekEnd);
    lastWeekEnd.setDate(currentWeekEnd.getDate() - 7);
    
    console.log(`📅 Анализирую неделю: ${currentWeekStart.toISOString().split('T')[0]} - ${currentWeekEnd.toISOString().split('T')[0]}`);
    console.log(`📅 Сравниваю с неделей: ${lastWeekStart.toISOString().split('T')[0]} - ${lastWeekEnd.toISOString().split('T')[0]}`);
    
    // Фильтруем покупки текущей недели
    const currentWeekPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      const purchaseDate = new Date(createdLocal);
      return purchaseDate >= currentWeekStart && purchaseDate <= currentWeekEnd;
    });
    
    // Фильтруем покупки прошлой недели
    const lastWeekPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      const purchaseDate = new Date(createdLocal);
      return purchaseDate >= lastWeekStart && purchaseDate <= lastWeekEnd;
    });
    
    console.log(`📊 Текущая неделя: ${currentWeekPurchases.length} покупок`);
    console.log(`📊 Прошлая неделя: ${lastWeekPurchases.length} покупок`);
    
    if (currentWeekPurchases.length === 0) {
      console.log('📭 Нет покупок за текущую неделю - пропускаю еженедельный отчет');
      return;
    }
    
    // Анализируем текущую неделю
    let currentWeekRevenue = 0;
    const currentWeekGeo = new Map();
    const currentWeekCreatives = new Map();
    const dailyStats = new Map();
    
    for (const purchase of currentWeekPurchases) {
      const amount = parseFloat(purchase.get('Total Amount') || '0');
      currentWeekRevenue += amount;
      
      // GEO анализ
      const geo = purchase.get('GEO') || '';
      const country = geo.split(',')[0].trim();
      if (country) {
        currentWeekGeo.set(country, (currentWeekGeo.get(country) || 0) + 1);
      }
      
      // Креативы анализ
      const adName = purchase.get('Ad Name') || '';
      if (adName) {
        currentWeekCreatives.set(adName, (currentWeekCreatives.get(adName) || 0) + 1);
      }
      
      // Дневная статистика
      const createdLocal = purchase.get('Created Local (UTC+1)') || '';
      const day = createdLocal.split(' ')[0];
      if (day) {
        if (!dailyStats.has(day)) {
          dailyStats.set(day, { sales: 0, revenue: 0 });
        }
        const dayStats = dailyStats.get(day);
        dayStats.sales += 1;
        dayStats.revenue += amount;
      }
    }
    
    // Анализируем прошлую неделю для сравнения
    let lastWeekRevenue = 0;
    for (const purchase of lastWeekPurchases) {
      const amount = parseFloat(purchase.get('Total Amount') || '0');
      lastWeekRevenue += amount;
    }
    
    // Рассчитываем рост/падение
    const revenueGrowth = lastWeekRevenue > 0 ? 
      ((currentWeekRevenue - lastWeekRevenue) / lastWeekRevenue * 100).toFixed(1) : 0;
    const salesGrowth = lastWeekPurchases.length > 0 ? 
      ((currentWeekPurchases.length - lastWeekPurchases.length) / lastWeekPurchases.length * 100).toFixed(1) : 0;
    
    // ТОП-3 страны
    const topCountries = Array.from(currentWeekGeo.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    // ТОП-3 креатива
    const topCreatives = Array.from(currentWeekCreatives.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    // Дневная разбивка
    const dailyBreakdown = Array.from(dailyStats.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, stats]) => {
        const dayName = new Date(day).toLocaleDateString('en-US', { weekday: 'short' });
        return `• ${dayName} (${day}): ${stats.sales} sales, $${stats.revenue.toFixed(2)}`;
      });
    
    // Формируем отчет
    const weekStartStr = currentWeekStart.toISOString().split('T')[0];
    const weekEndStr = currentWeekEnd.toISOString().split('T')[0];
    
    const reportText = `📊 **Weekly Report (${weekStartStr} - ${weekEndStr})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 **Total Revenue:** $${currentWeekRevenue.toFixed(2)}
📈 **Revenue Growth:** ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}% vs last week
🛒 **Total Sales:** ${currentWeekPurchases.length}
📊 **Sales Growth:** ${salesGrowth > 0 ? '+' : ''}${salesGrowth}% vs last week
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 **Top Countries:**
${topCountries.map(([country, count], i) => `${i + 1}. ${country}: ${count} sales`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 **Top Creatives:**
${topCreatives.map(([creative, count], i) => `${i + 1}. ${creative}: ${count} sales`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 **Daily Breakdown:**
${dailyBreakdown.join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ **Report generated:** ${utcPlus1.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' })} UTC+1`;
    
    console.log('📤 Отправляю еженедельный отчет:', reportText);
    
    // Отправляем в Telegram
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      try {
        await sendTelegram(reportText);
        console.log('✅ Weekly report sent to Telegram');
      } catch (error) {
        console.error('❌ Ошибка отправки еженедельного отчета в Telegram:', error.message);
      }
    }
    
    // Отправляем в Slack
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      try {
        await sendSlack(reportText);
        console.log('✅ Weekly report sent to Slack');
      } catch (error) {
        console.error('❌ Ошибка отправки еженедельного отчета в Slack:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка генерации еженедельного отчета:', error.message);
  }
}

// Функция для ежедневной статистики за вчера (7:00 UTC+1)
async function sendDailyStatsAlert() {
  try {
    console.log('📊 Анализирую статистику за вчера...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю ежедневную статистику');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    // Получаем вчерашнюю дату в UTC+1
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const yesterday = new Date(utcPlus1);
    yesterday.setDate(utcPlus1.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`📅 Анализирую статистику за ${yesterdayStr} (UTC+1)`);
    
    // Фильтруем покупки за вчера
    const yesterdayPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      return createdLocal.includes(yesterdayStr);
    });
    
    console.log(`📊 Найдено ${yesterdayPurchases.length} покупок за вчера`);
    
    if (yesterdayPurchases.length === 0) {
      console.log('📭 Нет покупок за вчера - пропускаю ежедневную статистику');
      return;
    }
    
    // T1 страны (первый уровень)
    const t1Countries = ['US', 'CA', 'AU', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI', 'CH', 'AT', 'BE', 'IE', 'PT', 'GR', 'LU', 'MT', 'CY'];
    
    // Анализируем статистику
    const stats = {
      US: { main: 0, additional: 0, total: 0 },
      T1: { main: 0, additional: 0, total: 0 },
      WW: { main: 0, additional: 0, total: 0 }
    };
    
    for (const purchase of yesterdayPurchases) {
      const geo = purchase.get('GEO') || '';
      const amount = parseFloat(purchase.get('Total Amount') || '0');
      const country = geo.split(',')[0].trim();
      
      // Определяем категорию страны
      let category = 'WW';
      if (country === 'US') {
        category = 'US';
      } else if (t1Countries.includes(country)) {
        category = 'T1';
      }
      
      // Определяем тип покупки
      const isMain = amount <= 9.99;
      const isAdditional = amount > 9.99;
      
      if (isMain) {
        stats[category].main++;
      }
      if (isAdditional) {
        stats[category].additional++;
      }
      stats[category].total++;
    }
    
    // Формируем сообщение
    const alertText = `📊 **Daily Stats for ${yesterdayStr}**

🇺🇸 **US Market:**
• Main purchases (≤$9.99): ${stats.US.main}
• Additional sales (>$9.99): ${stats.US.additional}
• Total: ${stats.US.total}

🌍 **T1 Countries:**
• Main purchases (≤$9.99): ${stats.T1.main}
• Additional sales (>$9.99): ${stats.T1.additional}
• Total: ${stats.T1.total}

🌎 **WW (Rest of World):**
• Main purchases (≤$9.99): ${stats.WW.main}
• Additional sales (>$9.99): ${stats.WW.additional}
• Total: ${stats.WW.total}

📈 **Overall Total:** ${yesterdayPurchases.length} purchases
⏰ Report time: 07:00 UTC+1`;
    
    console.log('📤 Отправляю ежедневную статистику:', alertText);
    
    // Отправляем в Telegram
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      try {
        await sendTelegram(alertText);
        console.log('✅ Daily stats sent to Telegram');
      } catch (error) {
        console.error('❌ Ошибка отправки ежедневной статистики в Telegram:', error.message);
      }
    }
    
    // Отправляем в Slack
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      try {
        await sendSlack(alertText);
        console.log('✅ Daily stats sent to Slack');
      } catch (error) {
        console.error('❌ Ошибка отправки ежедневной статистики в Slack:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка ежедневной статистики:', error.message);
  }
}

// Функция для анализа креативов и отправки ТОП-5 алертов
async function sendCreativeAlert() {
  try {
    console.log('🎨 Анализирую креативы за сегодня...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю анализ креативов');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    // Получаем сегодняшнюю дату в UTC+1
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`📅 Анализирую креативы за ${todayStr} (UTC+1)`);
    
    // Фильтруем покупки за сегодня
    const todayPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      return createdLocal.includes(todayStr);
    });
    
    console.log(`📊 Найдено ${todayPurchases.length} покупок за сегодня`);
    
    if (todayPurchases.length === 0) {
      console.log('📭 Нет покупок за сегодня - пропускаю креатив алерт');
      return;
    }
    
    // Анализируем креативы (ad_name)
    const creativeStats = new Map();
    
    for (const purchase of todayPurchases) {
      const adName = purchase.get('Ad Name') || '';
      if (adName && adName.trim() !== '') {
        if (creativeStats.has(adName)) {
          creativeStats.set(adName, creativeStats.get(adName) + 1);
        } else {
          creativeStats.set(adName, 1);
        }
      }
    }
    
    if (creativeStats.size === 0) {
      console.log('📭 Нет креативов за сегодня - пропускаю креатив алерт');
      return;
    }
    
    // Сортируем по количеству покупок
    const sortedCreatives = Array.from(creativeStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    // Формируем ТОП-5 креативов
    const top5 = [];
    for (let i = 0; i < sortedCreatives.length; i++) {
      const [creative, count] = sortedCreatives[i];
      const rank = i + 1;
      top5.push(`${rank}. ${creative} - ${count} purchases`);
    }
    
    // Получаем текущее время UTC+1
    const now = new Date();
    const utcPlus1Now = new Date(now.getTime() + 60 * 60 * 1000);
    const timeStr = utcPlus1Now.toLocaleTimeString('ru-RU', { 
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Формируем сообщение
    const alertText = `🎨 **TOP-5 Creative Performance for today (${todayStr})**\n\n${top5.join('\n')}\n\n📈 Total purchases: ${todayPurchases.length}\n⏰ Report time: ${timeStr} UTC+1`;
    
    console.log('📤 Отправляю креатив алерт:', alertText);
    
    // Отправляем в Telegram
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      try {
        await sendTelegram(alertText);
        console.log('✅ Creative alert sent to Telegram');
      } catch (error) {
        console.error('❌ Ошибка отправки креатив алерта в Telegram:', error.message);
      }
    }
    
    // Отправляем в Slack
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      try {
        await sendSlack(alertText);
        console.log('✅ Creative alert sent to Slack');
      } catch (error) {
        console.error('❌ Ошибка отправки креатив алерта в Slack:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка анализа креативов:', error.message);
  }
}

// Функция для анализа GEO данных и отправки ТОП-3 алертов
async function sendGeoAlert() {
  try {
    console.log('🌍 Анализирую GEO данные за сегодня...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю GEO анализ');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    // Получаем сегодняшнюю дату в UTC+1
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`📅 Анализирую покупки за ${todayStr} (UTC+1)`);
    
    // Фильтруем покупки за сегодня
    const todayPurchases = rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      return createdLocal.includes(todayStr);
    });
    
    console.log(`📊 Найдено ${todayPurchases.length} покупок за сегодня`);
    
    if (todayPurchases.length === 0) {
      console.log('📭 Нет покупок за сегодня - пропускаю GEO алерт');
      return;
    }
    
    // Анализируем GEO данные
    const geoStats = new Map();
    
    for (const purchase of todayPurchases) {
      const geo = purchase.get('GEO') || 'Unknown';
      const country = geo.split(',')[0].trim(); // Берем только страну
      
      if (geoStats.has(country)) {
        geoStats.set(country, geoStats.get(country) + 1);
      } else {
        geoStats.set(country, 1);
      }
    }
    
    // Сортируем по количеству покупок
    const sortedGeo = Array.from(geoStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    // Формируем ТОП-3
    const top3 = [];
    for (const [country, count] of sortedGeo) {
      const flag = getCountryFlag(country);
      top3.push(`${flag} ${country} - ${count}`);
    }
    
    // Добавляем WW (все остальные)
    const totalToday = todayPurchases.length;
    const top3Total = sortedGeo.reduce((sum, [, count]) => sum + count, 0);
    const wwCount = totalToday - top3Total;
    
    if (wwCount > 0) {
      top3.push(`🌍 WW - ${wwCount}`);
    }
    
    // Формируем сообщение
    const alertText = `📊 **TOP-3 GEO for today (${todayStr})**\n\n${top3.join('\n')}\n\n📈 Total purchases: ${totalToday}`;
    
    console.log('📤 Отправляю GEO алерт:', alertText);
    
    // Отправляем в Telegram
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      try {
        await sendTelegram(alertText);
        console.log('✅ GEO алерт отправлен в Telegram');
      } catch (error) {
        console.error('❌ Ошибка отправки GEO алерта в Telegram:', error.message);
      }
    }
    
    // Отправляем в Slack
    if (!ENV.NOTIFICATIONS_DISABLED && ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      try {
        await sendSlack(alertText);
        console.log('✅ GEO алерт отправлен в Slack');
      } catch (error) {
        console.error('❌ Ошибка отправки GEO алерта в Slack:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка GEO анализа:', error.message);
  }
}

// Функция для получения флага страны
function getCountryFlag(country) {
  const flags = {
    'US': '🇺🇸',
    'CA': '🇨🇦', 
    'AU': '🇦🇺',
    'GB': '🇬🇧',
    'DE': '🇩🇪',
    'FR': '🇫🇷',
    'IT': '🇮🇹',
    'ES': '🇪🇸',
    'NL': '🇳🇱',
    'SE': '🇸🇪',
    'NO': '🇳🇴',
    'DK': '🇩🇰',
    'FI': '🇫🇮',
    'PL': '🇵🇱',
    'CZ': '🇨🇿',
    'HU': '🇭🇺',
    'RO': '🇷🇴',
    'BG': '🇧🇬',
    'HR': '🇭🇷',
    'SI': '🇸🇮',
    'SK': '🇸🇰',
    'LT': '🇱🇹',
    'LV': '🇱🇻',
    'EE': '🇪🇪',
    'IE': '🇮🇪',
    'PT': '🇵🇹',
    'GR': '🇬🇷',
    'CY': '🇨🇾',
    'MT': '🇲🇹',
    'LU': '🇱🇺',
    'AT': '🇦🇹',
    'BE': '🇧🇪',
    'CH': '🇨🇭',
    'IS': '🇮🇸',
    'LI': '🇱🇮',
    'MC': '🇲🇨',
    'SM': '🇸🇲',
    'VA': '🇻🇦',
    'AD': '🇦🇩',
    'JP': '🇯🇵',
    'KR': '🇰🇷',
    'CN': '🇨🇳',
    'IN': '🇮🇳',
    'BR': '🇧🇷',
    'MX': '🇲🇽',
    'AR': '🇦🇷',
    'CL': '🇨🇱',
    'CO': '🇨🇴',
    'PE': '🇵🇪',
    'VE': '🇻🇪',
    'UY': '🇺🇾',
    'PY': '🇵🇾',
    'BO': '🇧🇴',
    'EC': '🇪🇨',
    'GY': '🇬🇾',
    'SR': '🇸🇷',
    'FK': '🇫🇰',
    'GF': '🇬🇫',
    'ZA': '🇿🇦',
    'EG': '🇪🇬',
    'NG': '🇳🇬',
    'KE': '🇰🇪',
    'GH': '🇬🇭',
    'MA': '🇲🇦',
    'TN': '🇹🇳',
    'DZ': '🇩🇿',
    'LY': '🇱🇾',
    'SD': '🇸🇩',
    'ET': '🇪🇹',
    'UG': '🇺🇬',
    'TZ': '🇹🇿',
    'RW': '🇷🇼',
    'BI': '🇧🇮',
    'DJ': '🇩🇯',
    'SO': '🇸🇴',
    'ER': '🇪🇷',
    'SS': '🇸🇸',
    'CF': '🇨🇫',
    'TD': '🇹🇩',
    'NE': '🇳🇪',
    'ML': '🇲🇱',
    'BF': '🇧🇫',
    'CI': '🇨🇮',
    'GN': '🇬🇳',
    'SN': '🇸🇳',
    'GM': '🇬🇲',
    'GW': '🇬🇼',
    'CV': '🇨🇻',
    'ST': '🇸🇹',
    'AO': '🇦🇴',
    'ZM': '🇿🇲',
    'ZW': '🇿🇼',
    'BW': '🇧🇼',
    'NA': '🇳🇦',
    'SZ': '🇸🇿',
    'LS': '🇱🇸',
    'MW': '🇲🇼',
    'MZ': '🇲🇿',
    'MG': '🇲🇬',
    'MU': '🇲🇺',
    'SC': '🇸🇨',
    'KM': '🇰🇲',
    'YT': '🇾🇹',
    'RE': '🇷🇪',
    'Unknown': '❓',
    'N/A': '❓'
  };
  
  return flags[country] || '🌍';
}

// Функция для загрузки и запоминания существующих покупок
async function loadExistingPurchases() {
  try {
    console.log('🔄 Загружаю существующие покупки из Google Sheets...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Google Sheets не настроен - пропускаю загрузку');
      return;
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📋 Найдено ${rows.length} строк в Google Sheets`);
    console.log('📊 Доступные колонки:', sheet.headerValues);
    
    // Очищаем старое хранилище
    existingPurchases.clear();
    
    // Загружаем все существующие Purchase ID
    for (const row of rows) {
      const purchaseId = row.get('Purchase ID') || row.get('purchase_id') || '';
      if (purchaseId) {
        existingPurchases.add(purchaseId);
        // Убираем детальные логи для каждой покупки
      } else {
        console.log(`⚠️ Пустой Purchase ID в строке:`, row._rawData);
      }
    }
    
    console.log(`✅ Загружено ${existingPurchases.size} существующих покупок в память`);
    console.log('📝 Список покупок:', Array.from(existingPurchases).slice(0, 5), '...');
    
  } catch (error) {
    console.error('❌ Ошибка загрузки существующих покупок:', error.message);
  }
}

// Middleware
app.use(express.json());

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  message: 'Stripe Ops API is running!',
  status: 'ok',
  timestamp: new Date().toISOString(),
  endpoints: ['/api/test', '/api/sync-payments', '/api/geo-alert', '/api/creative-alert', '/api/daily-stats', '/api/weekly-report', '/api/anomaly-check', '/api/memory-status', '/api/check-duplicates', '/health', '/webhook/stripe']
}));

// Исправляем ошибки favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/favicon.png', (req, res) => {
  res.status(204).end();
});

// Health check
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Endpoint для загрузки существующих покупок
app.get('/api/load-existing', async (req, res) => {
  try {
    await loadExistingPurchases();
    res.json({
      success: true,
      message: `Loaded ${existingPurchases.size} existing purchases`,
      count: existingPurchases.size,
      purchases: Array.from(existingPurchases).slice(0, 10) // Показываем первые 10
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для проверки состояния памяти
app.get('/api/memory-status', (req, res) => {
  res.json({
    success: true,
    message: `Memory contains ${existingPurchases.size} purchases`,
    count: existingPurchases.size,
    purchases: Array.from(existingPurchases).slice(0, 20), // Показываем первые 20
    auto_sync_disabled: ENV.AUTO_SYNC_DISABLED,
    notifications_disabled: ENV.NOTIFICATIONS_DISABLED
  });
});

// Endpoint для проверки дубликатов в таблице
app.get('/api/check-duplicates', async (req, res) => {
  try {
    console.log('🔍 Проверяю дубликаты в Google Sheets...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      return res.status(500).json({
        success: false,
        message: 'Google Sheets not configured'
      });
    }
    
    const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📋 Проверяю ${rows.length} строк на дубликаты...`);
    
    // Ищем дубликаты по email + дата + сумма
    const duplicates = [];
    const seen = new Map();
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const email = row.get('Email') || '';
      const date = row.get('Created Local (UTC+1)') || '';
      const amount = row.get('Total Amount') || '';
      
      if (email && date && amount) {
        const key = `${email}_${date}_${amount}`;
        
        if (seen.has(key)) {
          duplicates.push({
            row: i + 1,
            email: email,
            date: date,
            amount: amount,
            purchaseId: row.get('Purchase ID') || '',
            duplicateOf: seen.get(key)
          });
        } else {
          seen.set(key, i + 1);
        }
      }
    }
    
    console.log(`🔍 Найдено ${duplicates.length} дубликатов`);
    
    res.json({
      success: true,
      message: `Found ${duplicates.length} duplicates in ${rows.length} rows`,
      total_rows: rows.length,
      duplicates_count: duplicates.length,
      duplicates: duplicates.slice(0, 10) // Показываем первые 10
    });
    
  } catch (error) {
    console.error('❌ Error checking duplicates:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для ручного запуска GEO алерта
app.get('/api/geo-alert', async (req, res) => {
  try {
    console.log('🌍 Ручной запуск GEO алерта...');
    await sendGeoAlert();
    res.json({
      success: true,
      message: 'GEO alert sent successfully'
    });
  } catch (error) {
    console.error('❌ GEO alert error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для ручного запуска ежедневной статистики
app.get('/api/daily-stats', async (req, res) => {
  try {
    console.log('📊 Ручной запуск ежедневной статистики...');
    await sendDailyStatsAlert();
    res.json({
      success: true,
      message: 'Daily stats alert sent successfully'
    });
  } catch (error) {
    console.error('❌ Daily stats error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для ручного запуска креатив алерта
app.get('/api/creative-alert', async (req, res) => {
  try {
    console.log('🎨 Ручной запуск креатив алерта...');
    await sendCreativeAlert();
    res.json({
      success: true,
      message: 'Creative alert sent successfully'
    });
  } catch (error) {
    console.error('❌ Creative alert error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для ручного запуска еженедельного отчета
app.get('/api/weekly-report', async (req, res) => {
  try {
    console.log('📊 Ручной запуск еженедельного отчета...');
    await sendWeeklyReport();
    res.json({
      success: true,
      message: 'Weekly report sent successfully'
    });
  } catch (error) {
    console.error('❌ Weekly report error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для ручной проверки аномалий
app.get('/api/anomaly-check', async (req, res) => {
  try {
    console.log('🚨 Ручная проверка аномалий...');
    await checkSalesAnomalies();
    res.json({
      success: true,
      message: 'Anomaly check completed'
    });
  } catch (error) {
    console.error('❌ Anomaly check error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для просмотра последних покупок из Stripe
app.get('/api/last-purchases', async (req, res) => {
  try {
    console.log('📊 Получаю последние покупки из Stripe...');
    
    // Get payments from last 7 days
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    const payments = await stripe.paymentIntents.list({
      limit: 5,
      created: {
        gte: sevenDaysAgo
      }
    });
    
    if (payments.data.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No payments found',
        purchases: [] 
      });
    }
    
    // Filter successful payments and get customer data (excluding Subscription updates)
    const successfulPayments = payments.data.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      
      // Exclude Subscription updates - they are not new purchases from ads
      if (p.description && p.description.toLowerCase().includes('subscription update')) {
        return false;
      }
      
      return true;
    });
    const purchases = [];
    
    for (const payment of successfulPayments) {
      let customer = null;
      try {
        customer = await stripe.customers.retrieve(payment.customer);
        if (customer && 'deleted' in customer && customer.deleted) {
          customer = null;
        }
      } catch (err) {
        console.error(`Error retrieving customer ${payment.customer}:`, err);
      }
      
      const purchase = {
        payment_id: payment.id,
        amount: (payment.amount / 100).toFixed(2),
        currency: payment.currency.toUpperCase(),
        status: payment.status,
        created: new Date(payment.created * 1000).toISOString(),
        customer_id: customer?.id || 'N/A',
        customer_email: customer?.email || payment.receipt_email || 'N/A',
        customer_name: customer?.name || 'N/A',
        metadata: payment.metadata,
        customer_metadata: customer?.metadata || {}
      };
      
      purchases.push(purchase);
    }
    
    res.json({
      success: true,
      message: `Found ${purchases.length} recent purchases`,
      count: purchases.length,
      purchases: purchases
    });
    
  } catch (error) {
    console.error('❌ Error fetching last purchases:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ПРИНУДИТЕЛЬНАЯ АКТИВНОСТЬ чтобы Vercel не засыпал
app.get('/ping', (_req, res) => {
  console.log('💓 PING: Поддерживаю активность Vercel...');
  console.log('🕐 Время:', new Date().toISOString());
  res.status(200).json({ 
    status: 'alive', 
    timestamp: new Date().toISOString(),
    message: 'Vercel не заснет!' 
  });
});

// ПРИНУДИТЕЛЬНАЯ АВТОСИНХРОНИЗАЦИЯ при каждом запросе
app.get('/auto-sync', async (req, res) => {
  try {
    console.log('🔄 Принудительная автоСинхронизация...');
    
    // Используем тот же endpoint что и основной sync
    const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      console.error('❌ Auto-sync request failed:', response.status, response.statusText);
      return res.status(500).json({ error: 'Auto-sync request failed' });
    }
    
    const result = await response.json();
    console.log('✅ Auto-sync completed:', result);
    
    res.json({ 
      success: true, 
      message: `Auto-sync completed! ${result.processed || 0} NEW purchases processed`,
      processed: result.processed || 0,
      total_groups: result.total_groups || 0
    });
    
  } catch (error) {
    console.error('Auto-sync failed:', error.message);
    res.status(500).json({ error: 'Auto-sync failed: ' + error.message });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Vercel test successful!',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url
  });
});

// GET endpoint for sync-payments (for testing)
app.get('/api/sync-payments', (req, res) => {
  res.json({ 
    message: 'Sync endpoint available - use POST method for actual sync',
    timestamp: new Date().toISOString(),
    method: req.method,
    note: 'Use POST /api/sync-payments to trigger sync'
  });
});

// Stripe webhook endpoint
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, ENV.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      console.log('🎉 Webhook received:', event.type);
      console.log('✅ Webhook processed - automatic sync will handle this');
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update existing purchases endpoint
app.post('/api/update-existing', async (req, res) => {
  try {
    console.log('🔄 Starting update of existing purchases...');
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      return res.status(500).json({
        success: false,
        message: 'Google Sheets not configured'
      });
    }
    
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📊 Found ${rows.length} existing rows`);
    
    let updatedCount = 0;
    
    // Process each row and check for missing upsells
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      if (!customerId || customerId === 'N/A' || !email || email === 'N/A') {
        continue;
      }
      
      console.log(`🔍 Checking customer: ${email} (${customerId})`);
      
      // Get all payments for this customer from Stripe
      const payments = await stripe.paymentIntents.list({
        customer: customerId,
        limit: 100
      });
      
      const successfulPayments = payments.data.filter(p => {
        if (p.status !== 'succeeded' || !p.customer) return false;
        
        // Exclude Subscription updates - they are not new purchases from ads
        if (p.description && p.description.toLowerCase().includes('subscription update')) {
          return false;
        }
        
        return true;
      });
      
      if (successfulPayments.length <= 1) {
        console.log(`   ⏭️ Only ${successfulPayments.length} payment, skipping`);
        continue;
      }
      
      // Group payments using our improved logic (within 1 hour)
      const groupedPayments = [];
      const processedPayments = new Set();
      
      for (const payment of successfulPayments) {
        if (processedPayments.has(payment.id)) continue;
        
        const group = [payment];
        processedPayments.add(payment.id);
        
        // Find related payments within 1 hour
        for (const otherPayment of successfulPayments) {
          if (processedPayments.has(otherPayment.id)) continue;
          
          const timeDiff = Math.abs(payment.created - otherPayment.created);
          const hoursDiff = timeDiff / 3600;
          
          if (hoursDiff <= 3) {
            group.push(otherPayment);
            processedPayments.add(otherPayment.id);
          }
        }
        
        groupedPayments.push(group);
      }
      
      // Check if we have multiple groups that should be combined
      if (groupedPayments.length > 1) {
        console.log(`   ⚠️ Found ${groupedPayments.length} separate groups, should be 1!`);
        
        // Calculate total amount and payment count
        let totalAmount = 0;
        let totalPayments = 0;
        const allPaymentIds = [];
        
        for (const group of groupedPayments) {
          for (const payment of group) {
            totalAmount += payment.amount;
            totalPayments++;
            allPaymentIds.push(payment.id);
          }
        }
        
        // Update the row
        row.set('Total Amount', (totalAmount / 100).toFixed(2));
        row.set('Payment Count', totalPayments);
        row.set('Payment Intent IDs', allPaymentIds.join(', '));
        
        await row.save();
        console.log(`   ✅ Updated: $${(totalAmount / 100).toFixed(2)} (${totalPayments} payments)`);
        updatedCount++;
      }
    }
    
    console.log(`🎉 Update completed! Updated ${updatedCount} records`);
    
    res.json({
      success: true,
      message: `Updated ${updatedCount} existing records`,
      updated: updatedCount
    });
    
  } catch (error) {
    console.error('❌ Error updating existing purchases:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Sync payments endpoint
app.post('/api/sync-payments', async (req, res) => {
  try {
    console.log('🔄 Starting payment sync...');
    
    // Загружаем существующие покупки в память
    console.log('🔄 Вызываю loadExistingPurchases...');
    await loadExistingPurchases();
    console.log(`📝 В памяти сейчас: ${existingPurchases.size} покупок`);
    
    // Очищаем глобальное хранилище обработанных покупок для нового запуска
    processedPurchaseIds.clear();
    console.log(`🔄 Очищено processedPurchaseIds для нового запуска`);
    
    // Get payments from last 7 days
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    const payments = await stripe.paymentIntents.list({
      limit: 100,
      created: {
        gte: sevenDaysAgo
      }
    });
    
    if (payments.data.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No payments found',
        processed: 0 
      });
    }
    
    // Filter successful payments and exclude Subscription updates
    const successfulPayments = payments.data.filter(p => {
      if (p.status !== 'succeeded' || !p.customer) return false;
      
      // Exclude Subscription updates - they are not new purchases from ads
      if (p.description && p.description.toLowerCase().includes('subscription update')) {
        console.log(`⏭️ Skipping Subscription update: ${p.id}`);
        return false;
      }
      
      return true;
    });
    console.log(`📊 Found ${successfulPayments.length} successful payments (excluding Subscription updates)`);
    
    // ГРУППИРУЕМ ПОКУПКИ: по customer ID (включая апсейлы в течение 24 часов)
    const groupedPurchases = new Map();
    
    for (const payment of successfulPayments) {
      if (payment.customer) {
        let customer = null;
        try {
          customer = await stripe.customers.retrieve(payment.customer);
          if (customer && 'deleted' in customer && customer.deleted) {
            customer = null;
          }
        } catch (err) {
          console.error(`Error retrieving customer ${payment.customer}:`, err);
        }

        const customerId = customer?.id || 'unknown_customer';
        
        // Проверяем, есть ли уже группа для этого customer'а
        let existingGroup = null;
        for (const [key, group] of groupedPurchases.entries()) {
          if (group.customer?.id === customerId) {
        // Проверяем, что платеж в течение 1 часа от первого платежа (для апсейлов)
        const firstPaymentTime = group.firstPayment.created * 1000;
        const currentPaymentTime = payment.created * 1000;
        const timeDiff = Math.abs(currentPaymentTime - firstPaymentTime);
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        if (hoursDiff <= 1) {
              existingGroup = group;
              break;
            }
          }
        }

        if (existingGroup) {
          // Добавляем к существующей группе
          existingGroup.payments.push(payment);
          existingGroup.totalAmount += payment.amount;
        } else {
          // Создаем новую группу
          const groupKey = `${customerId}_${payment.created}`;
          groupedPurchases.set(groupKey, {
            customer,
            payments: [payment],
            totalAmount: payment.amount,
            firstPayment: payment
          });
        }
      }
    }

    console.log(`📊 Сгруппировано покупок: ${groupedPurchases.size}`);

    let newPurchases = 0;
    const processedPurchases = [];
    // processedPurchaseIds теперь глобальная переменная

    // Initialize Google Sheets
    console.log('🔍 Google Sheets debug info:');
    console.log('Email exists:', !!ENV.GOOGLE_SERVICE_EMAIL);
    console.log('Private key exists:', !!ENV.GOOGLE_SERVICE_PRIVATE_KEY);
    console.log('Doc ID exists:', !!ENV.GOOGLE_SHEETS_DOC_ID);
    
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Missing Google Sheets environment variables');
      return res.status(500).json({
        success: false,
        message: 'Google Sheets not configured - missing environment variables'
      });
    }
    
    let serviceAccountAuth;
    let doc;
    let sheet;
    let rows = [];
    
    try {
      // ПРОСТАЯ ОБРАБОТКА: используем ключ как есть
      const privateKey = ENV.GOOGLE_SERVICE_PRIVATE_KEY;
      
      if (!privateKey) {
        throw new Error('Google Sheets private key not configured');
      }
      
      console.log('✅ Google Sheets key loaded successfully');
      
      serviceAccountAuth = new JWT({
        email: ENV.GOOGLE_SERVICE_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      
      doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
      await doc.loadInfo();
      console.log(`✅ Google Sheets подключен: ${doc.title}`);
      
      sheet = doc.sheetsByIndex[0];
      if (!sheet) {
        console.error('❌ No sheets found in document!');
        return res.status(500).json({ success: false, message: 'Sheet not found' });
      }
      
      console.log(`📄 Using sheet: "${sheet.title}"`);
      console.log(`📄 Sheet ID: ${sheet.sheetId}`);
      console.log(`📄 Sheet URL: ${sheet.url}`);
      
      // Load existing rows
      rows = await sheet.getRows();
      console.log(`📋 Existing rows in sheet: ${rows.length}`);
      
      // СТРОГАЯ ПРОВЕРКА: показываем все данные для отладки
      if (rows.length > 0) {
        console.log('📄 Google Sheets debug info:');
        console.log('📄 Total rows:', rows.length);
        console.log('📄 Available columns:', sheet.headerValues);
        console.log('📄 First 3 rows:');
        for (let i = 0; i < Math.min(3, rows.length); i++) {
          const row = rows[i];
          console.log(`Row ${i + 1}:`);
          console.log(`  - Purchase ID: "${row.get('Purchase ID')}"`);
          console.log(`  - purchase_id: "${row.get('purchase_id')}"`);
          console.log(`  - Customer ID: "${row.get('Customer ID')}"`);
          console.log(`  - Email: "${row.get('Email')}"`);
          console.log(`  - All data:`, row._rawData);
        }
      }
      
    } catch (error) {
      console.error('❌ Google Sheets error:', error.message);
      console.log('⚠️ Google Sheets not available - STOPPING SYNC to prevent duplicates');
      
      // Если Google Sheets не работает, НЕ ОБРАБАТЫВАЕМ ПОКУПКИ ВООБЩЕ
      return res.status(500).json({
        success: false,
        message: 'Google Sheets not available - sync stopped to prevent duplicates',
        error: error.message
      });
    }

    // СТРОГАЯ ПРОВЕРКА: если Google Sheets пустой, НЕ ОБРАБАТЫВАЕМ
    if (rows.length === 0) {
      console.log('⚠️ Google Sheets is EMPTY - STOPPING SYNC to prevent duplicates');
      return res.status(500).json({
        success: false,
        message: 'Google Sheets is empty - sync stopped to prevent duplicates',
        rows_count: 0
      });
    }

    // ПРОСТАЯ РАБОЧАЯ ЛОГИКА С RENDER: проверяем каждую покупку индивидуально
    console.log(`✅ Processing ${groupedPurchases.size} grouped purchases against ${rows.length} existing rows in Google Sheets`);
    
    // Упрощенная отладка Google Sheets
    console.log(`📊 Google Sheets: ${rows.length} строк, колонки: ${sheet.headerValues.length}`);

    // ПРОСТАЯ ЛОГИКА: обрабатываем каждую группу покупок
    for (const [dateKey, group] of groupedPurchases.entries()) {
      try {
        const customer = group.customer;
        const firstPayment = group.firstPayment;
        const m = { ...firstPayment.metadata, ...(customer?.metadata || {}) };

        // ПРОСТАЯ ЛОГИКА: используем timestamp для уникальности
        const purchaseId = `purchase_${customer?.id || 'unknown'}_${(customer?.id || 'unknown').replace('cus_', '')}`;

        // УПРОЩЕННОЕ ЛОГИРОВАНИЕ ДЛЯ ОТЛАДКИ ДУБЛЕЙ
        console.log(`🔍 Processing: ${purchaseId} (${group.payments.length} payments)`);
        
        // ПРОВЕРКА ДУБЛИКАТОВ: только по Purchase ID
        const existsInSheets = rows.some((row) => {
          const rowPurchaseId = row.get('Purchase ID') || '';
          return rowPurchaseId === purchaseId;
        });
        
        if (existsInSheets) {
          console.log(`⏭️ SKIP: ${purchaseId} already exists in sheets`);
          continue; // Пропускаем существующие
        }
        
        // Дополнительная проверка: не обрабатывали ли мы уже эту покупку в этом запуске
        if (processedPurchaseIds.has(purchaseId)) {
          console.log(`⏭️ SKIP: ${purchaseId} already processed in this run`);
          continue;
        }
        
        // Отмечаем как обработанную
        processedPurchaseIds.add(purchaseId);
        console.log(`✅ NEW: ${purchaseId} - processing...`);
        
        // НЕ ОТПРАВЛЯЕМ УВЕДОМЛЕНИЯ СРАЗУ - сначала сохраняем в Google Sheets

        // ИСПРАВЛЕНО: GEO data using customer metadata (correct format: Country, City)
        const customerMetadata = customer?.metadata || {};
        let geoCountry = customerMetadata.geo_country || customer?.address?.country || 'N/A';
        let geoCity = customerMetadata.geo_city || '';
        const country = geoCity ? `${geoCountry}, ${geoCity}` : geoCountry;
        
        // GEO формат: Country, City

        // CORRECT UTC+1 format: "2025-10-11 20:02:40.000 UTC+1"
        const createdUtc = new Date(firstPayment.created * 1000).toISOString();
        const createdUtcPlus1 = new Date(firstPayment.created * 1000 + 60 * 60 * 1000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ' UTC+1');

        const purchaseData = {
          created_at: createdUtc,
          created_local_utc_plus_1: createdUtcPlus1, // CORRECT format: "2025-10-11 20:02:40.000 UTC+1"
          purchase_id: purchaseId,
          payment_status: 'succeeded',
          amount: (group.totalAmount / 100).toFixed(2),
          currency: (firstPayment.currency || 'usd').toUpperCase(),
          email: customer?.email || firstPayment.receipt_email || 'N/A',
          country: country,
          gender: m.gender || '',
          age: m.age || '',
          product_tag: m.product_tag || '',
          creative_link: m.creative_link || '',
          utm_source: customerMetadata.utm_source || '',
          utm_medium: customerMetadata.utm_medium || '',
          utm_campaign: customerMetadata.utm_campaign || '',
          utm_content: customerMetadata.utm_content || '',
          utm_term: customerMetadata.utm_term || '',
          platform_placement: customerMetadata.platform_placement || '',
          ad_name: customerMetadata.ad_name || '',
          adset_name: customerMetadata.adset_name || '',
          campaign_name: customerMetadata.campaign_name || customerMetadata.utm_campaign || '',
          web_campaign: m.web_campaign || '',
          customer_id: customer?.id || 'N/A',
          client_reference_id: firstPayment.client_secret || '',
          mode: firstPayment.setup_future_usage ? 'setup' : 'payment',
          status: firstPayment.status || '',
          raw_metadata_json: JSON.stringify(m),
          payment_count: group.payments.length // Количество платежей в группе
        };

        // Валидация данных покупки

        // Добавляем в Google Sheets только если подключение работает
        let savedToSheets = false;
        if (sheet) {
          try {
            // Добавляем задержку для избежания превышения лимитов Google Sheets API
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 секунда задержки
            
            // Создаем данные в том же формате что уже есть в таблице
            // ИСПРАВЛЕНО: ПРАВИЛЬНОЕ UTC+1 ВРЕМЯ
            const utcTime = new Date(purchaseData.created_at);
            const utcPlus1 = new Date(utcTime.getTime() + 60 * 60 * 1000);
            const utcPlus1Formatted = utcPlus1.toISOString().replace('T', ' ').replace('Z', ' UTC+1');
            
            const rowData = {
              'Purchase ID': purchaseData.purchase_id, // Уникальный ID группы
              'Payment Intent IDs': group.payments.map(p => p.id).join(', '), // Все Payment Intent ID в группе
              'Total Amount': purchaseData.amount,
              'Currency': purchaseData.currency,
              'Status': purchaseData.payment_status,
              'Created UTC': purchaseData.created_at,
              'Created Local (UTC+1)': utcPlus1Formatted,
              'Customer ID': purchaseData.customer_id,
              'Email': purchaseData.email,
              'GEO': purchaseData.country,
              'UTM Source': purchaseData.utm_source,
              'UTM Medium': purchaseData.utm_medium,
              'UTM Campaign': purchaseData.utm_campaign,
              'UTM Content': purchaseData.utm_content,
              'UTM Term': purchaseData.utm_term,
              'Ad Name': purchaseData.ad_name,
              'Adset Name': purchaseData.adset_name,
              'Payment Count': purchaseData.payment_count
            };
            
            // Сохраняем данные в Google Sheets
            await sheet.addRow(rowData);
            console.log(`✅ Saved: ${purchaseId}`);
            savedToSheets = true;
            
            // Добавляем задержку после сохранения для избежания превышения лимитов
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды задержки
          } catch (error) {
            console.error('❌ Error saving to Google Sheets:', error.message);
            console.error('❌ Error details:', error);
            console.log('⚠️ Purchase data:', purchaseData);
            savedToSheets = false;
          }
        } else {
          console.log(`⚠️ Google Sheets not available, skipping: ${purchaseId}`);
          savedToSheets = false;
        }

        // ОТПРАВЛЯЕМ УВЕДОМЛЕНИЯ В TELEGRAM И SLACK
        if (!ENV.NOTIFICATIONS_DISABLED) {
          try {
            // Telegram notification
            if (ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
              const telegramText = formatTelegram(purchaseData, m);
              await sendTelegram(telegramText);
              console.log(`📱 Telegram notification sent for ${purchaseId}`);
            }
            
            // Slack notification
            if (ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
              const slackText = formatSlack(purchaseData, m);
              await sendSlack(slackText);
              console.log(`💬 Slack notification sent for ${purchaseId}`);
            }
          } catch (error) {
            console.error('❌ Error sending notifications:', error.message);
          }
        } else {
          console.log('🚫 Notifications disabled');
        }

        // ИСПРАВЛЕНО: Увеличиваем счетчики ТОЛЬКО если покупка действительно сохранена
        if (savedToSheets) {
          newPurchases++;
          processedPurchases.push({
            purchase_id: purchaseId,
            email: purchaseData.email,
            amount: purchaseData.amount,
            payment_count: purchaseData.payment_count,
            payment_intent_ids: group.payments.map(p => p.id)
          });
        }
      } catch (error) {
        console.error(`Error processing purchase ${dateKey}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      message: `Sync completed! Processed ${newPurchases} purchase(s)`,
      total_groups: groupedPurchases.size,
      total_payments: successfulPayments.length,
      processed: newPurchases,
      purchases: processedPurchases
    });
    
  } catch (error) {
    console.error('❌ Sync error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Sync failed',
      error: error.message
    });
  }
});

// Telegram functions
async function sendTelegram(text) {
  if (!ENV.TELEGRAM_BOT_TOKEN || !ENV.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping notification');
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
      })
    });

    const result = await response.json();
    if (result.ok) {
      console.log('Telegram notification sent successfully');
    } else {
      console.error('Telegram API error:', result.description);
    }
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}

function formatTelegram(purchaseData, customerMetadata = {}) {
  const m = { ...purchaseData, ...customerMetadata };
  const amount = parseFloat(purchaseData.amount);
  const currency = purchaseData.currency;
  const email = purchaseData.email;
  const paymentId = purchaseData.purchase_id;
  const paymentCount = m.payment_count || '1 payment';
  
  const country = m.country || '';
  const platform_placement = m.platform_placement || '';
  const ad_name = m.ad_name || '';
  const adset_name = m.adset_name || '';
  const campaign_name = m.campaign_name || m.utm_campaign || '';

  // English format for Telegram notifications for Stripe purchases
  const lines = [
    `🟢 Purchase ${paymentId} was processed!`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💳 Payment Method: Card`,
    `💰 Amount: ${amount} ${currency}`,
    `🏷️ Payments: ${paymentCount}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📧 Email: ${email}`,
    `📍 Location: ${country}`,
    `🔗 Link: quiz.testora.pro/iq1`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 Campaign Data:`,
    platform_placement && `• Platform: ${platform_placement}`,
    ad_name && `• Ad: ${ad_name}`,
    adset_name && `• Adset: ${adset_name}`,
    campaign_name && `• Campaign: ${campaign_name}`
  ].filter(Boolean); // Remove empty lines

  let text = lines.join('\n');
  if (text.length > 4096) text = text.slice(0, 4093) + '...';
  return text;
}

// Slack functions
async function sendSlack(text) {
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

function formatSlack(purchaseData, customerMetadata = {}) {
  const m = { ...purchaseData, ...customerMetadata };
  const amount = parseFloat(purchaseData.amount);
  const currency = purchaseData.currency;
  const email = purchaseData.email;
  const paymentId = purchaseData.purchase_id;
  const paymentCount = m.payment_count || '1 payment';
  
  const country = m.country || '';
  const platform_placement = m.platform_placement || '';
  const ad_name = m.ad_name || '';
  const adset_name = m.adset_name || '';
  const campaign_name = m.campaign_name || m.utm_campaign || '';
  
  return `🟢 *Purchase ${paymentId} was processed!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *Payment Method:* Card
💰 *Amount:* ${amount} ${currency}
🏷️ *Payments:* ${paymentCount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 *Email:* ${email}
📍 *Location:* ${country}
🔗 *Link:* quiz.testora.pro/iq1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *Campaign Data:*
${platform_placement ? `• Platform: ${platform_placement}` : ''}
${ad_name ? `• Ad: ${ad_name}` : ''}
${adset_name ? `• Adset: ${adset_name}` : ''}
${campaign_name ? `• Campaign: ${campaign_name}` : ''}`;
}

// Start server
app.listen(ENV.PORT, () => {
  logger.info(`Server listening on port ${ENV.PORT}`);
  console.log('🔄 Starting automatic sync every 2 minutes...');
  
  // First run after 30 seconds
  setTimeout(async () => {
    try {
      console.log('🚀 Running initial sync...');
      const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      console.log('Initial sync completed:', result);
    } catch (error) {
      console.error('Initial sync failed:', error.message);
    }
  }, 30000);
  
  // Then every 2 minutes
        // АВТОСИНХРОНИЗАЦИЯ ВКЛЮЧЕНА - УМНАЯ ПРОВЕРКА ДУБЛИРОВАНИЙ
        console.log('🔄 Auto-sync ENABLED - smart duplicate checking');
        
        // ПОСТОЯННАЯ АВТОСИНХРОНИЗАЦИЯ - РАБОТАЕТ НА VERCEL
        console.log('🔄 АвтоСинхронизация ВКЛЮЧЕНА - постоянная работа каждые 5 минут');
        
        // Функция синхронизации - ИСПРАВЛЕННАЯ ЛОГИКА
        async function runSync() {
          try {
            console.log('🤖 Auto-sync: Checking for new purchases...');
            
            // ИСПРАВЛЕНО: Используем правильный endpoint с проверкой savedToSheets
            const response = await fetch(`http://localhost:${ENV.PORT}/api/sync-payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) {
              console.error('❌ Sync request failed:', response.status, response.statusText);
              return;
            }
            
            const result = await response.json();
            console.log(`✅ Auto-sync completed: ${result.processed || 0} new purchases processed`);
            
          } catch (error) {
            console.error('❌ Auto-sync failed:', error.message);
          }
        }
        
        // НАДЕЖНАЯ АВТОСИНХРОНИЗАЦИЯ КАЖДЫЕ 5 МИНУТ
        console.log('🔄 Запуск автоСинхронизации каждые 5 минут...');
        
        // Первый запуск через 30 секунд
        setTimeout(() => {
          console.log('🚀 Первый запуск автоСинхронизации...');
          runSync();
        }, 30 * 1000);
        
        // ПОЛНАЯ АВТОМАТИЗАЦИЯ - БОТ РАБОТАЕТ САМ БЕЗ ПРОСЬБ
        console.log('🤖 БОТ НАСТРОЕН НА ПОЛНУЮ АВТОМАТИЗАЦИЮ:');
        console.log('   ✅ Проверяет Stripe каждые 5 минут');
        console.log('   ✅ Добавляет новые покупки в Google Sheets');
        console.log('   ✅ Отправляет уведомления в Telegram и Slack');
        console.log('   ✅ Работает БЕЗ твоего участия');
        console.log('🚀 АВТОСИНХРОНИЗАЦИЯ ЗАПУЩЕНА И РАБОТАЕТ!');
        console.log('⚠️ ВНИМАНИЕ: Vercel может "засыпать" - используйте внешний cron!');
        console.log('🔗 Настройте cron job на: https://cron-job.org/');
        console.log('   URL: https://testoraapp.vercel.app/api/sync-payments');
        console.log('   Method: POST');
        console.log('   Interval: каждые 5 минут');
        
        // ЛОГИРОВАНИЕ ПРИ ЗАПУСКЕ
        console.log('🚀 ===== БОТ ЗАПУЩЕН =====');
        console.log('🕐 Время запуска:', new Date().toISOString());
        console.log('🌐 Vercel URL: https://testoraapp.vercel.app');
        // ПРОВЕРКА: БОТ ОТКЛЮЧЕН?
        if (ENV.BOT_DISABLED) {
          console.log('🛑 ===== БОТ ОТКЛЮЧЕН =====');
          console.log('⚠️ BOT_DISABLED=true - бот не работает');
          console.log('🔧 Чтобы включить: установи BOT_DISABLED=false');
          return;
        }
        
        // ВОЗВРАЩАЕМ АВТОМАТИЗАЦИЮ ДЛЯ RAILWAY
        console.log('🚀 ===== БОТ ЗАПУЩЕН НА RAILWAY =====');
        console.log('🕐 Время запуска:', new Date().toISOString());
        console.log('🌐 Railway URL: https://testoraapp.railway.app');
        console.log('🤖 БОТ НАСТРОЕН НА ПОЛНУЮ АВТОМАТИЗАЦИЮ:');
        console.log('   ✅ Проверяет Stripe каждые 5 минут');
        console.log('   ✅ Добавляет новые покупки в Google Sheets');
        console.log('   ✅ Отправляет уведомления в Telegram и Slack');
        console.log('   ✅ Работает БЕЗ твоего участия');
        console.log('🚀 АВТОСИНХРОНИЗАЦИЯ ЗАПУЩЕНА И РАБОТАЕТ!');
        
             // ОСНОВНАЯ АВТОМАТИЗАЦИЯ каждые 5 минут (ВКЛЮЧЕНА ПО УМОЛЧАНИЮ)
             if (ENV.AUTO_SYNC_DISABLED !== true) {
               console.log('🔄 АВТОСИНХРОНИЗАЦИЯ ВКЛЮЧЕНА (по умолчанию)');
               setInterval(() => {
                 console.log('🤖 АВТОМАТИЧЕСКАЯ ПРОВЕРКА: Ищу новые покупки в Stripe...');
                 runSync();
               }, 5 * 60 * 1000);
               
               // ДОПОЛНИТЕЛЬНАЯ АВТОМАТИЗАЦИЯ каждые 2 минуты
               setInterval(() => {
                 console.log('🤖 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Убеждаюсь что ничего не пропустил...');
                 runSync();
               }, 2 * 60 * 1000);
               
               // GEO АЛЕРТЫ каждые 60 минут
               console.log('🌍 GEO АЛЕРТЫ ВКЛЮЧЕНЫ - каждые 60 минут');
               setInterval(() => {
                 console.log('🌍 АВТОМАТИЧЕСКИЙ GEO АНАЛИЗ: Анализирую ТОП-3 стран...');
                 sendGeoAlert();
               }, 60 * 60 * 1000); // 60 минут
               
               // КРЕАТИВ АЛЕРТЫ 2 раза в день (10:00 и 22:00 UTC+1)
               console.log('🎨 КРЕАТИВ АЛЕРТЫ ВКЛЮЧЕНЫ - 2 раза в день (10:00 и 22:00 UTC+1)');
               
               // Функция для проверки времени и отправки креатив алерта
               function checkCreativeAlertTime() {
                 const now = new Date();
                 const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
                 const hour = utcPlus1.getUTCHours();
                 const minute = utcPlus1.getUTCMinutes();
                 
                 // Проверяем 10:00 и 22:00 UTC+1 (с допуском ±2 минуты)
                 if ((hour === 10 && minute >= 0 && minute <= 2) || 
                     (hour === 22 && minute >= 0 && minute <= 2)) {
                   console.log('🎨 ВРЕМЯ КРЕАТИВ АЛЕРТА:', utcPlus1.toISOString());
                   sendCreativeAlert();
                 }
               }
               
               // Проверяем каждые 2 минуты
               setInterval(() => {
                 checkCreativeAlertTime();
               }, 2 * 60 * 1000); // 2 минуты
               
               // ЕЖЕНЕДЕЛЬНЫЕ ОТЧЕТЫ каждое воскресенье в 20:00 UTC+1
               console.log('📊 ЕЖЕНЕДЕЛЬНЫЕ ОТЧЕТЫ ВКЛЮЧЕНЫ - каждое воскресенье в 20:00 UTC+1');
               
               // Функция для проверки времени еженедельного отчета
               function checkWeeklyReportTime() {
                 const now = new Date();
                 const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
                 const dayOfWeek = utcPlus1.getDay(); // 0 = воскресенье
                 const hour = utcPlus1.getUTCHours();
                 const minute = utcPlus1.getUTCMinutes();
                 
                 // Проверяем воскресенье в 20:00 UTC+1 (с допуском ±2 минуты)
                 if (dayOfWeek === 0 && hour === 20 && minute >= 0 && minute <= 2) {
                   console.log('📊 ВРЕМЯ ЕЖЕНЕДЕЛЬНОГО ОТЧЕТА:', utcPlus1.toISOString());
                   sendWeeklyReport();
                 }
               }
               
               // Проверяем каждые 2 минуты
               setInterval(() => {
                 checkWeeklyReportTime();
               }, 2 * 60 * 1000); // 2 минуты
               
               // АНОМАЛИИ МОНИТОРИНГ каждые 30 минут
               console.log('🚨 АНОМАЛИИ МОНИТОРИНГ ВКЛЮЧЕН - каждые 30 минут');
               setInterval(() => {
                 console.log('🚨 ПРОВЕРКА АНОМАЛИЙ: Анализирую продажи...');
                 checkSalesAnomalies();
               }, 30 * 60 * 1000); // 30 минут
               
               // ЕЖЕДНЕВНАЯ СТАТИСТИКА каждое утро в 7:00 UTC+1
               console.log('📊 ЕЖЕДНЕВНАЯ СТАТИСТИКА ВКЛЮЧЕНА - каждое утро в 7:00 UTC+1');
               
               // Функция для проверки времени ежедневной статистики
               function checkDailyStatsTime() {
                 const now = new Date();
                 const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
                 const hour = utcPlus1.getUTCHours();
                 const minute = utcPlus1.getUTCMinutes();
                 
                 // Проверяем 7:00 UTC+1 (с допуском ±2 минуты)
                 if (hour === 7 && minute >= 0 && minute <= 2) {
                   console.log('📊 ВРЕМЯ ЕЖЕДНЕВНОЙ СТАТИСТИКИ:', utcPlus1.toISOString());
                   sendDailyStatsAlert();
                 }
               }
               
               // Проверяем каждые 2 минуты
               setInterval(() => {
                 checkDailyStatsTime();
               }, 2 * 60 * 1000); // 2 минуты
               
             } else {
               console.log('🛑 АВТОСИНХРОНИЗАЦИЯ ОТКЛЮЧЕНА');
               console.log('🔧 Для включения установите AUTO_SYNC_DISABLED=false в Railway');
               console.log('📞 Используйте ручной вызов: POST /api/sync-payments');
             }
        
        // Показываем статус уведомлений
        if (ENV.NOTIFICATIONS_DISABLED) {
          console.log('🚫 УВЕДОМЛЕНИЯ ОТКЛЮЧЕНЫ');
          console.log('🔧 Для включения установите NOTIFICATIONS_DISABLED=false в Railway');
        } else {
          console.log('📱 УВЕДОМЛЕНИЯ ВКЛЮЧЕНЫ (по умолчанию)');
        }
});

export default app;
