import { logInfo, logError, logWarn } from '../utils/logging.js';
import googleSheets from './googleSheets.js';
import { ENV } from '../config/env.js';
import { fetchWithRetry } from '../utils/retry.js';

// Analytics service
export class AnalyticsService {

  /**
   * Load rows from ALL sheets (payments + LowPrice + Primer)
   */
  async loadAllSheetRows() {
    const allRows = [];

    try {
      const paymentsSheet = await googleSheets.getSheetByName('payments');
      await fetchWithRetry(() => paymentsSheet.loadHeaderRow(), 3, 2000);
      const rows = await fetchWithRetry(() => paymentsSheet.getRows(), 3, 2000);
      allRows.push(...rows);
    } catch (error) {
      logWarn(`⚠️ Could not load payments sheet: ${error.message}`);
    }

    try {
      const lowPriceSheet = await googleSheets.getSheetByName('LowPrice');
      await fetchWithRetry(() => lowPriceSheet.loadHeaderRow(), 3, 2000);
      const rows = await fetchWithRetry(() => lowPriceSheet.getRows(), 3, 2000);
      allRows.push(...rows);
    } catch (error) {
      logWarn(`⚠️ Could not load LowPrice sheet: ${error.message}`);
    }

    try {
      const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
      const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
      await fetchWithRetry(() => primerSheet.loadHeaderRow(), 3, 2000);
      const rows = await fetchWithRetry(() => primerSheet.getRows(), 3, 2000);
      allRows.push(...rows);
    } catch (error) {
      const msg = error?.message || '';
      if (msg.includes('429') || msg.includes('Quota')) {
        logWarn('⚠️ Quota exceeded for Primer sheet, skipping');
      } else {
        logInfo(`ℹ️ Primer sheet not available: ${msg}`);
      }
    }

    return allRows;
  }

  /**
   * Get Created UTC date string from a row (works across all sheets)
   */
  getRowDateUTC(row) {
    const createdUTC = row.get('Created UTC') || '';
    if (createdUTC) return createdUTC.split('T')[0];
    const createdLocal = row.get('Created Local (UTC+1)') || row.get('Created Local (UTC-8)') || '';
    if (createdLocal) return createdLocal.split(' ')[0];
    return '';
  }

  /**
   * Get Created UTC Date object from a row
   */
  getRowDateObj(row) {
    const createdUTC = row.get('Created UTC') || '';
    if (createdUTC) return new Date(createdUTC);
    return null;
  }

  // Generate weekly report
  async generateWeeklyReport() {
    try {
      logInfo('Generating weekly report...');

      const rows = await this.loadAllSheetRows();
      
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
${thisWeek.topCampaigns.map((c, i) => `   ${i + 1}. ${c.name}: $${c.revenue.toFixed(2)} (${c.count} purchases)`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      logInfo('📤 Отправляю еженедельный отчет:', { report });
      
      return report;
      
    } catch (error) {
      logError('Error generating weekly report', error);
      throw error;
    }
  }

  getWeekData(rows, weeksAgo = 0) {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setUTCDate(now.getUTCDate() - now.getUTCDay() + 1 - (weeksAgo * 7)); // Monday
    startOfWeek.setUTCHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6); // Sunday
    endOfWeek.setUTCHours(23, 59, 59, 999);

    const weekRows = rows.filter(row => {
      const dateObj = this.getRowDateObj(row);
      return dateObj && dateObj >= startOfWeek && dateObj <= endOfWeek;
    });

    const revenue = weekRows.reduce((sum, row) =>
      sum + parseFloat(row.get('Total Amount') || 0), 0
    );

    const countryStats = new Map();
    const campaignStats = new Map();

    for (const row of weekRows) {
      // GEO
      const geo = row.get('GEO') || '';
      const country = geo.split(',')[0].trim();
      if (country && country !== 'Unknown') {
        countryStats.set(country, (countryStats.get(country) || 0) + 1);
      }

      // Campaign — check all possible column names
      const campaign = row.get('UTM Campaign') || row.get('Campaign Name') || row.get('Campaign') || '';
      if (campaign && campaign !== 'N/A') {
        const amount = parseFloat(row.get('Total Amount') || 0);
        if (campaignStats.has(campaign)) {
          campaignStats.get(campaign).count++;
          campaignStats.get(campaign).revenue += amount;
        } else {
          campaignStats.set(campaign, { count: 1, revenue: amount });
        }
      }
    }

    const topCountries = Array.from(countryStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, count]) => ({ country, count }));

    const topCampaigns = Array.from(campaignStats.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([name, stats]) => ({ name, revenue: stats.revenue, count: stats.count }));

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
  
  // Generate Hourly Report with platform breakdown (includes both Stripe accounts)
  async generateHourlyReport() {
    try {
      logInfo('📊 Generating hourly report...');

      const allRows = await this.loadAllSheetRows();
      const today = new Date();
      const todayUTC = today.toISOString().split('T')[0];

      const allTodayPurchases = allRows.filter(row => this.getRowDateUTC(row) === todayUTC);

      logInfo(`📊 Found ${allTodayPurchases.length} purchases today`);
      
      if (allTodayPurchases.length === 0) {
        logInfo('📭 Нет покупок за сегодня - пропускаю часовой отчет');
        return null;
      }
      
      // Группируем по платформе (UTM Source)
      const platformStats = new Map();
      
      for (const purchase of allTodayPurchases) {
        const utmSource = purchase.get('UTM Source') || 'N/A';
        const geo = purchase.get('GEO') || 'Unknown';
        const country = geo.split(',')[0].trim();
        
        if (!platformStats.has(utmSource)) {
          platformStats.set(utmSource, {
            total: 0,
            countries: new Map()
          });
        }
        
        const platform = platformStats.get(utmSource);
        platform.total++;
        
        if (platform.countries.has(country)) {
          platform.countries.set(country, platform.countries.get(country) + 1);
        } else {
          platform.countries.set(country, 1);
        }
      }
      
      // Формируем отчет для каждой платформы
      const reports = [];
      
      for (const [platform, stats] of platformStats.entries()) {
        if (platform === 'N/A') continue;
        
        // Определяем основные страны
        const usCount = stats.countries.get('US') || 0;
        const auCount = stats.countries.get('AU') || 0;
        const caCount = stats.countries.get('CA') || 0;
        
        // WW = все остальные страны
        const wwCount = stats.total - usCount - auCount - caCount;
        
        const countryLines = [];
        if (usCount > 0) countryLines.push(`🇺🇸 US - ${usCount}`);
        if (auCount > 0) countryLines.push(`🇦🇺 AU - ${auCount}`);
        if (caCount > 0) countryLines.push(`🇨🇦 CA - ${caCount}`);
        if (wwCount > 0) countryLines.push(`🌍 WW - ${wwCount}`);
        
        const platformReport = `🔹 **${platform}** (${stats.total} purchases)\n\n${countryLines.join('\n')}`;
        reports.push(platformReport);
      }
      
      // Формируем итоговое сообщение
      const totalPurchases = allTodayPurchases.length;
      const reportText = `📊 **Hourly Report for today (${todayUTC})**\n\n${reports.join('\n\n')}\n\n📈 Total purchases: ${totalPurchases}`;
      
      logInfo('📤 Отправляю часовой отчет:', { totalPurchases, platforms: platformStats.size });
      
      return reportText;
      
    } catch (error) {
      logError('Error generating hourly report', error);
      throw error;
    }
  }
  
  // Generate GEO alert (restored from old working version)
  async generateGeoAlert() {
    try {
      logInfo('🌍 Analyzing GEO data for today...');

      const rows = await this.loadAllSheetRows();

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      logInfo(`📅 Analyzing purchases for ${todayStr} (UTC)`);

      const todayPurchases = rows.filter(row => this.getRowDateUTC(row) === todayStr);
      
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
  
  // Generate daily stats alert
  async generateDailyStats() {
    try {
      logInfo('📊 Generating daily stats...');

      const rows = await this.loadAllSheetRows();

      // Yesterday's date in UTC
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      logInfo(`📅 Analyzing stats for ${yesterdayStr} (UTC)`);

      const yesterdayPurchases = rows.filter(row => this.getRowDateUTC(row) === yesterdayStr);
      
      logInfo(`📊 Найдено ${yesterdayPurchases.length} покупок за вчера`);
      
      if (yesterdayPurchases.length === 0) {
        logInfo('📭 Нет покупок за вчера - пропускаю ежедневную статистику');
        return null;
      }
      
      const t1Countries = ['US', 'CA', 'AU', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI', 'CH', 'AT', 'BE', 'IE', 'PT', 'GR', 'LU', 'MT', 'CY'];

      const stats = {
        US: { main: 0, additional: 0, total: 0, revenue: 0 },
        T1: { main: 0, additional: 0, total: 0, revenue: 0 },
        WW: { main: 0, additional: 0, total: 0, revenue: 0 }
      };

      let totalRevenue = 0;

      for (const purchase of yesterdayPurchases) {
        const geo = purchase.get('GEO') || '';
        const amount = parseFloat(purchase.get('Total Amount') || '0');
        const country = geo.split(',')[0].trim();

        totalRevenue += amount;

        let category = 'WW';
        if (country === 'US') {
          category = 'US';
        } else if (t1Countries.includes(country)) {
          category = 'T1';
        }

        if (amount <= 9.99) {
          stats[category].main++;
        } else {
          stats[category].additional++;
        }
        stats[category].total++;
        stats[category].revenue += amount;
      }

      const alertText = `📊 Daily Stats for ${yesterdayStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🇺🇸 US Market:
  Main (≤$9.99): ${stats.US.main} | Upsells (>$9.99): ${stats.US.additional}
  Total: ${stats.US.total} | Revenue: $${stats.US.revenue.toFixed(2)}

🌍 T1 Countries:
  Main (≤$9.99): ${stats.T1.main} | Upsells (>$9.99): ${stats.T1.additional}
  Total: ${stats.T1.total} | Revenue: $${stats.T1.revenue.toFixed(2)}

🌎 WW (Rest of World):
  Main (≤$9.99): ${stats.WW.main} | Upsells (>$9.99): ${stats.WW.additional}
  Total: ${stats.WW.total} | Revenue: $${stats.WW.revenue.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Total: ${yesterdayPurchases.length} purchases | $${totalRevenue.toFixed(2)} revenue`;
      
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
      logInfo('🚨 Checking sales anomalies...');

      const rows = await this.loadAllSheetRows();

      const now = new Date();

      // Last 2 hours
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const recentPurchases = rows.filter(row => {
        const dateObj = this.getRowDateObj(row);
        return dateObj && dateObj >= twoHoursAgo;
      });

      // Same 2-hour window yesterday
      const yesterdayStart = new Date(now);
      yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
      yesterdayStart.setUTCHours(now.getUTCHours() - 2, 0, 0, 0);

      const yesterdayEnd = new Date(yesterdayStart);
      yesterdayEnd.setUTCHours(yesterdayStart.getUTCHours() + 2, 0, 0, 0);

      const yesterdayPurchases = rows.filter(row => {
        const dateObj = this.getRowDateObj(row);
        return dateObj && dateObj >= yesterdayStart && dateObj <= yesterdayEnd;
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
  
  async generateCreativeAlert() {
    try {
      logInfo('🎨 Analyzing creatives for today...');

      const allRows = await this.loadAllSheetRows();
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      const todayPurchases = allRows.filter(row => this.getRowDateUTC(row) === todayStr);

      logInfo(`📊 Found ${todayPurchases.length} purchases today`);

      if (todayPurchases.length === 0) return null;

      const creativeStats = new Map();
      for (const purchase of todayPurchases) {
        const adName = purchase.get('Ad Name') || '';
        if (adName && adName.trim() !== '' && adName !== 'N/A') {
          creativeStats.set(adName, (creativeStats.get(adName) || 0) + 1);
        }
      }

      if (creativeStats.size === 0) return null;

      const sortedCreatives = Array.from(creativeStats.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const top = sortedCreatives
        .map(([creative, count], i) => `${i + 1}. ${creative} — ${count} purchases`)
        .join('\n');

      const alertText = `🎨 TOP Creatives for today (${todayStr})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${top}

📈 Total purchases: ${todayPurchases.length}
⏰ ${now.toISOString().split('T')[1].split('.')[0]} UTC`;
      
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

