import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Metrics } from '../src/services/metrics.js';

// Mock the logging module
vi.mock('../src/utils/logging.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn()
}));

describe('Metrics Service', () => {
  let metrics;

  beforeEach(() => {
    metrics = new Metrics();
  });

  describe('Counters', () => {
    it('should increment counter metrics', () => {
      metrics.increment('test_counter');
      expect(metrics.getCounter('test_counter')).toBe(1);
      
      metrics.increment('test_counter', 5);
      expect(metrics.getCounter('test_counter')).toBe(6);
    });

    it('should decrement counter metrics', () => {
      metrics.increment('test_counter', 10);
      metrics.decrement('test_counter', 3);
      expect(metrics.getCounter('test_counter')).toBe(7);
    });

    it('should handle counter with tags', () => {
      metrics.increment('api_calls', 1, { endpoint: '/test', method: 'GET' });
      metrics.increment('api_calls', 1, { endpoint: '/test', method: 'POST' });
      
      expect(metrics.getCounter('api_calls', { endpoint: '/test', method: 'GET' })).toBe(1);
      expect(metrics.getCounter('api_calls', { endpoint: '/test', method: 'POST' })).toBe(1);
    });
  });

  describe('Gauges', () => {
    it('should set gauge metrics', () => {
      metrics.gauge('memory_usage', 1024);
      expect(metrics.getGauge('memory_usage')).toBe(1024);
      
      metrics.gauge('memory_usage', 2048);
      expect(metrics.getGauge('memory_usage')).toBe(2048);
    });

    it('should handle gauge with tags', () => {
      metrics.gauge('queue_size', 10, { queue: 'processing' });
      metrics.gauge('queue_size', 5, { queue: 'pending' });
      
      expect(metrics.getGauge('queue_size', { queue: 'processing' })).toBe(10);
      expect(metrics.getGauge('queue_size', { queue: 'pending' })).toBe(5);
    });
  });

  describe('Timers', () => {
    it('should measure timer duration', () => {
      const timerId = metrics.startTimer('test_operation');
      
      // Simulate some work
      setTimeout(() => {
        const duration = metrics.endTimer(timerId);
        expect(duration).toBeGreaterThan(0);
      }, 10);
    });

    it('should record timer in histogram', () => {
      const timerId = metrics.startTimer('test_operation');
      
      // Simulate immediate completion
      const duration = metrics.endTimer(timerId);
      
      const stats = metrics.getHistogramStats('test_operation_duration');
      expect(stats.count).toBe(1);
      expect(stats.sum).toBe(duration);
    });

    it('should increment timer count', () => {
      const timerId = metrics.startTimer('test_operation');
      metrics.endTimer(timerId);
      
      expect(metrics.getCounter('test_operation_count')).toBe(1);
    });

    it('should handle timer with tags', () => {
      const timerId = metrics.startTimer('api_call', { endpoint: '/test' });
      const duration = metrics.endTimer(timerId);
      
      const stats = metrics.getHistogramStats('api_call_duration', { endpoint: '/test' });
      expect(stats.count).toBe(1);
      expect(stats.sum).toBe(duration);
    });
  });

  describe('Histograms', () => {
    it('should record histogram values', () => {
      metrics.histogram('response_time', 100);
      metrics.histogram('response_time', 200);
      metrics.histogram('response_time', 150);
      
      const stats = metrics.getHistogramStats('response_time');
      expect(stats.count).toBe(3);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(200);
      expect(stats.avg).toBe(150);
      expect(stats.sum).toBe(450);
    });

    it('should calculate percentiles', () => {
      // Add 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        metrics.histogram('test_values', i);
      }
      
      const stats = metrics.getHistogramStats('test_values');
      expect(stats.p50).toBe(50);
      expect(stats.p90).toBe(90);
      expect(stats.p95).toBe(95);
      expect(stats.p99).toBe(99);
    });

    it('should handle empty histogram', () => {
      const stats = metrics.getHistogramStats('empty_histogram');
      expect(stats.count).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.avg).toBe(0);
      expect(stats.sum).toBe(0);
    });
  });

  describe('Get All Metrics', () => {
    it('should return all metrics data', () => {
      metrics.increment('test_counter');
      metrics.gauge('test_gauge', 42);
      metrics.histogram('test_histogram', 100);
      
      const all = metrics.getAll();
      
      expect(all.counters).toHaveProperty('test_counter');
      expect(all.gauges).toHaveProperty('test_gauge');
      expect(all.histograms).toHaveProperty('test_histogram');
      expect(all.uptime).toBeDefined();
      expect(all.timers).toBeDefined();
    });

    it('should include uptime information', () => {
      const all = metrics.getAll();
      
      expect(all.uptime.total).toBeGreaterThan(0);
      expect(all.uptime.totalSeconds).toBeGreaterThan(0);
      expect(all.timeSinceReset).toBeDefined();
    });
  });

  describe('Get Summary', () => {
    it('should return metrics summary', () => {
      metrics.increment('sync_success');
      metrics.increment('sync_failed');
      metrics.increment('notification_sent');
      metrics.increment('api_call');
      metrics.increment('api_error');
      
      const summary = metrics.getSummary();
      
      expect(summary.uptime).toBeDefined();
      expect(summary.totalMetrics).toBeDefined();
      expect(summary.keyMetrics).toBeDefined();
      expect(summary.performance).toBeDefined();
      
      expect(summary.keyMetrics.syncSuccess).toBe(1);
      expect(summary.keyMetrics.syncFailed).toBe(1);
      expect(summary.keyMetrics.notificationsSent).toBe(1);
      expect(summary.keyMetrics.apiCalls).toBe(1);
      expect(summary.keyMetrics.apiErrors).toBe(1);
    });

    it('should calculate error rate', () => {
      metrics.increment('api_call', 10);
      metrics.increment('api_error', 2);
      
      const summary = metrics.getSummary();
      expect(summary.performance.errorRate).toBe(20); // 2/10 * 100
    });

    it('should handle zero total calls', () => {
      const summary = metrics.getSummary();
      expect(summary.performance.errorRate).toBe(0);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      metrics.increment('test_counter');
      metrics.gauge('test_gauge', 42);
      metrics.histogram('test_histogram', 100);
      
      metrics.reset();
      
      expect(metrics.getCounter('test_counter')).toBe(0);
      expect(metrics.getGauge('test_gauge')).toBe(0);
      expect(metrics.getHistogramStats('test_histogram').count).toBe(0);
    });

    it('should update reset timestamp', () => {
      const beforeReset = metrics.getAll().timeSinceReset.total;
      
      // Wait a bit
      setTimeout(() => {
        metrics.reset();
        const afterReset = metrics.getAll().timeSinceReset.total;
        expect(afterReset).toBeLessThan(beforeReset);
      }, 10);
    });
  });

  describe('Key Building', () => {
    it('should build keys without tags', () => {
      metrics.increment('simple_metric');
      expect(metrics.getCounter('simple_metric')).toBe(1);
    });

    it('should build keys with tags', () => {
      metrics.increment('tagged_metric', 1, { tag1: 'value1', tag2: 'value2' });
      expect(metrics.getCounter('tagged_metric', { tag1: 'value1', tag2: 'value2' })).toBe(1);
    });

    it('should handle tag order consistently', () => {
      metrics.increment('ordered_metric', 1, { b: '2', a: '1' });
      metrics.increment('ordered_metric', 1, { a: '1', b: '2' });
      
      expect(metrics.getCounter('ordered_metric', { a: '1', b: '2' })).toBe(2);
    });
  });

  describe('Performance', () => {
    it('should handle many metrics efficiently', () => {
      const startTime = Date.now();
      
      // Add 1000 metrics
      for (let i = 0; i < 1000; i++) {
        metrics.increment(`metric_${i}`);
      }
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
      
      const all = metrics.getAll();
      expect(Object.keys(all.counters).length).toBe(1000);
    });

    it('should handle many histogram values efficiently', () => {
      const startTime = Date.now();
      
      // Add 1000 histogram values
      for (let i = 0; i < 1000; i++) {
        metrics.histogram('performance_test', i);
      }
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
      
      const stats = metrics.getHistogramStats('performance_test');
      expect(stats.count).toBe(1000);
    });
  });
});
