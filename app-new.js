// Refactored Stripe Ops API - Modular Architecture
import express from 'express';
import { ENV } from './src/config/env.js';
import { logger } from './src/utils/logging.js';
import { rateLimit, getRateLimitStats } from './src/middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import { getCacheStats } from './src/utils/cache.js';

const app = express();

// Simple storage for existing purchases
const existingPurchases = new Set();
const processedPurchaseIds = new Set();

// Middleware
app.use(express.json());
app.use('/api', rateLimit);

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  message: 'Stripe Ops API is running!',
  status: 'ok',
  timestamp: new Date().toISOString(),
  endpoints: ['/api/test', '/api/sync-payments', '/api/geo-alert', '/api/creative-alert', '/api/daily-stats', '/api/weekly-report', '/api/anomaly-check', '/api/memory-status', '/api/check-duplicates', '/health', '/webhook/stripe']
}));

// Health check
app.get('/health', async (_req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime,
      memory: memUsage,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      services: {
        stripe: 'connected',
        googleSheets: ENV.GOOGLE_SERVICE_EMAIL ? 'configured' : 'not_configured',
        telegram: ENV.TELEGRAM_BOT_TOKEN ? 'configured' : 'not_configured',
        slack: ENV.SLACK_BOT_TOKEN ? 'configured' : 'not_configured'
      },
      rateLimit: getRateLimitStats(),
      memory: {
        existingPurchases: existingPurchases.size,
        processedPurchases: processedPurchaseIds.size
      }
    };
    
    res.status(200).json(healthStatus);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Memory status endpoint
app.get('/api/memory-status', (req, res) => {
  res.json({
    success: true,
    message: `Memory contains ${existingPurchases.size} purchases`,
    count: existingPurchases.size,
    purchases: Array.from(existingPurchases).slice(0, 20),
    auto_sync_disabled: ENV.AUTO_SYNC_DISABLED,
    notifications_disabled: ENV.NOTIFICATIONS_DISABLED
  });
});

// Metrics endpoint
app.get('/api/metrics', (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(uptime),
      human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    },
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
    },
    cache: {
      ...getCacheStats(),
      rateLimitConnections: getRateLimitStats().activeConnections,
      existingPurchases: existingPurchases.size,
      processedPurchases: processedPurchaseIds.size
    },
    performance: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    }
  });
});

// Placeholder endpoints (will be implemented with services)
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/sync-payments', (req, res) => {
  res.json({
    success: true,
    message: 'Sync endpoint - will be implemented with services',
    timestamp: new Date().toISOString()
  });
});

// Error handlers
app.use(errorHandler);
app.use(notFoundHandler);

// Start server
app.listen(ENV.PORT, () => {
  logger.info(`Server listening on port ${ENV.PORT}`);
  console.log('🚀 Refactored Stripe Ops API is running!');
  console.log(`📊 Modular architecture with ${Object.keys(ENV).length} environment variables`);
  console.log(`🛡️ Rate limiting: ${getRateLimitStats().maxRequests} requests per ${getRateLimitStats().window / 1000 / 60} minutes`);
  console.log(`💾 Cache system: Google Sheets caching enabled`);
  console.log(`📝 Structured logging: JSON format with timestamps`);
});

export default app;
