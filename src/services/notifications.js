import { ENV } from '../config/env.js';
import { logInfo, logError } from '../utils/logging.js';
import { formatSlackNotification, formatTelegramNotification } from '../utils/formatting.js';

// Telegram notification service
export async function sendTelegram(message) {
  if (!ENV.TELEGRAM_BOT_TOKEN || !ENV.TELEGRAM_CHAT_ID) {
    logInfo('Telegram not configured, skipping notification');
    return;
  }

  try {
    logInfo('Sending Telegram notification', { 
      chatId: ENV.TELEGRAM_CHAT_ID,
      messageLength: message.length 
    });
    
    const response = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const responseText = await response.text();
    logInfo('Telegram API response', { 
      status: response.status, 
      response: responseText 
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status} - ${responseText}`);
    }

    logInfo('Successfully sent Telegram notification');
  } catch (error) {
    logError('Error sending Telegram notification', error);
    throw error;
  }
}

// Slack notification service
export async function sendSlack(payment, customer, metadata = {}) {
  if (!ENV.SLACK_BOT_TOKEN || !ENV.SLACK_CHANNEL_ID) {
    logInfo('Slack not configured, skipping notification');
    return;
  }

  try {
    // Format message for Slack (same format as Telegram)
    const message = formatSlackNotification(payment, customer, metadata);

    // Commit in every send log — lets Railway logs prove which build sent a given message
    logInfo('Posting Slack purchase message', {
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown').slice(0, 7),
      mrkdwn: false,
      paymentId: payment?.id
    });

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENV.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: ENV.SLACK_CHANNEL_ID,
        text: message,
        // Campaign/adset names contain "_" pairs that Slack mrkdwn eats as italics
        mrkdwn: false
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
export async function sendNotifications(payment, customer, metadata = {}) {
  const promises = [];
  
  if (!ENV.NOTIFICATIONS_DISABLED) {
    if (ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      const telegramMessage = formatTelegramNotification(payment, customer, metadata);
      promises.push(sendTelegram(telegramMessage));
    }
    
    if (ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      promises.push(sendSlack(payment, customer, metadata));
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

// Send simple text notifications (for alerts, reports, etc.)
export async function sendTextNotifications(message) {
  const promises = [];
  
  if (!ENV.NOTIFICATIONS_DISABLED) {
    if (ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT_ID) {
      promises.push(sendTelegram(message));
    }
    
    if (ENV.SLACK_BOT_TOKEN && ENV.SLACK_CHANNEL_ID) {
      promises.push(sendSlackText(message));
    }
  }
  
  if (promises.length === 0) {
    logInfo('No notification channels configured');
    return;
  }
  
  try {
    await Promise.allSettled(promises);
    logInfo('All text notifications sent successfully');
  } catch (error) {
    logError('Error sending text notifications', error);
    throw error;
  }
}

// Send simple text to Slack
async function sendSlackText(message) {
  if (!ENV.SLACK_BOT_TOKEN || !ENV.SLACK_CHANNEL_ID) {
    logInfo('Slack not configured, skipping notification');
    return;
  }

  try {
    // Alerts go to the dedicated alerts channel when configured,
    // so they don't drown in the purchase feed
    const channel = ENV.SLACK_ALERTS_CHANNEL_ID || ENV.SLACK_CHANNEL_ID;

    logInfo('Posting Slack text message', {
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown').slice(0, 7),
      channel
    });

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENV.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text: message,
        // Alerts include ad/adset names with "_" pairs — keep Slack from italicizing them
        mrkdwn: false
      })
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }

    logInfo('Successfully sent Slack text notification');
  } catch (error) {
    logError('Error sending Slack text notification', error);
    throw error;
  }
}

// Send purchase notification (wrapper function)
export async function sendPurchaseNotification(payment, customer, sheetData, type) {
  try {
    // ✅ Валидация входных данных
    if (!payment || !payment.id) {
      throw new Error('Payment object is required with id');
    }
    if (!customer || !customer.id) {
      throw new Error('Customer object is required with id');
    }
    
    logInfo('Sending purchase notification', {
      paymentId: payment.id,
      customerId: customer.id,
      customerEmail: customer.email || 'N/A',
      accountSource: sheetData?.accountSource || payment._source || 'unknown',
      type,
      amount: payment.amount
    });

    // Format notification message
    const message = formatTelegramNotification(payment, customer, sheetData || {});
    
    if (!message || message.trim().length === 0) {
      throw new Error('Formatted message is empty');
    }
    
    // Send to both Telegram and Slack
    await Promise.all([
      sendTelegram(message).catch(err => {
        logError('Failed to send Telegram notification', err, {
          paymentId: payment.id,
          customerId: customer.id
        });
        throw err;
      }),
      sendSlack(payment, customer, sheetData || {}).catch(err => {
        logError('Failed to send Slack notification', err, {
          paymentId: payment.id,
          customerId: customer.id
        });
        throw err;
      })
    ]);

    logInfo('Successfully sent purchase notification', {
      paymentId: payment.id,
      customerId: customer.id,
      type
    });
  } catch (error) {
    logError('Error sending purchase notification', error, {
      paymentId: payment?.id,
      customerId: customer?.id,
      type,
      errorMessage: error.message,
      errorStack: error.stack
    });
    throw error;
  }
}
