// Emergency stop endpoints
import express from 'express';
import { logger } from '../utils/logging.js';

const router = express.Router();

// Emergency stop flag
let emergencyStop = false;

// Emergency stop endpoint
router.post('/api/emergency/stop', (req, res) => {
  try {
    emergencyStop = true;
    
    // Stop all intervals
    if (global.syncInterval) {
      clearInterval(global.syncInterval);
      global.syncInterval = null;
    }
    if (global.geoAlertInterval) {
      clearInterval(global.geoAlertInterval);
      global.geoAlertInterval = null;
    }
    if (global.dailyStatsInterval) {
      clearInterval(global.dailyStatsInterval);
      global.dailyStatsInterval = null;
    }
    if (global.creativeAlertInterval) {
      clearInterval(global.creativeAlertInterval);
      global.creativeAlertInterval = null;
    }
    if (global.weeklyReportInterval) {
      clearInterval(global.weeklyReportInterval);
      global.weeklyReportInterval = null;
    }
    if (global.campaignReportInterval) {
      clearInterval(global.campaignReportInterval);
      global.campaignReportInterval = null;
    }
    if (global.duplicateCleanupInterval) {
      clearInterval(global.duplicateCleanupInterval);
      global.duplicateCleanupInterval = null;
    }
    if (global.alertCleanupInterval) {
      clearInterval(global.alertCleanupInterval);
      global.alertCleanupInterval = null;
    }
    
    logger.warn('🚨 EMERGENCY STOP ACTIVATED - All operations halted');
    
    res.json({
      success: true,
      message: 'Emergency stop activated - all operations halted',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error activating emergency stop', error);
    res.status(500).json({
      success: false,
      message: 'Failed to activate emergency stop',
      error: error.message
    });
  }
});

// Resume endpoint
router.post('/api/emergency/resume', (req, res) => {
  try {
    emergencyStop = false;
    
    // Restart intervals (they will be set up by the main app)
    logger.info('🟢 EMERGENCY STOP DEACTIVATED - Operations can resume');
    
    res.json({
      success: true,
      message: 'Emergency stop deactivated - operations can resume',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error deactivating emergency stop', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate emergency stop',
      error: error.message
    });
  }
});

// Emergency status endpoint
router.get('/api/emergency/status', (req, res) => {
  res.json({
    success: true,
    emergencyStop: emergencyStop,
    timestamp: new Date().toISOString(),
    intervals: {
      sync: !!global.syncInterval,
      geoAlert: !!global.geoAlertInterval,
      dailyStats: !!global.dailyStatsInterval,
      creativeAlert: !!global.creativeAlertInterval,
      weeklyReport: !!global.weeklyReportInterval,
      campaignReport: !!global.campaignReportInterval,
      duplicateCleanup: !!global.duplicateCleanupInterval,
      alertCleanup: !!global.alertCleanupInterval
    }
  });
});

export default router;
export { emergencyStop };
