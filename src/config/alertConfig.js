export const alertConfig = {
  // Thresholds
  revenueDrop: parseInt(process.env.ALERT_REVENUE_DROP_PERCENT) || 30,
  conversionDrop: parseInt(process.env.ALERT_CONVERSION_DROP_PERCENT) || 20,
  paymentFailureRate: parseInt(process.env.ALERT_PAYMENT_FAILURE_RATE) || 10,
  vipPurchaseThreshold: parseInt(process.env.VIP_PURCHASE_THRESHOLD) || 100,
  
  // Schedule
  dailyStatsHour: parseInt(process.env.DAILY_STATS_HOUR) || 7, // UTC+1
  creativeAlertHours: process.env.CREATIVE_ALERT_HOURS?.split(',').map(Number) || [10, 22],
  weeklyReportDay: parseInt(process.env.WEEKLY_REPORT_DAY) || 1, // 1 = Monday
  weeklyReportHour: parseInt(process.env.WEEKLY_REPORT_HOUR) || 9,
  
  // Intervals (in minutes)
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5,
  geoAlertInterval: parseInt(process.env.GEO_ALERT_INTERVAL_HOURS) || 1,
  alertCheckInterval: parseInt(process.env.ALERT_CHECK_MINUTES) || 2,
  
  // Alert cooldowns (prevent spam)
  cooldownMinutes: {
    revenue: parseInt(process.env.REVENUE_ALERT_COOLDOWN) || 60, // 1 hour
    conversion: parseInt(process.env.CONVERSION_ALERT_COOLDOWN) || 60,
    vip: parseInt(process.env.VIP_ALERT_COOLDOWN) || 5 // 5 minutes
  }
};

export default alertConfig;
