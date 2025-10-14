// Refactored Stripe Ops API - Modular Architecture
import express from 'express';
import cors from 'cors';
import { ENV } from './src/lib/env.js';
import { logger } from './src/lib/logger.js';

// Import route modules
import healthRoutes from './src/routes/health.js';
import emergencyRoutes from './src/routes/emergency.js';
import notificationRoutes from './src/routes/notifications.js';
import duplicateRoutes from './src/routes/duplicates.js';
import campaignRoutes from './src/routes/campaigns.js';
import lockRoutes from './src/routes/locks.js';
import alertRoutes from './src/routes/alerts.js';
import syncRoutes from './src/routes/sync.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Root endpoint
app.get('/', (_req, res) => res.json({ 
  service: 'Stripe Ops API',
  version: '2.0.0',
  status: 'running',
  timestamp: new Date().toISOString(),
  endpoints: [
    '/health',
    '/api/status',
    '/api/emergency/stop',
    '/api/emergency/resume',
    '/api/emergency/status',
    '/api/notification-queue/stats',
    '/api/notification-queue/clear',
    '/api/notification-queue/pause',
    '/api/notification-queue/resume',
    '/api/check-duplicates',
    '/api/fix-duplicates',
    '/api/duplicate-checker/stats',
    '/api/duplicate-checker/refresh',
    '/api/duplicate-checker/customer/:customerId',
    '/api/duplicate-checker/payment-intent/:paymentIntentId',
    '/api/duplicates/cache-stats',
    '/api/duplicates/refresh-cache',
    '/api/duplicates/find',
    '/api/sync-locks',
    '/api/campaigns/analyze',
    '/api/campaigns/:campaignName/analyze',
    '/api/campaigns/report',
    '/api/campaigns/list',
    '/api/distributed-locks/stats',
    '/api/distributed-locks/cleanup',
    '/api/distributed-locks/active',
    '/api/distributed-locks/release/:lockKey',
    '/api/creative-alert',
    '/api/alerts/history',
    '/api/alerts/dashboard',
    '/api/smart-alerts',
    '/api/alerts/cooldown-stats',
    '/api/performance-stats',
    '/api/load-existing',
    '/api/sync-payments'
  ]
}));

// Use route modules
app.use('/', healthRoutes);
app.use('/', emergencyRoutes);
app.use('/', notificationRoutes);
app.use('/', duplicateRoutes);
app.use('/', campaignRoutes);
app.use('/', lockRoutes);
app.use('/', alertRoutes);
app.use('/', syncRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Start server
const PORT = ENV.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 Stripe Ops API v2.0.0 started on port ${PORT}`, {
    port: PORT,
    environment: ENV.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

export default app;
