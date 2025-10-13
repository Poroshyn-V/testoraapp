import { logInfo, logWarn } from '../utils/logging.js';

class PerformanceMonitor {
  constructor() {
    this.operations = new Map();
    this.slowOperations = [];
    this.MAX_SLOW_OPS = 50;
  }
  
  recordOperation(name, duration, metadata = {}) {
    // Track average duration
    if (!this.operations.has(name)) {
      this.operations.set(name, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0
      });
    }
    
    const op = this.operations.get(name);
    op.count++;
    op.totalDuration += duration;
    op.avgDuration = Math.round(op.totalDuration / op.count);
    op.minDuration = Math.min(op.minDuration, duration);
    op.maxDuration = Math.max(op.maxDuration, duration);
    
    // Track slow operations (> 5 seconds)
    if (duration > 5000) {
      this.slowOperations.unshift({
        name,
        duration,
        timestamp: new Date().toISOString(),
        metadata
      });
      
      if (this.slowOperations.length > this.MAX_SLOW_OPS) {
        this.slowOperations.pop();
      }
      
      logWarn('🐌 Slow operation detected', {
        operation: name,
        duration: `${duration}ms`,
        threshold: '5000ms',
        metadata
      });
    }
  }
  
  getStats() {
    return {
      operations: Object.fromEntries(this.operations),
      slowOperations: this.slowOperations.slice(0, 10),
      totalSlowOps: this.slowOperations.length
    };
  }
  
  reset() {
    this.operations.clear();
    this.slowOperations = [];
  }
}

export const performanceMonitor = new PerformanceMonitor();
export default performanceMonitor;
