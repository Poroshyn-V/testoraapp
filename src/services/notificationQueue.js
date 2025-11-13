import { logInfo, logWarn, logError } from '../utils/logging.js';
import { sendTextNotifications, sendSlack } from './notifications.js';
import { formatSlackNotification } from '../utils/formatting.js';
import { metrics } from './metrics.js';

class NotificationQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxRetries = 3;
    this.retryDelay = 2000; // Base delay in milliseconds
    this.sentNotifications = new Set(); // Track sent notifications to prevent duplicates
    this.maxSentHistory = 1000; // Maximum number of sent notifications to keep in memory
  }
  
  async add(notification) {
    // Create unique key for duplicate detection
    const duplicateKey = this.createDuplicateKey(notification);
    
    // Check if we already have this notification in queue or sent recently
    if (this.sentNotifications.has(duplicateKey)) {
      logWarn('🚫 Duplicate notification prevented (already sent)', {
        type: notification.type,
        duplicateKey,
        paymentId: notification.metadata?.paymentId,
        customerId: notification.metadata?.customerId,
        queueSize: this.queue.length
      });
      metrics.increment('notification_duplicate_prevented', 1, { type: notification.type, reason: 'already_sent' });
      return;
    }
    
    // ✅ Also check if this notification is already in the queue (prevent race conditions)
    const alreadyInQueue = this.queue.some(n => n.duplicateKey === duplicateKey);
    if (alreadyInQueue) {
      logWarn('🚫 Duplicate notification prevented (already in queue)', {
        type: notification.type,
        duplicateKey,
        paymentId: notification.metadata?.paymentId,
        customerId: notification.metadata?.customerId,
        queueSize: this.queue.length
      });
      metrics.increment('notification_duplicate_prevented', 1, { type: notification.type, reason: 'already_in_queue' });
      return;
    }
    
    const queuedNotification = {
      ...notification,
      attempts: 0,
      addedAt: Date.now(),
      id: this.generateId(),
      duplicateKey
    };
    
    this.queue.push(queuedNotification);
    
    logInfo('📬 Notification queued', {
      queueSize: this.queue.length,
      type: notification.type,
      id: queuedNotification.id
    });
    
    metrics.increment('notification_queued', 1, { type: notification.type });
    
    // Start processing if not already running
    this.process();
  }
  
  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const timerId = metrics.startTimer('notification_queue_processing');
    
    try {
      logInfo('🔄 Starting notification queue processing', {
        queueSize: this.queue.length
      });
      
      while (this.queue.length > 0) {
        const notification = this.queue[0];
        
        try {
          await this.send(notification);
          this.queue.shift(); // Remove from queue on success
          
          // Mark as sent to prevent duplicates
          this.sentNotifications.add(notification.duplicateKey);
          
          // Clean up old entries if we have too many
          if (this.sentNotifications.size > this.maxSentHistory) {
            const entriesToRemove = this.sentNotifications.size - this.maxSentHistory;
            const entriesArray = Array.from(this.sentNotifications);
            for (let i = 0; i < entriesToRemove; i++) {
              this.sentNotifications.delete(entriesArray[i]);
            }
            logInfo('🧹 Cleaned up old sent notification history', { 
              removed: entriesToRemove,
              remaining: this.sentNotifications.size 
            });
          }
          
          logInfo('✅ Notification sent successfully', {
            type: notification.type,
            id: notification.id,
            remaining: this.queue.length,
            attempts: notification.attempts + 1
          });
          
          metrics.increment('notification_sent', 1, { 
            type: notification.type,
            attempts: notification.attempts + 1
          });
          
        } catch (error) {
          notification.attempts++;
          
          if (notification.attempts >= this.maxRetries) {
            logError('❌ Notification failed after max retries', {
              type: notification.type,
              id: notification.id,
              attempts: notification.attempts,
              error: error.message
            });
            
            this.queue.shift(); // Remove failed notification
            metrics.increment('notification_failed', 1, { 
              type: notification.type,
              attempts: notification.attempts
            });
            
            // Save to alert history if available
            if (typeof saveAlertHistory === 'function') {
              saveAlertHistory(notification.type, 'failed', error.message, notification);
            }
            
          } else {
            const delay = this.retryDelay * Math.pow(2, notification.attempts - 1); // Exponential backoff
            logWarn(`⚠️ Notification failed, retrying in ${delay}ms (${notification.attempts}/${this.maxRetries})`, {
              type: notification.type,
              id: notification.id,
              error: error.message
            });
            
            metrics.increment('notification_retry', 1, { 
              type: notification.type,
              attempt: notification.attempts
            });
            
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
    } finally {
      this.processing = false;
      metrics.endTimer(timerId);
      
      logInfo('🏁 Notification queue processing completed', {
        queueSize: this.queue.length
      });
    }
  }
  
  async send(notification) {
    const sendTimerId = metrics.startTimer('notification_send', { type: notification.type });
    
    try {
      // For purchase notifications, send to both Telegram and Slack with proper formatting
      if (notification.type && (notification.type.includes('purchase') || notification.type.includes('upsell'))) {
        // Extract payment and customer data from metadata if available
        const payment = notification.payment || { 
          id: notification.metadata?.paymentId,
          amount: notification.metadata?.amount ? parseFloat(notification.metadata.amount) * 100 : 0,
          currency: 'USD',
          metadata: {}
        };
        const customer = notification.customer || { 
          id: notification.metadata?.customerId,
          email: 'N/A',
          metadata: {}
        };
        const sheetData = notification.sheetData || notification.metadata || {};
        
        // Send to Telegram (using the formatted message)
        await sendTextNotifications(notification.message);
        
        // Send to Slack (using proper formatting)
        try {
          await sendSlack(payment, customer, sheetData);
        } catch (slackError) {
          logWarn('Failed to send Slack notification for purchase', {
            error: slackError.message,
            paymentId: payment.id
          });
          // Don't fail the whole notification if Slack fails
        }
      } else {
        // For other notifications (alerts, reports), use simple text notifications
        if (notification.channel === 'telegram' || !notification.channel) {
          // Default to telegram if no channel specified
          await sendTextNotifications(notification.message);
        } else if (notification.channel === 'slack') {
          await sendTextNotifications(notification.message);
        } else {
          throw new Error(`Unknown notification channel: ${notification.channel}`);
        }
      }
      
      metrics.endTimer(sendTimerId);
      
    } catch (error) {
      metrics.endTimer(sendTimerId);
      metrics.increment('notification_send_error', 1, { 
        type: notification.type,
        channel: notification.channel,
        error: error.message
      });
      throw error;
    }
  }
  
  generateId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  createDuplicateKey(notification) {
    // Create a unique key based on payment/customer ID to prevent duplicates across all notification types
    // This ensures that the same purchase doesn't get multiple notifications regardless of type
    const paymentId = notification.metadata?.paymentId;
    const customerId = notification.metadata?.customerId;
    
    if (paymentId) {
      return `payment_${paymentId}`;
    } else if (customerId) {
      return `customer_${customerId}`;
    } else {
      // For non-purchase notifications (alerts, reports), use type + timestamp
      return `${notification.type}_${Date.now()}`;
    }
  }
  
  getStats() {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      maxRetries: this.maxRetries,
      sentNotificationsCount: this.sentNotifications.size,
      oldestInQueue: this.queue.length > 0 
        ? new Date(this.queue[0].addedAt).toISOString() 
        : null,
      queue: this.queue.map(n => ({
        id: n.id,
        type: n.type,
        channel: n.channel,
        attempts: n.attempts,
        addedAt: new Date(n.addedAt).toISOString(),
        age: Date.now() - n.addedAt
      }))
    };
  }
  
  clear() {
    const clearedCount = this.queue.length;
    this.queue = [];
    this.sentNotifications.clear(); // Also clear sent notifications history
    logInfo('🧹 Notification queue cleared', { clearedCount });
    metrics.increment('notification_queue_cleared', 1, { count: clearedCount });
  }
  
  // Pause processing
  pause() {
    this.processing = false;
    logInfo('⏸️ Notification queue processing paused');
  }
  
  // Resume processing
  resume() {
    if (!this.processing && this.queue.length > 0) {
      logInfo('▶️ Notification queue processing resumed');
      this.process();
    }
  }
}

export const notificationQueue = new NotificationQueue();
export default notificationQueue;
