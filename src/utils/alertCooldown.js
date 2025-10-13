import { logInfo } from './logging.js';

class AlertCooldown {
  constructor() {
    this.lastSent = new Map(); // alertType -> timestamp
  }
  
  canSend(alertType, cooldownMinutes = 60) {
    const now = Date.now();
    const lastSentTime = this.lastSent.get(alertType);
    
    if (!lastSentTime) {
      return true;
    }
    
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSinceLastAlert = now - lastSentTime;
    
    if (timeSinceLastAlert < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - timeSinceLastAlert) / 60000);
      logInfo(`⏸️ Alert cooldown active for ${alertType}`, {
        remainingMinutes,
        lastSent: new Date(lastSentTime).toISOString()
      });
      return false;
    }
    
    return true;
  }
  
  markSent(alertType) {
    this.lastSent.set(alertType, Date.now());
    // Note: saveAlertHistory will be called from the calling function
    // to avoid circular dependencies
  }
  
  reset(alertType) {
    this.lastSent.delete(alertType);
  }
  
  getStats() {
    const stats = {};
    for (const [type, timestamp] of this.lastSent.entries()) {
      const minutesAgo = Math.floor((Date.now() - timestamp) / 60000);
      stats[type] = {
        lastSent: new Date(timestamp).toISOString(),
        minutesAgo
      };
    }
    return stats;
  }
}

export const alertCooldown = new AlertCooldown();
export default alertCooldown;
