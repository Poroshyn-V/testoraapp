import { logWarn } from '../utils/logging.js';
import { RATE_LIMIT_CONFIG } from '../config/env.js';

// Rate limiting storage
const rateLimitStore = new Map();

// Rate limiting middleware
export function rateLimit(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  // Очищаем старые записи
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now - data.firstRequest > RATE_LIMIT_CONFIG.WINDOW) {
      rateLimitStore.delete(ip);
    }
  }
  
  // Проверяем текущий IP
  if (!rateLimitStore.has(clientIP)) {
    rateLimitStore.set(clientIP, {
      firstRequest: now,
      requestCount: 1
    });
    return next();
  }
  
  const clientData = rateLimitStore.get(clientIP);
  
  if (now - clientData.firstRequest > RATE_LIMIT_CONFIG.WINDOW) {
    // Окно истекло, сбрасываем счетчик
    rateLimitStore.set(clientIP, {
      firstRequest: now,
      requestCount: 1
    });
    return next();
  }
  
  if (clientData.requestCount >= RATE_LIMIT_CONFIG.MAX_REQUESTS) {
    logWarn('Rate limit exceeded', { ip: clientIP, requestCount: clientData.requestCount });
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((RATE_LIMIT_CONFIG.WINDOW - (now - clientData.firstRequest)) / 1000)
    });
  }
  
  clientData.requestCount++;
  next();
}

// Get rate limit stats
export function getRateLimitStats() {
  return {
    activeConnections: rateLimitStore.size,
    window: RATE_LIMIT_CONFIG.WINDOW,
    maxRequests: RATE_LIMIT_CONFIG.MAX_REQUESTS
  };
}
