import { logInfo, logError } from '../utils/logging.js';

/**
 * Metrics service for tracking application performance and statistics
 */
class Metrics {
  constructor() {
    this.counters = new Map();
    this.timers = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.startTime = Date.now();
    this.lastReset = Date.now();
  }

  /**
   * Increment a counter metric
   * @param {string} metric - Metric name
   * @param {number} value - Value to increment by (default: 1)
   * @param {Object} tags - Optional tags for the metric
   */
  increment(metric, value = 1, tags = {}) {
    const key = this._buildKey(metric, tags);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
    
    logInfo('Metric incremented', {
      metric,
      value,
      tags,
      total: this.counters.get(key)
    });
  }

  /**
   * Decrement a counter metric
   * @param {string} metric - Metric name
   * @param {number} value - Value to decrement by (default: 1)
   * @param {Object} tags - Optional tags for the metric
   */
  decrement(metric, value = 1, tags = {}) {
    const key = this._buildKey(metric, tags);
    this.counters.set(key, (this.counters.get(key) || 0) - value);
    
    logInfo('Metric decremented', {
      metric,
      value,
      tags,
      total: this.counters.get(key)
    });
  }

  /**
   * Set a gauge metric (absolute value)
   * @param {string} metric - Metric name
   * @param {number} value - Value to set
   * @param {Object} tags - Optional tags for the metric
   */
  gauge(metric, value, tags = {}) {
    const key = this._buildKey(metric, tags);
    this.gauges.set(key, value);
    
    logInfo('Gauge metric set', {
      metric,
      value,
      tags
    });
  }

  /**
   * Start a timer
   * @param {string} metric - Timer name
   * @param {Object} tags - Optional tags for the timer
   * @returns {string} - Timer ID
   */
  startTimer(metric, tags = {}) {
    const timerId = `${metric}_${Date.now()}_${Math.random()}`;
    this.timers.set(timerId, {
      metric,
      tags,
      startTime: Date.now()
    });
    
    return timerId;
  }

  /**
   * End a timer and record the duration
   * @param {string} timerId - Timer ID returned by startTimer
   * @returns {number} - Duration in milliseconds
   */
  endTimer(timerId) {
    const timer = this.timers.get(timerId);
    if (!timer) {
      logError('Timer not found', null, { timerId });
      return 0;
    }

    const duration = Date.now() - timer.startTime;
    const key = this._buildKey(`${timer.metric}_duration`, timer.tags);
    
    // Store duration in histogram
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(duration);
    
    // Also increment counter for this timer
    this.increment(`${timer.metric}_count`, 1, timer.tags);
    
    // Clean up timer
    this.timers.delete(timerId);
    
    logInfo('Timer ended', {
      metric: timer.metric,
      duration: `${duration}ms`,
      tags: timer.tags
    });
    
    return duration;
  }

  /**
   * Record a histogram value
   * @param {string} metric - Metric name
   * @param {number} value - Value to record
   * @param {Object} tags - Optional tags for the metric
   */
  histogram(metric, value, tags = {}) {
    const key = this._buildKey(metric, tags);
    
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);
    
    logInfo('Histogram value recorded', {
      metric,
      value,
      tags,
      count: this.histograms.get(key).length
    });
  }

  /**
   * Get all metrics
   * @returns {Object} - All metrics data
   */
  getAll() {
    const uptime = Date.now() - this.startTime;
    const timeSinceReset = Date.now() - this.lastReset;
    
    return {
      uptime: {
        total: uptime,
        totalSeconds: Math.round(uptime / 1000),
        totalMinutes: Math.round(uptime / 60000),
        totalHours: Math.round(uptime / 3600000)
      },
      timeSinceReset: {
        total: timeSinceReset,
        totalSeconds: Math.round(timeSinceReset / 1000)
      },
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: this._getHistogramStats(),
      timers: {
        active: this.timers.size,
        activeTimers: Array.from(this.timers.keys())
      }
    };
  }

  /**
   * Get counter value
   * @param {string} metric - Metric name
   * @param {Object} tags - Optional tags
   * @returns {number} - Counter value
   */
  getCounter(metric, tags = {}) {
    const key = this._buildKey(metric, tags);
    return this.counters.get(key) || 0;
  }

  /**
   * Get gauge value
   * @param {string} metric - Metric name
   * @param {Object} tags - Optional tags
   * @returns {number} - Gauge value
   */
  getGauge(metric, tags = {}) {
    const key = this._buildKey(metric, tags);
    return this.gauges.get(key) || 0;
  }

  /**
   * Get histogram statistics
   * @param {string} metric - Metric name
   * @param {Object} tags - Optional tags
   * @returns {Object} - Histogram stats
   */
  getHistogramStats(metric, tags = {}) {
    const key = this._buildKey(metric, tags);
    const values = this.histograms.get(key) || [];
    
    if (values.length === 0) {
      return { count: 0, min: 0, max: 0, avg: 0, sum: 0 };
    }
    
    const sorted = values.sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);
    
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(sum / values.length),
      sum: sum,
      p50: this._percentile(sorted, 50),
      p90: this._percentile(sorted, 90),
      p95: this._percentile(sorted, 95),
      p99: this._percentile(sorted, 99)
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();
    this.lastReset = Date.now();
    
    logInfo('Metrics reset', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get metrics summary for health checks
   * @returns {Object} - Summary metrics
   */
  getSummary() {
    const all = this.getAll();
    
    return {
      uptime: all.uptime,
      totalMetrics: {
        counters: this.counters.size,
        gauges: this.gauges.size,
        histograms: this.histograms.size,
        activeTimers: this.timers.size
      },
      keyMetrics: {
        syncSuccess: this.getCounter('sync_success'),
        syncFailed: this.getCounter('sync_failed'),
        notificationsSent: this.getCounter('notification_sent'),
        notificationsFailed: this.getCounter('notification_failed'),
        apiCalls: this.getCounter('api_call'),
        apiErrors: this.getCounter('api_error')
      },
      performance: {
        avgSyncDuration: this.getHistogramStats('sync_duration').avg,
        avgApiResponseTime: this.getHistogramStats('api_response_time').avg,
        totalApiCalls: this.getCounter('api_call'),
        errorRate: this._calculateErrorRate()
      }
    };
  }

  /**
   * Build metric key with tags
   * @private
   */
  _buildKey(metric, tags) {
    if (Object.keys(tags).length === 0) {
      return metric;
    }
    
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(',');
    
    return `${metric}{${tagString}}`;
  }

  /**
   * Get histogram statistics for all histograms
   * @private
   */
  _getHistogramStats() {
    const stats = {};
    
    for (const [key, values] of this.histograms) {
      if (values.length === 0) continue;
      
      const sorted = values.sort((a, b) => a - b);
      const sum = values.reduce((acc, val) => acc + val, 0);
      
      stats[key] = {
        count: values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(sum / values.length),
        sum: sum,
        p50: this._percentile(sorted, 50),
        p90: this._percentile(sorted, 90),
        p95: this._percentile(sorted, 95),
        p99: this._percentile(sorted, 99)
      };
    }
    
    return stats;
  }

  /**
   * Calculate percentile
   * @private
   */
  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    
    if (upper >= sorted.length) return sorted[sorted.length - 1];
    if (lower === upper) return sorted[lower];
    
    return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
  }

  /**
   * Calculate error rate
   * @private
   */
  _calculateErrorRate() {
    const totalCalls = this.getCounter('api_call');
    const errors = this.getCounter('api_error');
    
    if (totalCalls === 0) return 0;
    
    return Math.round((errors / totalCalls) * 100);
  }
}

// Export singleton instance
export const metrics = new Metrics();
export default metrics;
