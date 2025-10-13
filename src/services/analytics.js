import { logInfo, logError } from '../utils/logging.js';
import { formatWeeklyReport, formatCreativeAlert } from '../utils/formatting.js';
import googleSheets from './googleSheets.js';

// Analytics service
export class AnalyticsService {
  
  // Generate weekly report
  async generateWeeklyReport() {
    try {
      logInfo('Generating weekly report...');
      
      const rows = await googleSheets.getAllRows();
      
      // Get last week dates
      const now = new Date();
      const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
      const currentWeekStart = new Date(utcPlus1);
      currentWeekStart.setDate(utcPlus1.getDate() - utcPlus1.getDay() + 1); // Monday
      currentWeekStart.setHours(0, 0, 0, 0);
      
      // Analyze last week (not current week)
      const lastWeekStart = new Date(currentWeekStart);
      lastWeekStart.setDate(currentWeekStart.getDate() - 7);
      
      const lastWeekEnd = new Date(lastWeekStart);
      lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
      lastWeekEnd.setHours(23, 59, 59, 999);
      
      // Get week before last for comparison
      const weekBeforeLastStart = new Date(lastWeekStart);
      weekBeforeLastStart.setDate(lastWeekStart.getDate() - 7);
      
      const weekBeforeLastEnd = new Date(lastWeekEnd);
      weekBeforeLastEnd.setDate(lastWeekEnd.getDate() - 7);
      
      logInfo('Analyzing last week', {
        lastWeekStart: lastWeekStart.toISOString().split('T')[0],
        lastWeekEnd: lastWeekEnd.toISOString().split('T')[0]
      });
      
      // Filter purchases for last week
      const lastWeekPurchases = rows.filter(row => {
        const createdLocal = row.get('Created Local (UTC+1)') || '';
        const purchaseDate = new Date(createdLocal);
        return purchaseDate >= lastWeekStart && purchaseDate <= lastWeekEnd;
      });
      
      // Filter purchases for week before last
      const weekBeforeLastPurchases = rows.filter(row => {
        const createdLocal = row.get('Created Local (UTC+1)') || '';
        const purchaseDate = new Date(createdLocal);
        return purchaseDate >= weekBeforeLastStart && purchaseDate <= weekBeforeLastEnd;
      });
      
      if (lastWeekPurchases.length === 0) {
        logInfo('No purchases found for last week');
        return null;
      }
      
      // Analyze last week
      let lastWeekRevenue = 0;
      const lastWeekGeo = new Map();
      const lastWeekCreatives = new Map();
      const dailyStats = new Map();
      
      for (const purchase of lastWeekPurchases) {
        const amount = parseFloat(purchase.get('Total Amount') || '0');
        lastWeekRevenue += amount;
        
        // GEO analysis
        const geo = purchase.get('GEO') || '';
        const country = geo.split(',')[0].trim();
        if (country) {
          lastWeekGeo.set(country, (lastWeekGeo.get(country) || 0) + 1);
        }
        
        // Creatives analysis
        const adName = purchase.get('Ad Name') || '';
        if (adName) {
          lastWeekCreatives.set(adName, (lastWeekCreatives.get(adName) || 0) + 1);
        }
        
        // Daily stats
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
      
      // Analyze week before last for comparison
      let weekBeforeLastRevenue = 0;
      for (const purchase of weekBeforeLastPurchases) {
        const amount = parseFloat(purchase.get('Total Amount') || '0');
        weekBeforeLastRevenue += amount;
      }
      
      // Calculate growth
      const revenueGrowth = weekBeforeLastRevenue > 0 ? 
        ((lastWeekRevenue - weekBeforeLastRevenue) / weekBeforeLastRevenue * 100).toFixed(1) : 0;
      const salesGrowth = weekBeforeLastPurchases.length > 0 ? 
        ((lastWeekPurchases.length - weekBeforeLastPurchases.length) / weekBeforeLastPurchases.length * 100).toFixed(1) : 0;
      
      // Top countries and creatives
      const topCountries = Array.from(lastWeekGeo.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      
      const topCreatives = Array.from(lastWeekCreatives.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      
      // Daily breakdown
      const dailyBreakdown = Array.from(dailyStats.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, stats]) => {
          const dayName = new Date(day).toLocaleDateString('en-US', { weekday: 'short' });
          return `• ${dayName} (${day}): ${stats.sales} sales, $${stats.revenue.toFixed(2)}`;
        });
      
      // Формируем отчет (restored from old working version)
      const weekStartStr = lastWeekStart.toISOString().split('T')[0];
      const weekEndStr = lastWeekEnd.toISOString().split('T')[0];
      
      const reportText = `📊 **Weekly Report - Past Week (${weekStartStr} - ${weekEndStr})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 **Total Revenue:** $${lastWeekRevenue.toFixed(2)}
📈 **Revenue Growth:** ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}% vs week before
🛒 **Total Sales:** ${lastWeekPurchases.length}
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
⏰ **Report generated:** ${utcPlus1.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' })} UTC+1`;
      
      logInfo('📤 Отправляю еженедельный отчет:', { reportText });
      
      return reportText;
      
    } catch (error) {
      logError('Error generating weekly report', error);
      throw error;
    }
  }
  
  // Generate GEO alert (restored from old working version)
  async generateGeoAlert() {
    try {
      logInfo('🌍 Анализирую GEO данные за сегодня...');
      
      const rows = await googleSheets.getAllRows();
      
      // Получаем сегодняшнюю дату в UTC+1
      const today = new Date();
      const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
      const todayStr = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
      
      logInfo(`📅 Анализирую покупки за ${todayStr} (UTC+1)`);
      
      // Фильтруем покупки за сегодня
      const todayPurchases = rows.filter(row => {
        const createdLocal = row.get('Created Local (UTC+1)') || '';
        return createdLocal.includes(todayStr);
      });
      
      logInfo(`📊 Найдено ${todayPurchases.length} покупок за сегодня`);
      
      if (todayPurchases.length === 0) {
        logInfo('📭 Нет покупок за сегодня - пропускаю GEO алерт');
        return null;
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
        const flag = this.getCountryFlag(country);
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
      
      logInfo('📤 Отправляю GEO алерт:', { alertText });
      
      return alertText;
      
    } catch (error) {
      logError('Error generating GEO alert', error);
      throw error;
    }
  }
  
  // Helper function for country flags
  getCountryFlag(country) {
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
      'EC': '🇪🇨',
      'BO': '🇧🇴',
      'PY': '🇵🇾',
      'UY': '🇺🇾',
      'GY': '🇬🇾',
      'SR': '🇸🇷',
      'GF': '🇬🇫',
      'FK': '🇫🇰',
      'ZA': '🇿🇦',
      'NG': '🇳🇬',
      'KE': '🇰🇪',
      'EG': '🇪🇬',
      'MA': '🇲🇦',
      'TN': '🇹🇳',
      'DZ': '🇩🇿',
      'LY': '🇱🇾',
      'SD': '🇸🇩',
      'ET': '🇪🇹',
      'UG': '🇺🇬',
      'TZ': '🇹🇿',
      'GH': '🇬🇭',
      'CI': '🇨🇮',
      'SN': '🇸🇳',
      'ML': '🇲🇱',
      'BF': '🇧🇫',
      'NE': '🇳🇪',
      'TD': '🇹🇩',
      'CM': '🇨🇲',
      'CF': '🇨🇫',
      'CG': '🇨🇬',
      'CD': '🇨🇩',
      'AO': '🇦🇴',
      'ZM': '🇿🇲',
      'ZW': '🇿🇼',
      'BW': '🇧🇼',
      'NA': '🇳🇦',
      'SZ': '🇸🇿',
      'LS': '🇱🇸',
      'MG': '🇲🇬',
      'MU': '🇲🇺',
      'SC': '🇸🇨',
      'KM': '🇰🇲',
      'YT': '🇾🇹',
      'RE': '🇷🇪',
      'DJ': '🇩🇯',
      'SO': '🇸🇴',
      'ER': '🇪🇷',
      'SS': '🇸🇸',
      'RU': '🇷🇺',
      'TR': '🇹🇷',
      'IL': '🇮🇱',
      'SA': '🇸🇦',
      'AE': '🇦🇪',
      'QA': '🇶🇦',
      'BH': '🇧🇭',
      'KW': '🇰🇼',
      'OM': '🇴🇲',
      'YE': '🇾🇪',
      'IQ': '🇮🇶',
      'IR': '🇮🇷',
      'AF': '🇦🇫',
      'PK': '🇵🇰',
      'BD': '🇧🇩',
      'LK': '🇱🇰',
      'MV': '🇲🇻',
      'BT': '🇧🇹',
      'NP': '🇳🇵',
      'MM': '🇲🇲',
      'TH': '🇹🇭',
      'LA': '🇱🇦',
      'KH': '🇰🇭',
      'VN': '🇻🇳',
      'MY': '🇲🇾',
      'SG': '🇸🇬',
      'BN': '🇧🇳',
      'ID': '🇮🇩',
      'TL': '🇹🇱',
      'PH': '🇵🇭',
      'TW': '🇹🇼',
      'HK': '🇭🇰',
      'MO': '🇲🇴',
      'MN': '🇲🇳',
      'KZ': '🇰🇿',
      'UZ': '🇺🇿',
      'TM': '🇹🇲',
      'TJ': '🇹🇯',
      'KG': '🇰🇬',
      'GE': '🇬🇪',
      'AM': '🇦🇲',
      'AZ': '🇦🇿',
      'BY': '🇧🇾',
      'MD': '🇲🇩',
      'UA': '🇺🇦',
      'MK': '🇲🇰',
      'RS': '🇷🇸',
      'ME': '🇲🇪',
      'BA': '🇧🇦',
      'XK': '🇽🇰',
      'AL': '🇦🇱',
      'Unknown': '❓'
    };
    
    return flags[country] || '🌍';
  }
  
  // Generate daily stats alert (restored from old working version)
  async generateDailyStats() {
    try {
      logInfo('📊 Анализирую статистику за вчера...');
      
      const rows = await googleSheets.getAllRows();
      
      // Получаем вчерашнюю дату в UTC+1
      const today = new Date();
      const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
      const yesterday = new Date(utcPlus1);
      yesterday.setDate(utcPlus1.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
      
      logInfo(`📅 Анализирую статистику за ${yesterdayStr} (UTC+1)`);
      
      // Фильтруем покупки за вчера
      const yesterdayPurchases = rows.filter(row => {
        const createdLocal = row.get('Created Local (UTC+1)') || '';
        return createdLocal.includes(yesterdayStr);
      });
      
      logInfo(`📊 Найдено ${yesterdayPurchases.length} покупок за вчера`);
      
      if (yesterdayPurchases.length === 0) {
        logInfo('📭 Нет покупок за вчера - пропускаю ежедневную статистику');
        return null;
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
      
      logInfo('📤 Отправляю ежедневную статистику:', { alertText });
      
      return alertText;
      
    } catch (error) {
      logError('Error generating daily stats', error);
      throw error;
    }
  }
  
  // Generate anomaly check (restored from old working version)
  async generateAnomalyCheck() {
    try {
      logInfo('🚨 Проверяю аномалии в продажах...');
      
      const rows = await googleSheets.getAllRows();
      
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
      
      logInfo(`📊 Последние 2 часа: ${recentPurchases.length} покупок`);
      logInfo(`📊 Вчера в то же время: ${yesterdayPurchases.length} покупок`);
      
      if (yesterdayPurchases.length === 0) {
        logInfo('📭 Нет данных за вчера - пропускаю проверку аномалий');
        return null;
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
        
        logInfo('📤 Отправляю алерт об аномалии:', { alertText });
        
        return alertText;
      } else {
        logInfo(`📊 Продажи в норме: ${changePercent.toFixed(1)}% изменение`);
        return null;
      }
      
    } catch (error) {
      logError('Error checking sales anomalies', error);
      throw error;
    }
  }
  
  // Generate creative alert (restored from old working version)
  async generateCreativeAlert() {
    try {
      logInfo('🎨 Анализирую креативы за сегодня...');
      
      const rows = await googleSheets.getAllRows();
      
      // Получаем сегодняшнюю дату в UTC+1
      const today = new Date();
      const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
      const todayStr = utcPlus1.toISOString().split('T')[0]; // YYYY-MM-DD
      
      logInfo(`📅 Анализирую креативы за ${todayStr} (UTC+1)`);
      
      // Фильтруем покупки за сегодня
      const todayPurchases = rows.filter(row => {
        const createdLocal = row.get('Created Local (UTC+1)') || '';
        return createdLocal.includes(todayStr);
      });
      
      logInfo(`📊 Найдено ${todayPurchases.length} покупок за сегодня`);
      
      if (todayPurchases.length === 0) {
        logInfo('📭 Нет покупок за сегодня - пропускаю креатив алерт');
        return null;
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
        logInfo('📭 Нет креативов за сегодня - пропускаю креатив алерт');
        return null;
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
      
      logInfo('📤 Отправляю креатив алерт:', { alertText });
      
      return alertText;
      
    } catch (error) {
      logError('Error generating creative alert', error);
      throw error;
    }
  }
}

// Export singleton instance
export const analytics = new AnalyticsService();
export default analytics;
