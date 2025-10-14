// Notification queue management endpoints
import express from 'express';
import { notificationQueue } from '../services/notificationQueue.js';

const router = express.Router();

// Notification queue management endpoints
router.get('/api/notification-queue/stats', (req, res) => {
  try {
    const stats = notificationQueue.getStats();
    res.json({
      success: true,
      message: 'Notification queue statistics',
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get queue stats',
      error: error.message
    });
  }
});

router.post('/api/notification-queue/clear', (req, res) => {
  try {
    notificationQueue.clear();
    res.json({
      success: true,
      message: 'Notification queue cleared'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clear queue',
      error: error.message
    });
  }
});

router.post('/api/notification-queue/pause', (req, res) => {
  try {
    notificationQueue.pause();
    res.json({
      success: true,
      message: 'Notification queue processing paused'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to pause queue',
      error: error.message
    });
  }
});

router.post('/api/notification-queue/resume', (req, res) => {
  try {
    notificationQueue.resume();
    res.json({
      success: true,
      message: 'Notification queue processing resumed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to resume queue',
      error: error.message
    });
  }
});

export default router;
