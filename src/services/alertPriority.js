import { logInfo, logError } from '../utils/logging.js';
import { sendTextNotifications } from './notifications.js';
import { metrics } from './metrics.js';
import { alertCooldown } from '../utils/alertCooldown.js';
import { alertConfig } from '../config/alertConfig.js';

export class AlertPriority {
  static HIGH = 'high';
  static MEDIUM = 'medium';
  static LOW = 'low';
  
  static async sendAlert(message, priority = this.MEDIUM, metadata = {}) {
    const timerId = metrics.startTimer('alert_send', { priority });
    
    try {
      // Check cooldown for specific alert types
      const alertType = metadata.type || 'general';
      const cooldownMinutes = this.getCooldownMinutes(alertType, priority);
      
      if (!alertCooldown.canSend(alertType, cooldownMinutes)) {
        logInfo(`Alert skipped due to cooldown: ${alertType}`, { priority, cooldownMinutes });
        metrics.increment('alert_skipped', 1, { priority, type: alertType, reason: 'cooldown' });
        return;
      }
      
      // Высокий приоритет - отправляем во все каналы
      if (priority === this.HIGH) {
        await Promise.all([
          sendTextNotifications(message),
          // Можно добавить SMS или PagerDuty для критичных алертов
        ]);
      } 
      // Средний - только Telegram/Slack
      else if (priority === this.MEDIUM) {
        await sendTextNotifications(message);
      }
      // Низкий - только логируем
      else {
        logInfo('Low priority alert:', { message, metadata });
      }
      
      // Mark as sent for cooldown
      alertCooldown.markSent(alertType);
      
      metrics.endTimer(timerId);
      metrics.increment('alert_sent', 1, { priority, success: true });
    } catch (error) {
      metrics.endTimer(timerId);
      metrics.increment('alert_failed', 1, { priority, error: error.message });
      throw error;
    }
  }
  
  static getCooldownMinutes(alertType, priority) {
    // Get cooldown from config based on alert type
    if (alertType.includes('revenue')) {
      return alertConfig.cooldownMinutes.revenue;
    } else if (alertType.includes('conversion')) {
      return alertConfig.cooldownMinutes.conversion;
    } else if (alertType.includes('vip')) {
      return alertConfig.cooldownMinutes.vip;
    }
    
    // Default cooldowns based on priority
    switch (priority) {
      case this.HIGH:
        return 30; // 30 minutes for high priority
      case this.MEDIUM:
        return 60; // 1 hour for medium priority
      case this.LOW:
        return 120; // 2 hours for low priority
      default:
        return 60;
    }
  }
}

export default AlertPriority;
