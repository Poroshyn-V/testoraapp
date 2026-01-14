import { logInfo, logError } from '../utils/logging.js';
import googleSheets from './googleSheets.js';
import { metrics } from './metrics.js';
import AlertPriority from './alertPriority.js';
import { alertConfig } from '../config/alertConfig.js';
import { ENV } from '../config/env.js';
import { fetchWithRetry } from '../utils/retry.js';

// Smart alerts service
export class SmartAlerts {
  constructor() {
    this.thresholds = {
      revenue_drop_percent: alertConfig.revenueDrop,
      conversion_drop_percent: alertConfig.conversionDrop,
      payment_failure_rate: alertConfig.paymentFailureRate,
      new_geo_threshold: 5, // Если >5 покупок из новой страны
      // Оперативные алерты - пороги для немедленного уведомления
      campaignHourlyThreshold: 5, // Если кампания принесла 5+ покупок за час
      creativeHourlyThreshold: 10 // Если креатив принес 10+ покупок за час
    };
    
    // Кэш для отслеживания уже отправленных оперативных алертов
    this.sentRealTimeAlerts = new Map(); // key: "campaign_{name}_{hour}" или "creative_{name}_{hour}"
  }
  
  async checkRevenueAnomaly() {
    try {
      const rows = await googleSheets.getAllRows();
      
      // Сегодняшняя выручка
      const today = this.getTodayRevenue(rows);
      
      // Средняя за последние 7 дней
      const avgLast7Days = this.getAvgRevenueLast7Days(rows);
      
      if (today < avgLast7Days * (1 - this.thresholds.revenue_drop_percent / 100)) {
        const drop = Math.round(((avgLast7Days - today) / avgLast7Days) * 100);
        
        const alert = `🚨 CRITICAL: Revenue Drop Alert!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Today's Revenue: $${today.toFixed(2)}
7-Day Average: $${avgLast7Days.toFixed(2)}
Drop: ${drop}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ Immediate attention required!`;
        
        await AlertPriority.sendAlert(alert, AlertPriority.HIGH, {
          type: 'revenue_drop',
          today,
          average: avgLast7Days,
          drop_percent: drop
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      logError('Error checking revenue anomaly', error);
      return false;
    }
  }
  
  getTodayRevenue(rows) {
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0];
    
    return rows
      .filter(row => {
        const created = row.get('Created Local (UTC+1)') || '';
        return created.startsWith(todayStr);
      })
      .reduce((sum, row) => {
        const amount = parseFloat(row.get('Total Amount') || 0);
        return sum + amount;
      }, 0);
  }
  
  getAvgRevenueLast7Days(rows) {
    const revenues = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const utcPlus1 = new Date(date.getTime() + 60 * 60 * 1000);
      const dateStr = utcPlus1.toISOString().split('T')[0];
      
      const dayRevenue = rows
        .filter(row => {
          const created = row.get('Created Local (UTC+1)') || '';
          return created.startsWith(dateStr);
        })
        .reduce((sum, row) => sum + parseFloat(row.get('Total Amount') || 0), 0);
      
      revenues.push(dayRevenue);
    }
    
    return revenues.reduce((a, b) => a + b, 0) / revenues.length;
  }
  
  async checkNewGeoAlert() {
    try {
      const rows = await googleSheets.getAllRows();
      
      // Получаем все страны за последние 30 дней
      const last30Days = this.getLast30DaysCountries(rows);
      
      // Получаем страны за сегодня
      const todayCountries = this.getTodayCountries(rows);
      
      // Находим новые страны
      const newCountries = todayCountries.filter(country => 
        !last30Days.includes(country) && country !== 'Unknown'
      );
      
      if (newCountries.length > 0) {
        const alert = `🌍 NEW GEO ALERT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
New countries detected: ${newCountries.join(', ')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 Consider targeting these markets!`;
        
        await AlertPriority.sendAlert(alert, AlertPriority.MEDIUM, {
          type: 'new_geo',
          newCountries,
          count: newCountries.length
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      logError('Error checking new geo alert', error);
      return false;
    }
  }
  
  getLast30DaysCountries(rows) {
    const countries = new Set();
    const today = new Date();
    
    for (let i = 1; i <= 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const utcPlus1 = new Date(date.getTime() + 60 * 60 * 1000);
      const dateStr = utcPlus1.toISOString().split('T')[0];
      
      const dayRows = rows.filter(row => {
        const created = row.get('Created Local (UTC+1)') || '';
        return created.startsWith(dateStr);
      });
      
      dayRows.forEach(row => {
        const geo = row.get('GEO') || '';
        const country = geo.split(',')[0].trim();
        if (country) {
          countries.add(country);
        }
      });
    }
    
    return Array.from(countries);
  }
  
  getTodayCountries(rows) {
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0];
    
    const todayRows = rows.filter(row => {
      const created = row.get('Created Local (UTC+1)') || '';
      return created.startsWith(todayStr);
    });
    
    const countries = new Set();
    todayRows.forEach(row => {
      const geo = row.get('GEO') || '';
      const country = geo.split(',')[0].trim();
      if (country) {
        countries.add(country);
      }
    });
    
    return Array.from(countries);
  }
  
  async checkConversionDrop() {
    try {
      const rows = await googleSheets.getAllRows();
      
      // Сегодняшние покупки
      const todayPurchases = this.getTodayPurchases(rows);
      
      // Средние покупки за последние 7 дней
      const avgLast7Days = this.getAvgPurchasesLast7Days(rows);
      
      if (todayPurchases < avgLast7Days * (1 - this.thresholds.conversion_drop_percent / 100)) {
        const drop = Math.round(((avgLast7Days - todayPurchases) / avgLast7Days) * 100);
        
        const alert = `📉 CONVERSION DROP ALERT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Today's Purchases: ${todayPurchases}
7-Day Average: ${avgLast7Days.toFixed(1)}
Drop: ${drop}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Check your campaigns!`;
        
        await AlertPriority.sendAlert(alert, AlertPriority.MEDIUM, {
          type: 'conversion_drop',
          today: todayPurchases,
          average: avgLast7Days,
          drop_percent: drop
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      logError('Error checking conversion drop', error);
      return false;
    }
  }
  
  getTodayPurchases(rows) {
    const today = new Date();
    const utcPlus1 = new Date(today.getTime() + 60 * 60 * 1000);
    const todayStr = utcPlus1.toISOString().split('T')[0];
    
    return rows.filter(row => {
      const created = row.get('Created Local (UTC+1)') || '';
      return created.startsWith(todayStr);
    }).length;
  }
  
  getAvgPurchasesLast7Days(rows) {
    const purchases = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const utcPlus1 = new Date(date.getTime() + 60 * 60 * 1000);
      const dateStr = utcPlus1.toISOString().split('T')[0];
      
      const dayPurchases = rows.filter(row => {
        const created = row.get('Created Local (UTC+1)') || '';
        return created.startsWith(dateStr);
      }).length;
      
      purchases.push(dayPurchases);
    }
    
    return purchases.reduce((a, b) => a + b, 0) / purchases.length;
  }
  
  /**
   * Оперативный алерт: кампании с 5+ покупками за час
   * Вызывается автоматически после каждой синхронизации
   */
  async checkRealTimeCampaignAlert() {
    try {
      logInfo('⚡ Проверяю оперативные алерты по кампаниям...');
      
      const paymentsSheet = await googleSheets.getSheetByName('payments');
      const lowPriceSheet = await googleSheets.getSheetByName('LowPrice');
      
      await paymentsSheet.loadHeaderRow();
      await lowPriceSheet.loadHeaderRow();
      
      const paymentsRows = await paymentsSheet.getRows();
      const lowPriceRows = await lowPriceSheet.getRows();
      
      // Попытаемся получить данные из Primer листа (если он существует)
      let primerRows = [];
      try {
        const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
        const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
        await primerSheet.loadHeaderRow();
        primerRows = await primerSheet.getRows();
      } catch (error) {
        // Primer лист не существует или не настроен - это нормально
      }
      
      const allRows = [...paymentsRows, ...lowPriceRows, ...primerRows];
      
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const currentHour = now.getUTCHours();
      
      // Покупки за последний час
      const lastHourPurchases = allRows.filter(row => {
        const createdUTC = row.get('Created UTC') || '';
        if (!createdUTC) return false;
        const purchaseDate = new Date(createdUTC);
        return purchaseDate >= oneHourAgo;
      });
      
      if (lastHourPurchases.length === 0) {
        return null;
      }
      
      // Группируем по кампаниям
      const campaignStats = new Map();
      
      for (const purchase of lastHourPurchases) {
        const campaignName = purchase.get('Campaign Name') || purchase.get('UTM Campaign') || '';
        const amount = parseFloat(purchase.get('Total Amount') || 0);
        
        if (campaignName && campaignName !== 'N/A') {
          if (!campaignStats.has(campaignName)) {
            campaignStats.set(campaignName, {
              name: campaignName,
              purchases: 0,
              revenue: 0
            });
          }
          const stat = campaignStats.get(campaignName);
          stat.purchases++;
          stat.revenue += amount;
        }
      }
      
      // Находим кампании с 5+ покупками за час
      const hotCampaigns = Array.from(campaignStats.values())
        .filter(stat => stat.purchases >= this.thresholds.campaignHourlyThreshold)
        .sort((a, b) => b.purchases - a.purchases);
      
      if (hotCampaigns.length === 0) {
        return null;
      }
      
      // Проверяем, не отправляли ли мы уже алерт для этих кампаний в этом часу
      const alertsToSend = [];
      
      for (const campaign of hotCampaigns) {
        const alertKey = `campaign_${campaign.name}_${currentHour}`;
        
        if (!this.sentRealTimeAlerts.has(alertKey)) {
          alertsToSend.push(campaign);
          this.sentRealTimeAlerts.set(alertKey, true);
          
          // Очищаем старые записи (старше 2 часов)
          setTimeout(() => {
            this.sentRealTimeAlerts.delete(alertKey);
          }, 2 * 60 * 60 * 1000);
        }
      }
      
      if (alertsToSend.length === 0) {
        return null;
      }
      
      // Формируем алерт
      let alertText = `⚡ **REAL-TIME ALERT: Hot Campaigns (Last Hour)**\n\n`;
      alertText += `📊 Total purchases last hour: ${lastHourPurchases.length}\n\n`;
      
      alertText += `🔥 **Campaigns with ${this.thresholds.campaignHourlyThreshold}+ purchases:**\n\n`;
      
      for (let i = 0; i < alertsToSend.length; i++) {
        const campaign = alertsToSend[i];
        alertText += `${i + 1}. **${campaign.name}**\n`;
        alertText += `   📦 Purchases: ${campaign.purchases}\n`;
        alertText += `   💰 Revenue: $${campaign.revenue.toFixed(2)}\n`;
        alertText += `   💡 **ACTION:** Consider increasing budget for this campaign!\n\n`;
      }
      
      alertText += `⏰ Alert time: ${now.toISOString().split('T')[1].split('.')[0]} UTC`;
      
      logInfo(`📤 Отправляю оперативный алерт по ${alertsToSend.length} кампаниям`);
      return alertText;
      
    } catch (error) {
      logError('Error checking real-time campaign alert', error);
      return null; // Не бросаем ошибку, чтобы не ломать синхронизацию
    }
  }

  /**
   * Оперативный алерт: креативы с 10+ покупками за час
   * Вызывается автоматически после каждой синхронизации
   */
  async checkRealTimeCreativeAlert() {
    try {
      logInfo('⚡ Проверяю оперативные алерты по креативам...');
      
      const paymentsSheet = await googleSheets.getSheetByName('payments');
      const lowPriceSheet = await googleSheets.getSheetByName('LowPrice');
      
      await fetchWithRetry(() => paymentsSheet.loadHeaderRow(), 5, 2000);
      await fetchWithRetry(() => lowPriceSheet.loadHeaderRow(), 5, 2000);
      
      const paymentsRows = await fetchWithRetry(() => paymentsSheet.getRows(), 5, 2000);
      const lowPriceRows = await fetchWithRetry(() => lowPriceSheet.getRows(), 5, 2000);
      
      // Попытаемся получить данные из Primer листа (если он существует)
      let primerRows = [];
      try {
        const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
        const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
        await fetchWithRetry(() => primerSheet.loadHeaderRow(), 5, 2000);
        primerRows = await fetchWithRetry(() => primerSheet.getRows(), 5, 2000);
      } catch (error) {
        // Primer лист не существует или не настроен - это нормально
      }
      
      const allRows = [...paymentsRows, ...lowPriceRows, ...primerRows];
      
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const currentHour = now.getUTCHours();
      
      // Покупки за последний час
      const lastHourPurchases = allRows.filter(row => {
        const createdUTC = row.get('Created UTC') || '';
        if (!createdUTC) return false;
        const purchaseDate = new Date(createdUTC);
        return purchaseDate >= oneHourAgo;
      });
      
      if (lastHourPurchases.length === 0) {
        return null;
      }
      
      // Группируем по креативам
      const creativeStats = new Map();
      
      for (const purchase of lastHourPurchases) {
        const adName = purchase.get('Ad Name') || '';
        const campaignName = purchase.get('Campaign Name') || purchase.get('UTM Campaign') || '';
        const adsetName = purchase.get('Adset Name') || '';
        const amount = parseFloat(purchase.get('Total Amount') || 0);
        
        if (adName && adName !== 'N/A') {
          if (!creativeStats.has(adName)) {
            creativeStats.set(adName, {
              name: adName,
              campaign: campaignName,
              adset: adsetName,
              purchases: 0,
              revenue: 0,
              adsets: new Set()
            });
          }
          const stat = creativeStats.get(adName);
          stat.purchases++;
          stat.revenue += amount;
          if (adsetName) stat.adsets.add(adsetName);
        }
      }
      
      // Находим креативы с 10+ покупками за час
      const hotCreatives = Array.from(creativeStats.values())
        .filter(stat => stat.purchases >= this.thresholds.creativeHourlyThreshold)
        .sort((a, b) => b.purchases - a.purchases);
      
      if (hotCreatives.length === 0) {
        return null;
      }
      
      // Проверяем, не отправляли ли мы уже алерт для этих креативов в этом часу
      const alertsToSend = [];
      
      for (const creative of hotCreatives) {
        const alertKey = `creative_${creative.name}_${currentHour}`;
        
        if (!this.sentRealTimeAlerts.has(alertKey)) {
          alertsToSend.push(creative);
          this.sentRealTimeAlerts.set(alertKey, true);
          
          // Очищаем старые записи (старше 2 часов)
          setTimeout(() => {
            this.sentRealTimeAlerts.delete(alertKey);
          }, 2 * 60 * 60 * 1000);
        }
      }
      
      if (alertsToSend.length === 0) {
        return null;
      }
      
      // Формируем алерт
      let alertText = `⚡ **REAL-TIME ALERT: Hot Creatives (Last Hour)**\n\n`;
      alertText += `📊 Total purchases last hour: ${lastHourPurchases.length}\n\n`;
      
      alertText += `🔥 **Creatives with ${this.thresholds.creativeHourlyThreshold}+ purchases:**\n\n`;
      
      for (let i = 0; i < alertsToSend.length; i++) {
        const creative = alertsToSend[i];
        alertText += `${i + 1}. **${creative.name}**\n`;
        alertText += `   📦 Purchases: ${creative.purchases}\n`;
        alertText += `   💰 Revenue: $${creative.revenue.toFixed(2)}\n`;
        alertText += `   🎯 Campaign: ${creative.campaign}\n`;
        alertText += `   📋 Current Adsets: ${creative.adsets.size}\n`;
        alertText += `   💡 **ACTION:** Scale this creative to other ad sets!\n\n`;
      }
      
      alertText += `⏰ Alert time: ${now.toISOString().split('T')[1].split('.')[0]} UTC`;
      
      logInfo(`📤 Отправляю оперативный алерт по ${alertsToSend.length} креативам`);
      return alertText;
      
    } catch (error) {
      logError('Error checking real-time creative alert', error);
      return null; // Не бросаем ошибку, чтобы не ломать синхронизацию
    }
  }

  /**
   * Проверяет все оперативные алерты (кампании и креативы)
   * Вызывается после каждой синхронизации
   */
  async checkAllRealTimeAlerts() {
    try {
      const alerts = [];
      
      // Проверяем кампании
      const campaignAlert = await this.checkRealTimeCampaignAlert();
      if (campaignAlert) alerts.push(campaignAlert);
      
      // Проверяем креативы
      const creativeAlert = await this.checkRealTimeCreativeAlert();
      if (creativeAlert) alerts.push(creativeAlert);
      
      if (alerts.length === 0) {
        return null;
      }
      
      return alerts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
    } catch (error) {
      logError('Error checking all real-time alerts', error);
      return null;
    }
  }

  // Run all smart alerts
  async runAllChecks() {
    try {
      logInfo('🔍 Running smart alerts checks...');
      
      const results = {
        revenueAnomaly: await this.checkRevenueAnomaly(),
        newGeoAlert: await this.checkNewGeoAlert(),
        conversionDrop: await this.checkConversionDrop()
      };
      
      const alertsSent = Object.values(results).filter(Boolean).length;
      
      logInfo('Smart alerts completed', { 
        results, 
        alertsSent,
        totalChecks: Object.keys(results).length 
      });
      
      return results;
    } catch (error) {
      logError('Error running smart alerts', error);
      return { error: error.message };
    }
  }
}

// Export singleton instance
export const smartAlerts = new SmartAlerts();
export default smartAlerts;
