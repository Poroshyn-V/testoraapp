// Environment configuration
export const ENV = {
  PORT: process.env.PORT || 3000,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: process.env.GOOGLE_SERVICE_PRIVATE_KEY,
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID,
  BOT_DISABLED: process.env.BOT_DISABLED === 'true',
  NOTIFICATIONS_DISABLED: process.env.NOTIFICATIONS_DISABLED === 'true',
  AUTO_SYNC_DISABLED: process.env.AUTO_SYNC_DISABLED === 'true'
};

// Rate limiting configuration
export const RATE_LIMIT_CONFIG = {
  WINDOW: 15 * 60 * 1000, // 15 минут
  MAX_REQUESTS: 100 // максимум 100 запросов за 15 минут
};

// Cache configuration
export const CACHE_CONFIG = {
  SHEETS_TTL: 5 * 60 * 1000 // 5 минут кэш для Google Sheets
};

// Stripe configuration
export const STRIPE_CONFIG = {
  API_VERSION: '2024-06-20'
};
