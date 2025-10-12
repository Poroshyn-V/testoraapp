import { logInfo, logError } from '../utils/logging.js';
import { formatWeeklyReport, formatGeoAlert, formatCreativeAlert } from '../utils/formatting.js';
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
  
  // Generate GEO alert
  async generateGeoAlert() {
    try {
      logInfo('Generating GEO alert...');
      
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
      
      // Analyze GEO data
      const geoStats = new Map();
      
      for (const purchase of todayPurchases) {
        const geo = purchase.get('GEO') || '';
        const country = geo.split(',')[0].trim();
        if (country) {
          geoStats.set(country, (geoStats.get(country) || 0) + 1);
        }
      }
      
      // Top countries
      const topCountries = Array.from(geoStats.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      
      const alertData = {
        topCountries,
        totalSales: todayPurchases.length,
        date: todayStart.toISOString().split('T')[0]
      };
      
      const alertText = formatGeoAlert(alertData);
      
      logInfo('GEO alert generated successfully', {
        totalSales: todayPurchases.length,
        topCountries: topCountries.length
      });
      
      return alertText;
      
    } catch (error) {
      logError('Error generating GEO alert', error);
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
