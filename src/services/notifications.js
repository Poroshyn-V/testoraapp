import { ENV } from '../config/env.js';
import { logInfo, logError } from '../utils/logging.js';

// Telegram notification service
export async function sendTelegram(message) {
  if (!ENV.TELEGRAM_BOT_TOKEN || !ENV.TELEGRAM_CHAT_ID) {
    logInfo('Telegram not configured, skipping notification');
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status}`);
    }

    logInfo('Successfully sent Telegram notification');
  } catch (error) {
    logError('Error sending Telegram notification', error);
    throw error;
  }
}

// Slack notification service
export async function sendSlack(message) {
  if (!ENV.SLACK_BOT_TOKEN || !ENV.SLACK_CHANNEL_ID) {
    logInfo('Slack not configured, skipping notification');
    return;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENV.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: ENV.SLACK_CHANNEL_ID,
        text: message
      })
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }

    logInfo('Successfully sent Slack notification');
  } catch (error) {
    logError('Error sending Slack notification', error);
    throw error;
  }
}

// Send notifications to all configured channels
export async function sendNotifications(message) {
  const promises = [];
  
  if (!ENV.NOTIFICATIONS_DISABLED) {
    if (ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      promises.push(sendTelegram(message));
    }
    
    if (ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      promises.push(sendSlack(message));
    }
  }
  
  if (promises.length === 0) {
    logInfo('No notification channels configured');
    return;
  }
  
  try {
    await Promise.allSettled(promises);
    logInfo('All notifications sent successfully');
  } catch (error) {
    logError('Error sending notifications', error);
    throw error;
  }
}
