import { logInfo, logError, logWarn } from '../utils/logging.js';
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
      new_geo_threshold: 5,
      // Campaign thresholds
      campaignHourlyThreshold: 5,
      // Tiered creative thresholds
      creativeHotThreshold: 10,       // 10+/hour — Hot Creative
      creativeScaleThreshold: 20,     // 20+/hour — Top Performer, Consider Scaling
      creativeUrgentThreshold: 30,    // 30+/hour — SCALE NOW
      // Creative death: was performing well, now dropped
      creativeDeathMinPrevious: 8,    // Was doing at least 8/hour previously
      creativeDeathMaxCurrent: 2,     // Now doing 0-2/hour
      // Minimum hour of day (UTC) before revenue/conversion alerts fire
      // Prevents false alarms in the morning when data is still low
      minHourForDailyAlerts: 12       // Only fire after 12:00 UTC (~afternoon)
    };

    // Cache for sent real-time alerts
    this.sentRealTimeAlerts = new Map();

    // Cache for previous hour creative stats (for death detection)
    this.previousHourCreativeStats = new Map(); // adName -> { purchases, hour }
  }

  /**
   * Load rows from ALL sheets (payments + LowPrice + Primer)
   * Uses Created UTC for universal date filtering
   */
  async loadAllSheetRows() {
    const allRows = [];

    // payments sheet
    try {
      const paymentsSheet = await googleSheets.getSheetByName('payments');
      await fetchWithRetry(() => paymentsSheet.loadHeaderRow(), 3, 2000);
      const rows = await fetchWithRetry(() => paymentsSheet.getRows(), 3, 2000);
      allRows.push(...rows);
      logInfo(`✅ Loaded ${rows.length} rows from payments sheet`);
    } catch (error) {
      logWarn(`⚠️ Could not load payments sheet: ${error.message}`);
    }

    // LowPrice sheet
    try {
      const lowPriceSheet = await googleSheets.getSheetByName('LowPrice');
      await fetchWithRetry(() => lowPriceSheet.loadHeaderRow(), 3, 2000);
      const rows = await fetchWithRetry(() => lowPriceSheet.getRows(), 3, 2000);
      allRows.push(...rows);
      logInfo(`✅ Loaded ${rows.length} rows from LowPrice sheet`);
    } catch (error) {
      logWarn(`⚠️ Could not load LowPrice sheet: ${error.message}`);
    }

    // Primer sheet
    try {
      const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
      const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
      await fetchWithRetry(() => primerSheet.loadHeaderRow(), 3, 2000);
      const rows = await fetchWithRetry(() => primerSheet.getRows(), 3, 2000);
      allRows.push(...rows);
      logInfo(`✅ Loaded ${rows.length} rows from ${PRIMER_SHEET_NAME} sheet`);
    } catch (error) {
      const errorMessage = error?.message || '';
      const isQuotaError = errorMessage.includes('429') || errorMessage.includes('Quota exceeded');
      if (isQuotaError) {
        logWarn('⚠️ Google Sheets quota exceeded for Primer sheet, skipping');
      } else {
        logInfo(`ℹ️ Primer sheet not available: ${errorMessage}`);
      }
    }

    return allRows;
  }

  /**
   * Get the Created UTC date string from a row (works for all sheets)
   */
  getRowDateUTC(row) {
    const createdUTC = row.get('Created UTC') || '';
    if (createdUTC) return createdUTC.split('T')[0]; // YYYY-MM-DD
    // Fallback: try local columns
    const createdLocal = row.get('Created Local (UTC+1)') || row.get('Created Local (UTC-8)') || '';
    if (createdLocal) return createdLocal.split(' ')[0]; // YYYY-MM-DD
    return '';
  }

  /**
   * Get the Created UTC Date object from a row
   */
  getRowDateObj(row) {
    const createdUTC = row.get('Created UTC') || '';
    if (createdUTC) return new Date(createdUTC);
    return null;
  }

  /**
   * Filter rows by UTC date string (YYYY-MM-DD)
   */
  filterRowsByDate(rows, dateStr) {
    return rows.filter(row => this.getRowDateUTC(row) === dateStr);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // REVENUE ANOMALY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkRevenueAnomaly() {
    try {
      const now = new Date();
      const currentHourUTC = now.getUTCHours();

      // Don't fire before minHourForDailyAlerts to avoid false morning alerts
      if (currentHourUTC < this.thresholds.minHourForDailyAlerts) {
        logInfo(`⏭️ Revenue check skipped: too early (${currentHourUTC}:00 UTC, min: ${this.thresholds.minHourForDailyAlerts}:00)`);
        return false;
      }

      const rows = await this.loadAllSheetRows();
      const todayStr = now.toISOString().split('T')[0];

      // Today's revenue (all sheets)
      const todayRevenue = this.filterRowsByDate(rows, todayStr)
        .reduce((sum, row) => sum + parseFloat(row.get('Total Amount') || 0), 0);

      // 7-day average revenue — but only up to the SAME hour of day
      // This prevents "it's 10am and we only have 30% of a full day's revenue" false alarms
      const avgSameHour = this.getAvgRevenueByHour(rows, currentHourUTC);

      if (avgSameHour <= 0) return false;

      if (todayRevenue < avgSameHour * (1 - this.thresholds.revenue_drop_percent / 100)) {
        const drop = Math.round(((avgSameHour - todayRevenue) / avgSameHour) * 100);

        const alert = `🚨 REVENUE DROP ALERT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Today so far: $${todayRevenue.toFixed(2)}
📊 7-Day avg (same time): $${avgSameHour.toFixed(2)}
📉 Drop: ${drop}%
⏰ As of ${currentHourUTC}:00 UTC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ Immediate attention required!`;

        await AlertPriority.sendAlert(alert, AlertPriority.HIGH, {
          type: 'revenue_drop',
          today: todayRevenue,
          average: avgSameHour,
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

  /**
   * Get average revenue for the last 7 days, but only counting purchases
   * up to the same hour of day (UTC) to make fair comparison
   */
  getAvgRevenueByHour(rows, currentHourUTC) {
    const revenues = [];
    const now = new Date();

    for (let i = 1; i <= 7; i++) {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Only count purchases from that day up to the same hour
      const cutoffHour = currentHourUTC;
      const dayRevenue = rows
        .filter(row => {
          if (this.getRowDateUTC(row) !== dateStr) return false;
          const dateObj = this.getRowDateObj(row);
          return dateObj && dateObj.getUTCHours() <= cutoffHour;
        })
        .reduce((sum, row) => sum + parseFloat(row.get('Total Amount') || 0), 0);

      revenues.push(dayRevenue);
    }

    return revenues.reduce((a, b) => a + b, 0) / revenues.length;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONVERSION DROP
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkConversionDrop() {
    try {
      const now = new Date();
      const currentHourUTC = now.getUTCHours();

      if (currentHourUTC < this.thresholds.minHourForDailyAlerts) {
        logInfo(`⏭️ Conversion check skipped: too early (${currentHourUTC}:00 UTC)`);
        return false;
      }

      const rows = await this.loadAllSheetRows();
      const todayStr = now.toISOString().split('T')[0];

      const todayPurchases = this.filterRowsByDate(rows, todayStr).length;
      const avgSameHour = this.getAvgPurchasesByHour(rows, currentHourUTC);

      if (avgSameHour <= 0) return false;

      if (todayPurchases < avgSameHour * (1 - this.thresholds.conversion_drop_percent / 100)) {
        const drop = Math.round(((avgSameHour - todayPurchases) / avgSameHour) * 100);

        const alert = `📉 CONVERSION DROP ALERT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛒 Today's Purchases: ${todayPurchases}
📊 7-Day avg (same time): ${avgSameHour.toFixed(1)}
📉 Drop: ${drop}%
⏰ As of ${currentHourUTC}:00 UTC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Check your campaigns!`;

        await AlertPriority.sendAlert(alert, AlertPriority.MEDIUM, {
          type: 'conversion_drop',
          today: todayPurchases,
          average: avgSameHour,
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

  getAvgPurchasesByHour(rows, currentHourUTC) {
    const counts = [];
    const now = new Date();

    for (let i = 1; i <= 7; i++) {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayCount = rows.filter(row => {
        if (this.getRowDateUTC(row) !== dateStr) return false;
        const dateObj = this.getRowDateObj(row);
        return dateObj && dateObj.getUTCHours() <= currentHourUTC;
      }).length;

      counts.push(dayCount);
    }

    return counts.reduce((a, b) => a + b, 0) / counts.length;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NEW GEO
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkNewGeoAlert() {
    try {
      const rows = await this.loadAllSheetRows();
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      // Countries from last 30 days (excluding today)
      const last30DaysCountries = new Set();
      for (let i = 1; i <= 30; i++) {
        const date = new Date(now);
        date.setUTCDate(date.getUTCDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        this.filterRowsByDate(rows, dateStr).forEach(row => {
          const geo = row.get('GEO') || '';
          const country = geo.split(',')[0].trim();
          if (country && country !== 'Unknown') last30DaysCountries.add(country);
        });
      }

      // Today's countries
      const todayCountries = new Set();
      this.filterRowsByDate(rows, todayStr).forEach(row => {
        const geo = row.get('GEO') || '';
        const country = geo.split(',')[0].trim();
        if (country && country !== 'Unknown') todayCountries.add(country);
      });

      const newCountries = Array.from(todayCountries).filter(c => !last30DaysCountries.has(c));

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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CAMPAIGN ALERT (5+/hour)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkRealTimeCampaignAlert() {
    try {
      logInfo('⚡ Checking real-time campaign alerts...');

      const allRows = await this.loadAllSheetRows();
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const currentHour = now.getUTCHours();

      const lastHourPurchases = allRows.filter(row => {
        const dateObj = this.getRowDateObj(row);
        return dateObj && dateObj >= oneHourAgo;
      });

      if (lastHourPurchases.length === 0) return null;

      // Group by campaign
      const campaignStats = new Map();
      for (const purchase of lastHourPurchases) {
        const campaignName = purchase.get('Campaign Name') || purchase.get('UTM Campaign') || '';
        const amount = parseFloat(purchase.get('Total Amount') || 0);

        if (campaignName && campaignName !== 'N/A') {
          if (!campaignStats.has(campaignName)) {
            campaignStats.set(campaignName, { name: campaignName, purchases: 0, revenue: 0 });
          }
          const stat = campaignStats.get(campaignName);
          stat.purchases++;
          stat.revenue += amount;
        }
      }

      const hotCampaigns = Array.from(campaignStats.values())
        .filter(stat => stat.purchases >= this.thresholds.campaignHourlyThreshold)
        .sort((a, b) => b.purchases - a.purchases);

      if (hotCampaigns.length === 0) return null;

      // Dedup by hour
      const alertsToSend = [];
      for (const campaign of hotCampaigns) {
        const alertKey = `campaign_${campaign.name}_${currentHour}`;
        if (!this.sentRealTimeAlerts.has(alertKey)) {
          alertsToSend.push(campaign);
          this.sentRealTimeAlerts.set(alertKey, true);
          setTimeout(() => this.sentRealTimeAlerts.delete(alertKey), 2 * 60 * 60 * 1000);
        }
      }

      if (alertsToSend.length === 0) return null;

      let alertText = `⚡ HOT CAMPAIGNS (Last Hour)\n`;
      alertText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      alertText += `📊 Total purchases last hour: ${lastHourPurchases.length}\n\n`;

      for (let i = 0; i < alertsToSend.length; i++) {
        const c = alertsToSend[i];
        alertText += `${i + 1}. ${c.name}\n`;
        alertText += `   📦 ${c.purchases} purchases | 💰 $${c.revenue.toFixed(2)}\n`;
        alertText += `   💡 Consider increasing budget!\n\n`;
      }

      alertText += `⏰ ${now.toISOString().split('T')[1].split('.')[0]} UTC`;

      logInfo(`📤 Sending campaign alert for ${alertsToSend.length} campaigns`);
      return alertText;

    } catch (error) {
      const errorMessage = error?.message || '';
      if (errorMessage.includes('429') || errorMessage.includes('Quota exceeded')) {
        logWarn('⚠️ Google Sheets quota exceeded, skipping campaign alert');
        return null;
      }
      logError('Error checking real-time campaign alert', error);
      return null;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TIERED CREATIVE ALERT (10/20/30 per hour)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkRealTimeCreativeAlert() {
    try {
      logInfo('⚡ Checking real-time creative alerts...');

      const allRows = await this.loadAllSheetRows();
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const currentHour = now.getUTCHours();

      const lastHourPurchases = allRows.filter(row => {
        const dateObj = this.getRowDateObj(row);
        return dateObj && dateObj >= oneHourAgo;
      });

      if (lastHourPurchases.length === 0) return null;

      // Group by creative
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

      // Save current stats for creative death detection in next cycle
      for (const [name, stat] of creativeStats) {
        this.previousHourCreativeStats.set(name, { purchases: stat.purchases, hour: currentHour });
      }

      // Tiered filtering
      const urgentCreatives = []; // 30+
      const scaleCreatives = [];  // 20-29
      const hotCreatives = [];    // 10-19

      for (const stat of creativeStats.values()) {
        if (stat.purchases >= this.thresholds.creativeUrgentThreshold) {
          urgentCreatives.push(stat);
        } else if (stat.purchases >= this.thresholds.creativeScaleThreshold) {
          scaleCreatives.push(stat);
        } else if (stat.purchases >= this.thresholds.creativeHotThreshold) {
          hotCreatives.push(stat);
        }
      }

      // Sort each tier by purchases desc
      urgentCreatives.sort((a, b) => b.purchases - a.purchases);
      scaleCreatives.sort((a, b) => b.purchases - a.purchases);
      hotCreatives.sort((a, b) => b.purchases - a.purchases);

      const allTiered = [...urgentCreatives, ...scaleCreatives, ...hotCreatives];
      if (allTiered.length === 0) return null;

      // Dedup by hour
      const alertsToSend = { urgent: [], scale: [], hot: [] };

      for (const creative of urgentCreatives) {
        const alertKey = `creative_urgent_${creative.name}_${currentHour}`;
        if (!this.sentRealTimeAlerts.has(alertKey)) {
          alertsToSend.urgent.push(creative);
          this.sentRealTimeAlerts.set(alertKey, true);
          setTimeout(() => this.sentRealTimeAlerts.delete(alertKey), 2 * 60 * 60 * 1000);
        }
      }

      for (const creative of scaleCreatives) {
        const alertKey = `creative_scale_${creative.name}_${currentHour}`;
        if (!this.sentRealTimeAlerts.has(alertKey)) {
          alertsToSend.scale.push(creative);
          this.sentRealTimeAlerts.set(alertKey, true);
          setTimeout(() => this.sentRealTimeAlerts.delete(alertKey), 2 * 60 * 60 * 1000);
        }
      }

      for (const creative of hotCreatives) {
        const alertKey = `creative_hot_${creative.name}_${currentHour}`;
        if (!this.sentRealTimeAlerts.has(alertKey)) {
          alertsToSend.hot.push(creative);
          this.sentRealTimeAlerts.set(alertKey, true);
          setTimeout(() => this.sentRealTimeAlerts.delete(alertKey), 2 * 60 * 60 * 1000);
        }
      }

      const totalAlerts = alertsToSend.urgent.length + alertsToSend.scale.length + alertsToSend.hot.length;
      if (totalAlerts === 0) return null;

      // Build alert text
      let alertText = `⚡ CREATIVE PERFORMANCE (Last Hour)\n`;
      alertText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      alertText += `📊 Total purchases last hour: ${lastHourPurchases.length}\n`;

      if (alertsToSend.urgent.length > 0) {
        alertText += `\n🚀🚀🚀 SCALE NOW (${this.thresholds.creativeUrgentThreshold}+/hour):\n\n`;
        for (const c of alertsToSend.urgent) {
          alertText += `   ${c.name}\n`;
          alertText += `   📦 ${c.purchases} purchases | 💰 $${c.revenue.toFixed(2)}\n`;
          alertText += `   🎯 Campaign: ${c.campaign}\n`;
          alertText += `   📋 Adsets: ${c.adsets.size}\n`;
          alertText += `   ⚡ ACTION: SCALE IMMEDIATELY!\n\n`;
        }
      }

      if (alertsToSend.scale.length > 0) {
        alertText += `\n📈 TOP PERFORMER (${this.thresholds.creativeScaleThreshold}+/hour):\n\n`;
        for (const c of alertsToSend.scale) {
          alertText += `   ${c.name}\n`;
          alertText += `   📦 ${c.purchases} purchases | 💰 $${c.revenue.toFixed(2)}\n`;
          alertText += `   🎯 Campaign: ${c.campaign}\n`;
          alertText += `   📋 Adsets: ${c.adsets.size}\n`;
          alertText += `   💡 ACTION: Consider scaling to more adsets\n\n`;
        }
      }

      if (alertsToSend.hot.length > 0) {
        alertText += `\n🔥 HOT CREATIVE (${this.thresholds.creativeHotThreshold}+/hour):\n\n`;
        for (const c of alertsToSend.hot) {
          alertText += `   ${c.name}\n`;
          alertText += `   📦 ${c.purchases} purchases | 💰 $${c.revenue.toFixed(2)}\n`;
          alertText += `   🎯 Campaign: ${c.campaign} | 📋 Adsets: ${c.adsets.size}\n\n`;
        }
      }

      alertText += `⏰ ${now.toISOString().split('T')[1].split('.')[0]} UTC`;

      logInfo(`📤 Sending tiered creative alert: ${alertsToSend.urgent.length} urgent, ${alertsToSend.scale.length} scale, ${alertsToSend.hot.length} hot`);
      return alertText;

    } catch (error) {
      const errorMessage = error?.message || '';
      if (errorMessage.includes('429') || errorMessage.includes('Quota exceeded')) {
        logWarn('⚠️ Google Sheets quota exceeded, skipping creative alert');
        return null;
      }
      logError('Error checking real-time creative alert', error);
      return null;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CREATIVE DEATH ALERT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkCreativeDeathAlert() {
    try {
      logInfo('💀 Checking for dying creatives...');

      const allRows = await this.loadAllSheetRows();
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const currentHour = now.getUTCHours();

      // Current hour purchases by creative
      const currentStats = new Map();
      const previousStats = new Map();

      for (const row of allRows) {
        const dateObj = this.getRowDateObj(row);
        if (!dateObj) continue;

        const adName = row.get('Ad Name') || '';
        if (!adName || adName === 'N/A') continue;

        if (dateObj >= oneHourAgo) {
          currentStats.set(adName, (currentStats.get(adName) || 0) + 1);
        } else if (dateObj >= twoHoursAgo && dateObj < oneHourAgo) {
          previousStats.set(adName, (previousStats.get(adName) || 0) + 1);
        }
      }

      // Also check in-memory cache from previous cycle
      for (const [name, data] of this.previousHourCreativeStats) {
        if (data.hour !== currentHour && !previousStats.has(name)) {
          previousStats.set(name, data.purchases);
        }
      }

      // Find creatives that were hot but are now dying
      const dyingCreatives = [];
      for (const [adName, prevCount] of previousStats) {
        if (prevCount >= this.thresholds.creativeDeathMinPrevious) {
          const currentCount = currentStats.get(adName) || 0;
          if (currentCount <= this.thresholds.creativeDeathMaxCurrent) {
            dyingCreatives.push({
              name: adName,
              previousHour: prevCount,
              currentHour: currentCount,
              dropPercent: Math.round(((prevCount - currentCount) / prevCount) * 100)
            });
          }
        }
      }

      if (dyingCreatives.length === 0) return null;

      // Dedup
      const alertsToSend = [];
      for (const creative of dyingCreatives) {
        const alertKey = `creative_death_${creative.name}_${currentHour}`;
        if (!this.sentRealTimeAlerts.has(alertKey)) {
          alertsToSend.push(creative);
          this.sentRealTimeAlerts.set(alertKey, true);
          setTimeout(() => this.sentRealTimeAlerts.delete(alertKey), 2 * 60 * 60 * 1000);
        }
      }

      if (alertsToSend.length === 0) return null;

      let alertText = `💀 CREATIVE DEATH ALERT\n`;
      alertText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      alertText += `Creatives that stopped performing:\n\n`;

      for (const c of alertsToSend) {
        alertText += `   ${c.name}\n`;
        alertText += `   📉 ${c.previousHour}/hour → ${c.currentHour}/hour (${c.dropPercent}% drop)\n`;
        alertText += `   ⚠️ ACTION: Check creative fatigue, pause or replace\n\n`;
      }

      alertText += `⏰ ${now.toISOString().split('T')[1].split('.')[0]} UTC`;

      logInfo(`📤 Sending creative death alert for ${alertsToSend.length} creatives`);
      return alertText;

    } catch (error) {
      logError('Error checking creative death alert', error);
      return null;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // REVENUE PACE ALERT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkRevenuePace() {
    try {
      const now = new Date();
      const currentHourUTC = now.getUTCHours();

      // Only run after at least a few hours of data
      if (currentHourUTC < 6) return null;

      const rows = await this.loadAllSheetRows();
      const todayStr = now.toISOString().split('T')[0];

      // Today's revenue so far
      const todayRevenue = this.filterRowsByDate(rows, todayStr)
        .reduce((sum, row) => sum + parseFloat(row.get('Total Amount') || 0), 0);

      // Project full day: (today_so_far / hours_elapsed) * 24
      const hoursElapsed = currentHourUTC + (now.getUTCMinutes() / 60);
      if (hoursElapsed <= 0) return null;
      const projectedDaily = (todayRevenue / hoursElapsed) * 24;

      // Yesterday's total
      const yesterday = new Date(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const yesterdayRevenue = this.filterRowsByDate(rows, yesterdayStr)
        .reduce((sum, row) => sum + parseFloat(row.get('Total Amount') || 0), 0);

      // Today's purchases
      const todayPurchases = this.filterRowsByDate(rows, todayStr).length;
      const projectedPurchases = Math.round((todayPurchases / hoursElapsed) * 24);

      const paceVsYesterday = yesterdayRevenue > 0
        ? Math.round(((projectedDaily - yesterdayRevenue) / yesterdayRevenue) * 100)
        : 0;

      const alertKey = `revenue_pace_${currentHourUTC}`;
      if (this.sentRealTimeAlerts.has(alertKey)) return null;

      // Only send every 3 hours (6, 9, 12, 15, 18, 21)
      if (currentHourUTC % 3 !== 0) return null;

      this.sentRealTimeAlerts.set(alertKey, true);
      setTimeout(() => this.sentRealTimeAlerts.delete(alertKey), 2 * 60 * 60 * 1000);

      const paceEmoji = paceVsYesterday >= 10 ? '🟢' : paceVsYesterday >= -10 ? '🟡' : '🔴';
      const trendEmoji = paceVsYesterday >= 0 ? '📈' : '📉';

      const alertText = `${paceEmoji} REVENUE PACE UPDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Today so far: $${todayRevenue.toFixed(2)} (${todayPurchases} purchases)
📊 Projected EOD: $${projectedDaily.toFixed(2)} (~${projectedPurchases} purchases)
${trendEmoji} vs Yesterday: ${paceVsYesterday >= 0 ? '+' : ''}${paceVsYesterday}% ($${yesterdayRevenue.toFixed(2)})
⏰ As of ${currentHourUTC}:00 UTC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      logInfo(`📤 Sending revenue pace update`);
      return alertText;

    } catch (error) {
      logError('Error checking revenue pace', error);
      return null;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CHECK ALL REAL-TIME ALERTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async checkAllRealTimeAlerts() {
    try {
      const alerts = [];

      const campaignAlert = await this.checkRealTimeCampaignAlert();
      if (campaignAlert) alerts.push(campaignAlert);

      const creativeAlert = await this.checkRealTimeCreativeAlert();
      if (creativeAlert) alerts.push(creativeAlert);

      const deathAlert = await this.checkCreativeDeathAlert();
      if (deathAlert) alerts.push(deathAlert);

      const paceAlert = await this.checkRevenuePace();
      if (paceAlert) alerts.push(paceAlert);

      if (alerts.length === 0) return null;

      return alerts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
    } catch (error) {
      logError('Error checking all real-time alerts', error);
      return null;
    }
  }

  // Run all smart alerts (scheduled checks)
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
