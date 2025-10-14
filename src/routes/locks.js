// Distributed lock management endpoints
import express from 'express';
import { distributedLock } from '../services/distributedLock.js';

const router = express.Router();

// Distributed lock management endpoints
router.get('/api/distributed-locks/stats', (req, res) => {
  try {
    const stats = distributedLock.getStats();
    res.json({
      success: true,
      message: 'Distributed lock statistics',
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get lock stats',
      error: error.message
    });
  }
});

router.post('/api/distributed-locks/cleanup', (req, res) => {
  try {
    const cleaned = distributedLock.cleanup();
    res.json({
      success: true,
      message: `Cleaned ${cleaned} stale locks`,
      cleaned
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup locks',
      error: error.message
    });
  }
});

// Get detailed information about active locks
router.get('/api/distributed-locks/active', (req, res) => {
  try {
    const activeLocks = distributedLock.getActiveLocks();
    res.json({
      success: true,
      message: `Found ${activeLocks.length} active locks`,
      activeLocks,
      count: activeLocks.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get active locks',
      error: error.message
    });
  }
});

// Force release a specific lock
router.post('/api/distributed-locks/release/:lockKey', (req, res) => {
  try {
    const { lockKey } = req.params;
    const released = distributedLock.forceRelease(lockKey);
    
    if (released) {
      res.json({
        success: true,
        message: `Lock ${lockKey} released successfully`,
        lockKey,
        released: true
      });
    } else {
      res.json({
        success: false,
        message: `Lock ${lockKey} not found or already released`,
        lockKey,
        released: false
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to release lock',
      error: error.message
    });
  }
});

export default router;
