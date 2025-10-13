# Metrics System

The Stripe Ops application includes a comprehensive metrics collection system for monitoring performance, tracking usage, and identifying issues.

## Overview

The metrics system tracks:
- **Counters**: Incremental metrics (API calls, notifications sent, etc.)
- **Gauges**: Absolute values (memory usage, queue sizes, etc.)
- **Timers**: Duration measurements (API response times, sync operations, etc.)
- **Histograms**: Distribution of values (response times, processing durations, etc.)

## Usage

### Basic Metrics

```javascript
import { metrics } from './src/services/metrics.js';

// Increment a counter
metrics.increment('sync_success');
metrics.increment('notification_sent', 1, { type: 'telegram' });

// Set a gauge
metrics.gauge('memory_usage', 1024);
metrics.gauge('queue_size', 5, { queue: 'processing' });

// Record a histogram value
metrics.histogram('response_time', 150);
metrics.histogram('batch_size', 10, { operation: 'update' });
```

### Timers

```javascript
// Start a timer
const timerId = metrics.startTimer('sync_operation', { type: 'full' });

// Do some work...
await performSync();

// End the timer (automatically records duration)
const duration = metrics.endTimer(timerId);
```

## API Endpoints

### Get All Metrics
```
GET /api/metrics
```

Returns complete metrics data including:
- Uptime information
- All counters, gauges, and histograms
- Active timers
- Time since last reset

### Get Metrics Summary
```
GET /api/metrics/summary
```

Returns a summary with:
- Key performance indicators
- Error rates
- Average response times
- Total counts

### Reset Metrics
```
POST /api/metrics/reset
```

Clears all metrics and resets timestamps.

## Tracked Metrics

### Sync Operations
- `sync_started` - Number of sync operations started
- `sync_success` - Number of successful syncs
- `sync_failed` - Number of failed syncs
- `sync_skipped` - Number of skipped syncs (already in progress)
- `sync_duration` - Duration of sync operations (histogram)

### API Calls
- `api_call` - Total API calls made
- `api_error` - Number of API errors
- `api_retry` - Number of retry attempts
- `api_retry_attempt` - Individual retry attempts
- `api_response_time` - API response times (histogram)

### Notifications
- `notification_sent` - Notifications sent successfully
- `notification_failed` - Failed notifications
- Tagged by type: `new_purchase`, `upsell`, `alert`

### Cache Operations
- `load_existing_started` - Cache reload operations started
- `load_existing_success` - Successful cache reloads
- `load_existing_failed` - Failed cache reloads
- `load_existing_duration` - Cache reload duration (histogram)
- `existing_purchases_count` - Current number of cached purchases (gauge)

## Health Check Integration

Metrics are automatically included in the health check endpoint (`/health`) under the `metrics` section, providing:

```json
{
  "metrics": {
    "uptime": {
      "total": 3600000,
      "totalSeconds": 3600,
      "totalMinutes": 60,
      "totalHours": 1
    },
    "keyMetrics": {
      "syncSuccess": 45,
      "syncFailed": 2,
      "notificationsSent": 120,
      "notificationsFailed": 1,
      "apiCalls": 500,
      "apiErrors": 5
    },
    "performance": {
      "avgSyncDuration": 2500,
      "avgApiResponseTime": 150,
      "totalApiCalls": 500,
      "errorRate": 1
    }
  }
}
```

## Performance Monitoring

### Key Performance Indicators (KPIs)
- **Sync Success Rate**: `sync_success / (sync_success + sync_failed)`
- **API Error Rate**: `api_error / api_call`
- **Notification Success Rate**: `notification_sent / (notification_sent + notification_failed)`
- **Average Response Time**: P50, P90, P95, P99 percentiles

### Alerts and Thresholds
Monitor these metrics for anomalies:
- Sync failure rate > 5%
- API error rate > 2%
- Average response time > 5 seconds
- Memory usage > 80%

## Implementation Details

### Memory Management
- Metrics are stored in memory using Maps for efficient access
- No external dependencies (Redis, database)
- Automatic cleanup of old timer entries
- Reset functionality to prevent memory leaks

### Performance
- O(1) operations for counters and gauges
- O(log n) for histogram percentiles
- Minimal overhead on application performance
- Efficient key building with tag sorting

### Thread Safety
- All operations are synchronous
- No concurrent access issues in Node.js single-threaded environment
- Safe for use in async/await contexts

## Examples

### Monitoring Sync Performance
```javascript
// Track sync performance
const timerId = metrics.startTimer('sync_operation');
try {
  await performSync();
  metrics.increment('sync_success');
} catch (error) {
  metrics.increment('sync_failed', 1, { error: error.message });
} finally {
  metrics.endTimer(timerId);
}
```

### API Call Monitoring
```javascript
// Monitor API calls
const timerId = metrics.startTimer('api_call', { endpoint: '/sync-payments' });
try {
  const result = await apiCall();
  metrics.increment('api_call', 1, { success: true });
  return result;
} catch (error) {
  metrics.increment('api_error', 1, { error: error.message });
  throw error;
} finally {
  metrics.endTimer(timerId);
}
```

### Notification Tracking
```javascript
// Track notifications
try {
  await sendNotification(message);
  metrics.increment('notification_sent', 1, { type: 'telegram' });
} catch (error) {
  metrics.increment('notification_failed', 1, { 
    type: 'telegram', 
    error: error.message 
  });
}
```

## Best Practices

1. **Use Descriptive Names**: `sync_success` not `s1`
2. **Add Tags for Context**: `api_call{endpoint:/sync,method:POST}`
3. **Track Both Success and Failure**: Always track both positive and negative outcomes
4. **Use Timers for Operations**: Measure duration of important operations
5. **Monitor Key Metrics**: Set up alerts for critical KPIs
6. **Reset Periodically**: Reset metrics during maintenance windows

## Integration with Monitoring Tools

The metrics system can be easily integrated with external monitoring tools:

- **Prometheus**: Export metrics in Prometheus format
- **Grafana**: Create dashboards from metrics data
- **DataDog**: Send metrics to DataDog
- **New Relic**: Integrate with New Relic monitoring

Example Prometheus export:
```javascript
// Convert metrics to Prometheus format
function exportPrometheusMetrics() {
  const all = metrics.getAll();
  let output = '';
  
  for (const [key, value] of Object.entries(all.counters)) {
    output += `# TYPE ${key} counter\n`;
    output += `${key} ${value}\n`;
  }
  
  return output;
}
```
