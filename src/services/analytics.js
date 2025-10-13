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
      
      const reportData = {
        weekStart: lastWeekStart,
        weekEnd: lastWeekEnd,
        totalRevenue: lastWeekRevenue,
        totalSales: lastWeekPurchases.length,
        revenueGrowth: parseFloat(revenueGrowth),
        salesGrowth: parseFloat(salesGrowth),
        topCountries,
        topCreatives,
        dailyBreakdown
      };
      
      const reportText = formatWeeklyReport(reportData);
      
      logInfo('Weekly report generated successfully', {
        totalRevenue: lastWeekRevenue,
        totalSales: lastWeekPurchases.length,
        topCountries: topCountries.length,
        topCreatives: topCreatives.length
      });
      
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
  
  // Generate creative alert
  async generateCreativeAlert() {
    try {
      logInfo('Generating creative alert...');
      
      const rows = await googleSheets.getAllRows();
      
      // Get today's date
      const today = new Date();
      const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
      const todayStart = new Date(utcPlus1);
      todayStart.setHours(0, 0, 0, 0);
      
      const todayEnd = new Date(utcPlus1);
      todayEnd.setHours(23, 59, 59, 999);
      
      // Filter today's purchases
      const todayPurchases = rows.filter(row => {
        const createdLocal = row.get('Created Local (UTC+1)') || '';
        const purchaseDate = new Date(createdLocal);
        return purchaseDate >= todayStart && purchaseDate <= todayEnd;
      });
      
      if (todayPurchases.length === 0) {
        logInfo('No purchases found for today');
        return null;
      }
      
      // Analyze creative data
      const creativeStats = new Map();
      
      for (const purchase of todayPurchases) {
        const adName = purchase.get('Ad Name') || '';
        if (adName) {
          creativeStats.set(adName, (creativeStats.get(adName) || 0) + 1);
        }
      }
      
      // Top creatives
      const topCreatives = Array.from(creativeStats.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      
      const alertData = {
        topCreatives,
        totalSales: todayPurchases.length,
        date: todayStart.toISOString().split('T')[0]
      };
      
      const alertText = formatCreativeAlert(alertData);
      
      logInfo('Creative alert generated successfully', {
        totalSales: todayPurchases.length,
        topCreatives: topCreatives.length
      });
      
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
