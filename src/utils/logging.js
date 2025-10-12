import pino from 'pino';

// Configure logger
const logger = pino({ 
  level: 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

// Structured logging functions
export function logInfo(message, data = {}) {
  logger.info({
    message,
    ...data,
    service: 'stripe-ops'
  });
}

export function logError(message, error = null, data = {}) {
  logger.error({
    message,
    error: error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : null,
    ...data,
    service: 'stripe-ops'
  });
}

export function logWarn(message, data = {}) {
  logger.warn({
    message,
    ...data,
    service: 'stripe-ops'
  });
}

export { logger };
