/**
 * Campaign Analysis Service
 * Analyzes campaign performance and provides actionable recommendations
 */

import googleSheets from './googleSheets.js';
import { logger } from '../utils/logging.js';
import { sendTextNotifications } from './notifications.js';
import { alertCooldown } from '../utils/alertCooldown.js';

class CampaignAnalyzer {
  constructor() {
    // Настройки анализа
    this.thresholds = {
      minPurchasesForAnalysis: 10, // Минимум покупок для анализа
      scaleCandidateMultiplier: 2, // Если кампания в 2+ раза лучше средней
      pauseCandidateMultiplier: 0.5, // Если кампания хуже 50% от средней
      minDailySpend: 50, // Минимум $50/день для рекомендаций
      topPerformersCount: 5, // Топ-5 кампаний
      lowPerformersCount: 5 // Худшие 5 кампаний
    };
  }

  // Главный метод анализа
  async analyzeCampaigns(timeframe = 'today') {
    try {
      logger.info('📊 Starting campaign analysis...', { timeframe });
      
      const rows = await googleSheets.getAllRows();
      const purchases = this.filterByTimeframe(rows, timeframe);
      
      if (purchases.length === 0) {
        logger.warn('No purchases found for analysis', { timeframe });
        return null;
      }
      
      // Группируем по кампаниям
      const campaignStats = this.groupByCampaign(purchases);
      
      // Вычисляем метрики
      const analyzed = this.calculateMetrics(campaignStats);
      
      // Генерируем рекомендации
      const recommendations = this.generateRecommendations(analyzed);
      
      logger.info('✅ Campaign analysis completed', {
        totalCampaigns: analyzed.length,
        recommendations: recommendations.scale.length + recommendations.pause.length
      });
      
      return {
        timeframe,
        totalPurchases: purchases.length,
        totalRevenue: purchases.reduce((sum, p) => sum + parseFloat(p.get('Total Amount') || 0), 0),
        campaigns: analyzed,
        recommendations,
        generatedAt: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('Error analyzing campaigns', error);
      throw error;
    }
  }

  // Фильтрация покупок по времени
  filterByTimeframe(rows, timeframe) {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    
    let startDate, endDate;
    
    switch (timeframe) {
      case 'today':
        startDate = new Date(utcPlus1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(utcPlus1);
        endDate.setHours(23, 59, 59, 999);
        break;
        
      case 'yesterday':
        startDate = new Date(utcPlus1);
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
        break;
        
      case 'week':
        startDate = new Date(utcPlus1);
        startDate.setDate(startDate.getDate() - 7);
        endDate = new Date(utcPlus1);
        break;
        
      case 'month':
        startDate = new Date(utcPlus1);
        startDate.setDate(startDate.getDate() - 30);
        endDate = new Date(utcPlus1);
        break;
        
      default:
        startDate = new Date(utcPlus1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(utcPlus1);
        endDate.setHours(23, 59, 59, 999);
    }
    
    return rows.filter(row => {
      const createdLocal = row.get('Created Local (UTC+1)') || '';
      if (!createdLocal) return false;
      
      const purchaseDate = new Date(createdLocal);
      return purchaseDate >= startDate && purchaseDate <= endDate;
    });
  }

  // Группировка по кампаниям
  groupByCampaign(purchases) {
    const campaigns = new Map();
    
    for (const purchase of purchases) {
      const campaignName = purchase.get('UTM Campaign') || purchase.get('Campaign Name') || 'Unknown';
      const adsetName = purchase.get('Adset Name') || 'Unknown';
      const adName = purchase.get('Ad Name') || 'Unknown';
      const creativeLink = purchase.get('Creative Link') || 'N/A';
      
      // Группируем по Campaign -> Adset -> Ad
      const campaignKey = campaignName;
      
      if (!campaigns.has(campaignKey)) {
        campaigns.set(campaignKey, {
          name: campaignName,
          adsets: new Map(),
          purchases: [],
          revenue: 0,
          count: 0
        });
      }
      
      const campaign = campaigns.get(campaignKey);
      campaign.purchases.push(purchase);
      campaign.revenue += parseFloat(purchase.get('Total Amount') || 0);
      campaign.count++;
      
      // Группируем Adsets
      if (!campaign.adsets.has(adsetName)) {
        campaign.adsets.set(adsetName, {
          name: adsetName,
          ads: new Map(),
          purchases: [],
          revenue: 0,
          count: 0
        });
      }
      
      const adset = campaign.adsets.get(adsetName);
      adset.purchases.push(purchase);
      adset.revenue += parseFloat(purchase.get('Total Amount') || 0);
      adset.count++;
      
      // Группируем Ads
      if (!adset.ads.has(adName)) {
        adset.ads.set(adName, {
          name: adName,
          creativeLink,
          purchases: [],
          revenue: 0,
          count: 0
        });
      }
      
      const ad = adset.ads.get(adName);
      ad.purchases.push(purchase);
      ad.revenue += parseFloat(purchase.get('Total Amount') || 0);
      ad.count++;
    }
    
    return campaigns;
  }

  // Вычисление метрик
  calculateMetrics(campaignStats) {
    const campaigns = [];
    
    for (const [campaignName, data] of campaignStats) {
      if (data.count < this.thresholds.minPurchasesForAnalysis) {
        continue; // Пропускаем кампании с малым количеством данных
      }
      
      const avgOrderValue = data.revenue / data.count;
      
      // Анализ по Adsets
      const topAdsets = Array.from(data.adsets.values())
        .map(adset => ({
          name: adset.name,
          revenue: adset.revenue,
          count: adset.count,
          aov: adset.revenue / adset.count
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 3);
      
      // Анализ по Ads
      const allAds = [];
      for (const adset of data.adsets.values()) {
        for (const ad of adset.ads.values()) {
          allAds.push({
            name: ad.name,
            creativeLink: ad.creativeLink,
            revenue: ad.revenue,
            count: ad.count,
            aov: ad.revenue / ad.count
          });
        }
      }
      
      const topAds = allAds
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 3);
      
      campaigns.push({
        name: campaignName,
        revenue: data.revenue,
        purchases: data.count,
        aov: avgOrderValue,
        topAdsets,
        topAds,
        adsetsCount: data.adsets.size
      });
    }
    
    return campaigns.sort((a, b) => b.revenue - a.revenue);
  }

  // Генерация рекомендаций
  generateRecommendations(campaigns) {
    if (campaigns.length === 0) {
      return { scale: [], pause: [], optimize: [] };
    }
    
    // Вычисляем средние метрики
    const totalRevenue = campaigns.reduce((sum, c) => sum + c.revenue, 0);
    const totalPurchases = campaigns.reduce((sum, c) => sum + c.purchases, 0);
    const avgRevenue = totalRevenue / campaigns.length;
    const avgPurchases = totalPurchases / campaigns.length;
    const avgAOV = totalRevenue / totalPurchases;
    
    const scale = [];
    const pause = [];
    const optimize = [];
    
    for (const campaign of campaigns) {
      // Рекомендация МАСШТАБИРОВАТЬ
      if (
        campaign.revenue > avgRevenue * this.thresholds.scaleCandidateMultiplier &&
        campaign.purchases >= this.thresholds.minPurchasesForAnalysis
      ) {
        const improvement = Math.round(((campaign.revenue / avgRevenue) - 1) * 100);
        scale.push({
          campaign: campaign.name,
          revenue: campaign.revenue,
          purchases: campaign.purchases,
          aov: campaign.aov,
          reason: `${improvement}% выше средней выручки`,
          recommendation: `Увеличить бюджет на 20-30%`,
          priority: 'high'
        });
      }
      
      // Рекомендация ПОСТАВИТЬ НА ПАУЗУ
      else if (
        campaign.revenue < avgRevenue * this.thresholds.pauseCandidateMultiplier &&
        campaign.purchases >= 5
      ) {
        const underperformance = Math.round((1 - (campaign.revenue / avgRevenue)) * 100);
        pause.push({
          campaign: campaign.name,
          revenue: campaign.revenue,
          purchases: campaign.purchases,
          aov: campaign.aov,
          reason: `${underperformance}% ниже средней выручки`,
          recommendation: `Приостановить и перераспределить бюджет`,
          priority: 'medium'
        });
      }
      
      // Рекомендация ОПТИМИЗИРОВАТЬ
      else if (
        campaign.purchases >= this.thresholds.minPurchasesForAnalysis &&
        campaign.aov < avgAOV * 0.8
      ) {
        optimize.push({
          campaign: campaign.name,
          revenue: campaign.revenue,
          purchases: campaign.purchases,
          aov: campaign.aov,
          reason: `AOV ниже среднего на ${Math.round((1 - campaign.aov/avgAOV) * 100)}%`,
          recommendation: `Тестировать апселлы или повысить цену`,
          priority: 'low'
        });
      }
    }
    
    return {
      scale: scale.sort((a, b) => b.revenue - a.revenue),
      pause: pause.sort((a, b) => a.revenue - b.revenue),
      optimize: optimize.sort((a, b) => a.aov - b.aov),
      benchmarks: {
        avgRevenue,
        avgPurchases,
        avgAOV,
        totalCampaigns: campaigns.length
      }
    };
  }

  // Форматирование отчета для Telegram
  formatReport(analysis) {
    if (!analysis) return null;
    
    const { campaigns, recommendations, totalRevenue, totalPurchases } = analysis;
    
    let report = `📊 CAMPAIGN PERFORMANCE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Period: ${analysis.timeframe}
💰 Total Revenue: $${totalRevenue.toFixed(2)}
🛒 Total Purchases: ${totalPurchases}
📈 Average AOV: $${(totalRevenue / totalPurchases).toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    // TOP PERFORMERS
    if (campaigns.length > 0) {
      report += `\n🏆 TOP PERFORMING CAMPAIGNS:\n`;
      campaigns.slice(0, 3).forEach((c, i) => {
        report += `${i + 1}. ${c.name}
   💰 $${c.revenue.toFixed(2)} | 🛒 ${c.purchases} | 📊 AOV: $${c.aov.toFixed(2)}\n`;
      });
    }

    // SCALE RECOMMENDATIONS
    if (recommendations.scale.length > 0) {
      report += `\n🚀 SCALE THESE CAMPAIGNS:\n`;
      recommendations.scale.forEach((r, i) => {
        report += `${i + 1}. ${r.campaign}
   💰 $${r.revenue.toFixed(2)} | 🛒 ${r.purchases}
   ✅ ${r.reason}
   💡 ${r.recommendation}\n`;
      });
    }

    // PAUSE RECOMMENDATIONS
    if (recommendations.pause.length > 0) {
      report += `\n⛔ CONSIDER PAUSING:\n`;
      recommendations.pause.forEach((r, i) => {
        report += `${i + 1}. ${r.campaign}
   💰 $${r.revenue.toFixed(2)} | 🛒 ${r.purchases}
   ⚠️ ${r.reason}
   💡 ${r.recommendation}\n`;
      });
    }

    // OPTIMIZE RECOMMENDATIONS
    if (recommendations.optimize.length > 0 && recommendations.optimize.length <= 3) {
      report += `\n🔧 OPTIMIZATION OPPORTUNITIES:\n`;
      recommendations.optimize.forEach((r, i) => {
        report += `${i + 1}. ${r.campaign}
   📊 AOV: $${r.aov.toFixed(2)}
   💡 ${r.recommendation}\n`;
      });
    }

    report += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 Benchmarks:
   Avg Revenue: $${recommendations.benchmarks.avgRevenue.toFixed(2)}
   Avg Purchases: ${recommendations.benchmarks.avgPurchases.toFixed(0)}
   Avg AOV: $${recommendations.benchmarks.avgAOV.toFixed(2)}`;

    return report;
  }

  // Автоматическая отправка отчета
  async sendDailyReport() {
    try {
      const alertType = 'campaign_analysis';
      
      if (!alertCooldown.canSend(alertType, 60 * 12)) { // 12 hours cooldown
        logger.info('Campaign analysis cooldown active');
        return null;
      }
      
      const analysis = await this.analyzeCampaigns('today');
      
      if (!analysis) {
        logger.info('No data for campaign analysis');
        return null;
      }
      
      // Отправляем только если есть рекомендации
      const hasRecommendations = 
        analysis.recommendations.scale.length > 0 ||
        analysis.recommendations.pause.length > 0;
      
      if (!hasRecommendations) {
        logger.info('No actionable recommendations found');
        return null;
      }
      
      const report = this.formatReport(analysis);
      await sendTextNotifications(report);
      
      alertCooldown.markSent(alertType);
      
      logger.info('✅ Campaign analysis report sent', {
        scaleRecommendations: analysis.recommendations.scale.length,
        pauseRecommendations: analysis.recommendations.pause.length
      });
      
      return analysis;
      
    } catch (error) {
      logger.error('Error sending campaign analysis', error);
      return null;
    }
  }

  // Детальный анализ конкретной кампании
  async analyzeSingleCampaign(campaignName, timeframe = 'week') {
    try {
      const rows = await googleSheets.getAllRows();
      const timeframePurchases = this.filterByTimeframe(rows, timeframe);
      
      // Debug: log all unique campaign names in timeframe
      const uniqueCampaigns = [...new Set(timeframePurchases.map(row => row.get('UTM Campaign') || row.get('Campaign Name') || 'Unknown'))];
      logger.info('Debug: Unique campaigns in timeframe', { 
        timeframe, 
        uniqueCampaigns, 
        requestedCampaign: campaignName 
      });
      
      const purchases = timeframePurchases.filter(row => {
        const rowCampaignName = row.get('UTM Campaign') || row.get('Campaign Name') || 'Unknown';
        return rowCampaignName === campaignName;
      });
      
      if (purchases.length === 0) {
        return {
          error: 'No purchases found for this campaign',
          campaignName,
          timeframe,
          availableCampaigns: uniqueCampaigns,
          totalPurchasesInTimeframe: timeframePurchases.length
        };
      }
      
      // Группировка по дням
      const dailyStats = new Map();
      
      for (const purchase of purchases) {
        const date = purchase.get('Created Local (UTC+1)')?.split(' ')[0] || 'Unknown';
        
        if (!dailyStats.has(date)) {
          dailyStats.set(date, {
            date,
            revenue: 0,
            purchases: 0,
            customers: new Set()
          });
        }
        
        const day = dailyStats.get(date);
        day.revenue += parseFloat(purchase.get('Total Amount') || 0);
        day.purchases++;
        day.customers.add(purchase.get('Email') || '');
      }
      
      // Конвертируем Set в count
      const dailyData = Array.from(dailyStats.values()).map(day => ({
        date: day.date,
        revenue: day.revenue,
        purchases: day.purchases,
        uniqueCustomers: day.customers.size,
        aov: day.revenue / day.purchases
      }));
      
      // Топ креативы
      const creativeStats = new Map();
      
      for (const purchase of purchases) {
        const creative = purchase.get('Creative Link') || 'Unknown';
        
        if (!creativeStats.has(creative)) {
          creativeStats.set(creative, {
            creative,
            revenue: 0,
            purchases: 0
          });
        }
        
        const stat = creativeStats.get(creative);
        stat.revenue += parseFloat(purchase.get('Total Amount') || 0);
        stat.purchases++;
      }
      
      const topCreatives = Array.from(creativeStats.values())
        .map(c => ({
          ...c,
          aov: c.revenue / c.purchases
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
      
      return {
        campaignName,
        timeframe,
        summary: {
          totalRevenue: purchases.reduce((sum, p) => sum + parseFloat(p.get('Total Amount') || 0), 0),
          totalPurchases: purchases.length,
          uniqueCustomers: new Set(purchases.map(p => p.get('Email'))).size,
          avgAOV: purchases.reduce((sum, p) => sum + parseFloat(p.get('Total Amount') || 0), 0) / purchases.length
        },
        dailyBreakdown: dailyData.sort((a, b) => a.date.localeCompare(b.date)),
        topCreatives
      };
      
    } catch (error) {
      logger.error('Error analyzing single campaign', error);
      throw error;
    }
  }
}

export const campaignAnalyzer = new CampaignAnalyzer();
