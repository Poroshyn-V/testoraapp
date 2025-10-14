// Alert management endpoints
import express from 'express';
import { logger } from '../utils/logging.js';
import { analytics } from '../services/analytics.js';
import { sendTextNotifications } from '../services/notifications.js';
import { alertCooldown } from '../utils/alertCooldown.js';
import { alertConfig } from '../config/alertConfig.js';
import { performanceMonitor } from '../services/performanceMonitor.js';
import { smartAlerts } from '../services/smartAlerts.js';

const router = express.Router();

// Alert history storage
let alertHistory = [];

// Function to save alert history
function saveAlertHistory(type, message, success = true, error = null) {
  alertHistory.push({
    timestamp: new Date().toISOString(),
    type,
    message,
    success,
    error: error?.message || null
  });
  
  // Keep only last 1000 entries
  if (alertHistory.length > 1000) {
    alertHistory = alertHistory.slice(-1000);
  }
}

// Weekly report endpoint
router.get('/api/weekly-report', async (req, res) => {
  try {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    
    // Защита от спама: не отправляем Weekly Report чаще чем раз в день
    if (global.sentAlerts?.weeklyReport?.has(today)) {
      logger.info('📊 Weekly report already sent today, skipping');
      return res.json({
        success: true,
        message: 'Weekly report already sent today'
      });
    }
    
    const report = await analytics.generateWeeklyReport();
    
    if (report) {
      await sendTextNotifications(report);
      
      // Отмечаем, что Weekly Report был отправлен
      if (!global.sentAlerts.weeklyReport) {
        global.sentAlerts.weeklyReport = new Set();
      }
      global.sentAlerts.weeklyReport.add(today);
      
      saveAlertHistory('weekly_report', 'Weekly report sent successfully');
      
      res.json({
        success: true,
        message: 'Weekly report sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for weekly report'
      });
    }
  } catch (error) {
    logger.error('Error generating weekly report', error);
    saveAlertHistory('weekly_report', 'Weekly report failed', false, error);
    res.status(500).json({
      success: false,
      message: 'Weekly report failed',
      error: error.message
    });
  }
});

// GEO alert endpoint
router.get('/api/geo-alert', async (req, res) => {
  try {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    const currentHour = utcPlus1.getUTCHours();
    
    // Защита от спама: не отправляем GEO алерт чаще чем раз в 30 минут
    const geoAlertKey = `geo_${today}_${currentHour}_${Math.floor(utcPlus1.getUTCMinutes() / 30)}`;
    
    if (global.sentAlerts?.geoAlert?.has(geoAlertKey)) {
      logger.info('🌍 GEO alert already sent for this 30-minute period, skipping');
      return res.json({
        success: true,
        message: 'GEO alert already sent for this period'
      });
    }
    
    const alert = await analytics.generateGeoAlert();
    
    if (alert) {
      await sendTextNotifications(alert);
      
      // Отмечаем, что GEO алерт был отправлен
      if (!global.sentAlerts.geoAlert) {
        global.sentAlerts.geoAlert = new Set();
      }
      global.sentAlerts.geoAlert.add(geoAlertKey);
      
      saveAlertHistory('geo_alert', 'GEO alert sent successfully');
      
      res.json({
        success: true,
        message: 'GEO alert sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for GEO alert'
      });
    }
  } catch (error) {
    logger.error('Error generating GEO alert', error);
    saveAlertHistory('geo_alert', 'GEO alert failed', false, error);
    res.status(500).json({
      success: false,
      message: 'GEO alert failed',
      error: error.message
    });
  }
});

// Daily stats endpoint
router.get('/api/daily-stats', async (req, res) => {
  try {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    
    // Защита от спама: не отправляем Daily Stats чаще чем раз в день
    if (global.sentAlerts?.dailyStats?.has(today)) {
      logger.info('📈 Daily stats already sent today, skipping');
      return res.json({
        success: true,
        message: 'Daily stats already sent today'
      });
    }
    
    const stats = await analytics.generateDailyStats();
    
    if (stats) {
      await sendTextNotifications(stats);
      
      // Отмечаем, что Daily Stats был отправлен
      if (!global.sentAlerts.dailyStats) {
        global.sentAlerts.dailyStats = new Set();
      }
      global.sentAlerts.dailyStats.add(today);
      
      saveAlertHistory('daily_stats', 'Daily stats sent successfully');
      
      res.json({
        success: true,
        message: 'Daily stats sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for daily stats'
      });
    }
  } catch (error) {
    logger.error('Error generating daily stats', error);
    saveAlertHistory('daily_stats', 'Daily stats failed', false, error);
    res.status(500).json({
      success: false,
      message: 'Daily stats failed',
      error: error.message
    });
  }
});

// Anomaly check endpoint
router.get('/api/anomaly-check', async (req, res) => {
  try {
    const anomaly = await analytics.checkAnomalies();
    
    if (anomaly) {
      await sendTextNotifications(anomaly);
      
      saveAlertHistory('anomaly_check', 'Anomaly alert sent successfully');
      
      res.json({
        success: true,
        message: 'Anomaly detected and alert sent'
      });
    } else {
      res.json({
        success: true,
        message: 'No anomalies detected'
      });
    }
  } catch (error) {
    logger.error('Error checking anomalies', error);
    saveAlertHistory('anomaly_check', 'Anomaly check failed', false, error);
    res.status(500).json({
      success: false,
      message: 'Anomaly check failed',
      error: error.message
    });
  }
});

// Creative alert endpoint
router.get('/api/creative-alert', async (req, res) => {
  try {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    const currentHour = utcPlus1.getUTCHours();
    
    // Защита от спама: не отправляем Creative алерт чаще чем раз в час
    const creativeAlertKey = `creative_${today}_${currentHour}`;
    
    if (global.sentAlerts?.creativeAlert?.has(creativeAlertKey)) {
      logger.info('🎨 Creative alert already sent for this hour, skipping');
      return res.json({
        success: true,
        message: 'Creative alert already sent for this hour'
      });
    }
    
    const alert = await analytics.generateCreativeAlert();
    
    if (alert) {
      await sendTextNotifications(alert);
      
      // Отмечаем, что Creative алерт был отправлен
      if (!global.sentAlerts.creativeAlert) {
        global.sentAlerts.creativeAlert = new Set();
      }
      global.sentAlerts.creativeAlert.add(creativeAlertKey);
      
      saveAlertHistory('creative_alert', 'Creative alert sent successfully');
      
      res.json({
        success: true,
        message: 'Creative alert sent successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No data for creative alert'
      });
    }
  } catch (error) {
    logger.error('Error generating creative alert', error);
    saveAlertHistory('creative_alert', 'Creative alert failed', false, error);
    res.status(500).json({
      success: false,
      message: 'Creative alert failed',
      error: error.message
    });
  }
});

// Alert history endpoint
router.get('/api/alerts/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const type = req.query.type; // filter by type
  
  let filtered = alertHistory;
  
  if (type) {
    filtered = alertHistory.filter(entry => entry.type === type);
  }
  
  res.json({
    success: true,
    message: 'Alert history',
    total: filtered.length,
    history: filtered.slice(0, limit)
  });
});

// Alert dashboard endpoint
router.get('/api/alerts/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const utcPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const today = utcPlus1.toISOString().split('T')[0];
    const currentHour = utcPlus1.getUTCHours();
    
    // Какие алерты уже отправлены сегодня
    const alertStatus = {
      today: today,
      currentTime: utcPlus1.toISOString(),
      sentToday: {
        dailyStats: global.sentAlerts?.dailyStats?.has(today) || false,
        creativeAlertMorning: global.sentAlerts?.creativeAlert?.has(`${today}_10`) || false,
        creativeAlertEvening: global.sentAlerts?.creativeAlert?.has(`${today}_22`) || false,
        geoAlerts: Array.from(global.sentAlerts?.dailyStats || []).filter(d => d === today).length
      },
      upcoming: {
        nextDailyStats: currentHour < 7 ? 'Today at 7:00 UTC+1' : 'Tomorrow at 7:00 UTC+1',
        nextCreativeAlert: currentHour < 10 ? 'Today at 10:00 UTC+1' : 
                          currentHour < 22 ? 'Today at 22:00 UTC+1' : 
                          'Tomorrow at 10:00 UTC+1',
        nextWeeklyReport: 'Next Monday at 9:00 UTC+1'
      },
      memoryStatus: {
        dailyStatsCache: global.sentAlerts?.dailyStats?.size || 0,
        creativeAlertCache: global.sentAlerts?.creativeAlert?.size || 0,
        weeklyReportCache: global.sentAlerts?.weeklyReport?.size || 0
      }
    };
    
    res.json({
      success: true,
      message: 'Alert dashboard status',
      ...alertStatus
    });
    
  } catch (error) {
    logger.error('Error getting alert dashboard', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get alert dashboard',
      error: error.message
    });
  }
});

// Smart alerts endpoint
router.get('/api/smart-alerts', async (req, res) => {
  try {
    const results = await smartAlerts.runAllChecks();
    
    res.json({
      success: true,
      message: 'Smart alerts check completed',
      results,
      alertsSent: Object.values(results).filter(Boolean).length
    });
    
  } catch (error) {
    logger.error('Error running smart alerts', error);
    res.status(500).json({
      success: false,
      message: 'Smart alerts failed',
      error: error.message
    });
  }
});

// Alert cooldown stats endpoint
router.get('/api/alerts/cooldown-stats', (req, res) => {
  try {
    const stats = alertCooldown.getStats();
    
    res.json({
      success: true,
      message: 'Alert cooldown statistics',
      stats,
      config: {
        cooldownMinutes: alertConfig.cooldownMinutes
      }
    });
  } catch (error) {
    logger.error('Error getting cooldown stats', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Performance monitor stats endpoint
router.get('/api/performance-stats', (req, res) => {
  try {
    const stats = performanceMonitor.getStats();
    
    res.json({
      success: true,
      message: 'Performance monitoring statistics',
      ...stats
    });
  } catch (error) {
    logger.error('Error getting performance stats', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
export { saveAlertHistory };