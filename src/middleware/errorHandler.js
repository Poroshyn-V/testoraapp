import { logError, logWarn } from '../utils/logging.js';

// Global error handler
export function errorHandler(error, req, res, next) {
  logError('Unhandled error', error, {
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] || 'unknown'
  });
}

// 404 handler
export function notFoundHandler(req, res) {
  logWarn('404 Not Found', {
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
    timestamp: new Date().toISOString()
  });
}
