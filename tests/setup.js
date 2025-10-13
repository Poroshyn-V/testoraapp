// Test setup file
import { vi } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.GOOGLE_SERVICE_EMAIL = 'test@example.com';
process.env.GOOGLE_PRIVATE_KEY = 'mock_private_key';
process.env.GOOGLE_SHEET_ID = 'mock_sheet_id';
process.env.TELEGRAM_BOT_TOKEN = 'mock_telegram_token';
process.env.TELEGRAM_CHAT_ID = 'mock_chat_id';
process.env.SLACK_BOT_TOKEN = 'mock_slack_token';
process.env.SLACK_CHANNEL = 'mock_channel';
process.env.PORT = '3000';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

// Mock fetch for external API calls
global.fetch = vi.fn();

// Mock setTimeout and setInterval
global.setTimeout = vi.fn((fn, delay) => {
  if (typeof fn === 'function') {
    fn();
  }
  return 1;
});

global.setInterval = vi.fn((fn, delay) => {
  if (typeof fn === 'function') {
    fn();
  }
  return 1;
});

global.clearTimeout = vi.fn();
global.clearInterval = vi.fn();
