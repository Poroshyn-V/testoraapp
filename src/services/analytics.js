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
      
      // Текущая неделя
      const thisWeek = this.getWeekData(rows, 0);
      
      // Прошлая неделя для сравнения
      const lastWeek = this.getWeekData(rows, 1);
      
      const revenueDiff = thisWeek.revenue - lastWeek.revenue;
      const revenueDiffPercent = lastWeek.revenue > 0 
        ? Math.round((revenueDiff / lastWeek.revenue) * 100) 
        : 0;
      
      const purchasesDiff = thisWeek.purchases - lastWeek.purchases;
      const purchasesDiffPercent = lastWeek.purchases > 0
        ? Math.round((purchasesDiff / lastWeek.purchases) * 100)
        : 0;
      
      const report = `📊 WEEKLY REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Week: ${thisWeek.startDate} - ${thisWeek.endDate}

💰 Revenue: $${thisWeek.revenue.toFixed(2)}
   ${revenueDiff >= 0 ? '📈' : '📉'} ${Math.abs(revenueDiffPercent)}% vs last week

🛒 Purchases: ${thisWeek.purchases}
   ${purchasesDiff >= 0 ? '📈' : '📉'} ${Math.abs(purchasesDiffPercent)}% vs last week

📊 Average Order Value: $${thisWeek.aov.toFixed(2)}
   ${thisWeek.aov > lastWeek.aov ? '📈' : '📉'} $${Math.abs(thisWeek.aov - lastWeek.aov).toFixed(2)} vs last week

🌍 Top Countries:
${thisWeek.topCountries.map((c, i) => `   ${i + 1}. ${c.country}: ${c.count} purchases`).join('\n')}

🎯 Top Campaigns:
${thisWeek.topCampaigns.map((c, i) => `   ${i + 1}. ${c.name}: $${c.revenue.toFixed(2)}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      logInfo('📤 Отправляю еженедельный отчет:', { report });
      
      return report;
      
    } catch (error) {
      logError('Error generating weekly report', error);
      throw error;
    }
  }

  getWeekData(rows, weeksAgo = 0) {
    // weeksAgo: 0 = текущая неделя, 1 = прошлая неделя
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const startOfWeek = new Date(utcPlus1);
    startOfWeek.setDate(utcPlus1.getDate() - utcPlus1.getDay() + 1 - (weeksAgo * 7)); // Понедельник
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Воскресенье
    endOfWeek.setHours(23, 59, 59, 999);
    
    const weekRows = rows.filter(row => {
      const created = new Date(row.get('Created Local (UTC+1)'));
      return created >= startOfWeek && created <= endOfWeek;
    });
    
    const revenue = weekRows.reduce((sum, row) => 
      sum + parseFloat(row.get('Total Amount') || 0), 0
    );
    
    // Анализ стран
    const countryStats = new Map();
    const campaignStats = new Map();
    
    for (const row of weekRows) {
      // GEO анализ
      const geo = row.get('GEO') || '';
      const country = geo.split(',')[0].trim();
      if (country) {
        countryStats.set(country, (countryStats.get(country) || 0) + 1);
      }
      
      // Анализ кампаний
      const campaign = row.get('Campaign') || '';
      if (campaign) {
        const amount = parseFloat(row.get('Total Amount') || 0);
        if (campaignStats.has(campaign)) {
          campaignStats.get(campaign).count++;
          campaignStats.get(campaign).revenue += amount;
        } else {
          campaignStats.set(campaign, { count: 1, revenue: amount });
        }
      }
    }
    
    // Топ-3 страны
    const topCountries = Array.from(countryStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([country, count]) => ({ country, count }));
    
    // Топ-3 кампании по выручке
    const topCampaigns = Array.from(campaignStats.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 3)
      .map(([name, stats]) => ({ name, revenue: stats.revenue }));
    
    return {
      startDate: startOfWeek.toISOString().split('T')[0],
      endDate: endOfWeek.toISOString().split('T')[0],
      revenue,
      purchases: weekRows.length,
      aov: weekRows.length > 0 ? revenue / weekRows.length : 0,
      topCountries,
      topCampaigns
    };
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
