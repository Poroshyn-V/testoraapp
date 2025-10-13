# Tests

This directory contains unit tests for the Stripe Ops application.

## Test Structure

- `grouping.test.js` - Tests for payment grouping logic
- `formatting.test.js` - Tests for data formatting functions
- `purchaseCache.test.js` - Tests for purchase cache service
- `retry.test.js` - Tests for retry logic
- `batchOperations.test.js` - Tests for batch update operations
- `metrics.test.js` - Tests for metrics collection and reporting
- `setup.js` - Test setup and mocks

## Running Tests

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Test Coverage

The tests cover critical functions including:

- Payment grouping by customer and time window
- Data formatting for Google Sheets and notifications
- Purchase cache operations
- Retry logic for external API calls
- Batch operations for Google Sheets (updates and adds)
- Metrics collection and performance monitoring
- Performance optimization and rate limiting
- Error handling and edge cases

## Mocking

Tests use Vitest mocking to isolate units under test:

- External API calls (Stripe, Google Sheets)
- Environment variables
- Console methods
- Timers (setTimeout, setInterval)

## Adding New Tests

When adding new functionality:

1. Create corresponding test file in `tests/` directory
2. Follow naming convention: `*.test.js`
3. Use descriptive test names
4. Test both success and failure cases
5. Mock external dependencies
6. Update this README if needed
