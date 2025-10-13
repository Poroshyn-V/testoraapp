import { logInfo, logWarn, logError } from '../utils/logging.js';
import { sendTextNotifications } from './notifications.js';
import { metrics } from './metrics.js';

class NotificationQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxRetries = 3;
    this.retryDelay = 2000; // Base delay in milliseconds
  }
  
  async add(notification) {
    const queuedNotification = {
      ...notification,
      attempts: 0,
      addedAt: Date.now(),
      id: this.generateId()
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
      // Send to appropriate channel
      if (notification.channel === 'telegram' || !notification.channel) {
        // Default to telegram if no channel specified
        await sendTextNotifications(notification.message);
      } else if (notification.channel === 'slack') {
        // TODO: Implement Slack sending
        throw new Error('Slack notifications not yet implemented');
      } else {
        throw new Error(`Unknown notification channel: ${notification.channel}`);
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
  
  getStats() {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      maxRetries: this.maxRetries,
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
