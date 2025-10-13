import { logInfo, logError } from '../utils/logging.js';
import { sendTextNotifications } from './notifications.js';
import { metrics } from './metrics.js';

export class AlertPriority {
  static HIGH = 'high';
  static MEDIUM = 'medium';
  static LOW = 'low';
  
  static async sendAlert(message, priority = this.MEDIUM, metadata = {}) {
    const timerId = metrics.startTimer('alert_send', { priority });
    
    try {
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
      
      metrics.endTimer(timerId);
      metrics.increment('alert_sent', 1, { priority, success: true });
    } catch (error) {
      metrics.endTimer(timerId);
      metrics.increment('alert_failed', 1, { priority, error: error.message });
      throw error;
    }
  }
}

export default AlertPriority;
