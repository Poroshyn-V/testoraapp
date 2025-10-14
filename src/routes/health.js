// Health check endpoints
import express from 'express';
import { logger } from '../utils/logging.js';
import { googleSheets } from '../services/googleSheets.js';
import { ENV } from '../config/env.js';
import { stripe } from '../services/stripe.js';

const router = express.Router();

// Helper functions for health checks
async function checkStripeConnection() {
  try {
    const startTime = Date.now();
    await stripe.customers.list({ limit: 1 });
    return {
      status: 'healthy',
      responseTime: `${Date.now() - startTime}ms`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

async function checkGoogleSheetsConnection() {
  try {
    const startTime = Date.now();
    await googleSheets.getAllRows(); // cached
    return {
      status: 'healthy',
      responseTime: `${Date.now() - startTime}ms`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

async function checkTelegramConnection() {
  try {
    const startTime = Date.now();
    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/getMe`);
    const isHealthy = response.ok;
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      responseTime: `${Date.now() - startTime}ms`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

// Health check
router.get('/health', async (_req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    // Test external services
    const serviceChecks = {
      stripe: await checkStripeConnection(),
      googleSheets: await checkGoogleSheetsConnection(),
      telegram: await checkTelegramConnection()
    };
    
    const allHealthy = Object.values(serviceChecks).every(check => check.status === 'healthy');
    
    res.json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime)}s`,
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
      },
      services: serviceChecks,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        port: ENV.PORT
      }
    });
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Endpoint для внешних систем мониторинга (UptimeRobot, Pingdom)
router.get('/api/status', async (_req, res) => {
  try {
    // Быстрая проверка основных сервисов
    const stripeCheck = await checkStripeConnection();
    const sheetsCheck = await checkGoogleSheetsConnection();
    
    const isHealthy = stripeCheck.status === 'healthy' && sheetsCheck.status === 'healthy';
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      services: {
        stripe: stripeCheck.status,
        sheets: sheetsCheck.status
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message
    });
  }
});

export default router;
