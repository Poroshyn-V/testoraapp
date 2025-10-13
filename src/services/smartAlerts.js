import { logInfo, logError } from '../utils/logging.js';
import googleSheets from './googleSheets.js';
import { metrics } from './metrics.js';
import AlertPriority from './alertPriority.js';
import { alertConfig } from '../config/alertConfig.js';

// Smart alerts service
export class SmartAlerts {
  constructor() {
    this.thresholds = {
      revenue_drop_percent: alertConfig.revenueDrop,
      conversion_drop_percent: alertConfig.conversionDrop,
      payment_failure_rate: alertConfig.paymentFailureRate,
      new_geo_threshold: 5 // Если >5 покупок из новой страны
    };
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
