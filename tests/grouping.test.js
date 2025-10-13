import { describe, it, expect, beforeEach } from 'vitest';
import { 
  groupPaymentsByCustomer, 
  calculateTotalAmount, 
  isWithinTimeWindow, 
  extractCustomerId,
  filterSuccessfulPayments 
} from '../src/utils/grouping.js';

describe('Payment Grouping', () => {
  let mockPayments;
  let mockCustomer;

  beforeEach(() => {
    mockCustomer = {
      id: 'cus_test123',
      email: 'test@example.com',
      metadata: {}
    };

    mockPayments = [
      {
        id: 'pi_1',
        amount: 999,
        status: 'succeeded',
        created: 1000000000, // Unix timestamp
        customer: mockCustomer,
        description: 'Test payment'
      },
      {
        id: 'pi_2',
        amount: 1999,
        status: 'succeeded',
        created: 1000000000 + 3600, // 1 hour later
        customer: mockCustomer,
        description: 'Test payment 2'
      },
      {
        id: 'pi_3',
        amount: 999,
        status: 'succeeded',
        created: 1000000000 + 14400, // 4 hours later (outside 3-hour window)
        customer: mockCustomer,
        description: 'Test payment 3'
      }
    ];
  });

  describe('groupPaymentsByCustomer', () => {
    it('should group payments within 3-hour window', () => {
      const grouped = groupPaymentsByCustomer(mockPayments);
      
      expect(grouped.size).toBe(2); // 2 groups: first 2 payments, then the 3rd
      
      // Check first group (first 2 payments)
      const firstGroup = Array.from(grouped.values())[0];
      expect(firstGroup.payments).toHaveLength(2);
      expect(firstGroup.totalAmount).toBe(2998); // 999 + 1999
      expect(firstGroup.customer.id).toBe('cus_test123');
    });

    it('should create separate groups for payments outside time window', () => {
      const payments = [
        {
          id: 'pi_1',
          amount: 999,
          status: 'succeeded',
          created: 1000000000,
          customer: mockCustomer
        },
        {
          id: 'pi_2',
          amount: 1999,
          status: 'succeeded',
          created: 1000000000 + 14400, // 4 hours later
          customer: mockCustomer
        }
      ];

      const grouped = groupPaymentsByCustomer(payments);
      expect(grouped.size).toBe(2);
    });

    it('should handle custom time window', () => {
      const payments = [
        {
          id: 'pi_1',
          amount: 999,
          status: 'succeeded',
          created: 1000000000,
          customer: mockCustomer
        },
        {
          id: 'pi_2',
          amount: 1999,
          status: 'succeeded',
          created: 1000000000 + 7200, // 2 hours later
          customer: mockCustomer
        }
      ];

      // Test with 1-hour window (should create 2 groups)
      const grouped1h = groupPaymentsByCustomer(payments, 3600);
      expect(grouped1h.size).toBe(2);

      // Test with 3-hour window (should create 1 group)
      const grouped3h = groupPaymentsByCustomer(payments, 10800);
      expect(grouped3h.size).toBe(1);
    });

    it('should handle payments without customer', () => {
      const payments = [
        {
          id: 'pi_1',
          amount: 999,
          status: 'succeeded',
          created: 1000000000,
          customer: null
        },
        {
          id: 'pi_2',
          amount: 1999,
          status: 'succeeded',
          created: 1000000000 + 3600,
          customer: mockCustomer
        }
      ];

      const grouped = groupPaymentsByCustomer(payments);
      expect(grouped.size).toBe(1); // Only one group for valid customer
    });

    it('should handle string customer IDs', () => {
      const payments = [
        {
          id: 'pi_1',
          amount: 999,
          status: 'succeeded',
          created: 1000000000,
          customer: 'cus_string123'
        }
      ];

      const grouped = groupPaymentsByCustomer(payments);
      expect(grouped.size).toBe(1);
    });
  });

  describe('calculateTotalAmount', () => {
    it('should calculate total amount correctly', () => {
      const payments = [
        { amount: 999 },
        { amount: 1999 },
        { amount: 500 }
      ];

      const total = calculateTotalAmount(payments);
      expect(total).toBe(3498);
    });

    it('should handle empty array', () => {
      const total = calculateTotalAmount([]);
      expect(total).toBe(0);
    });

    it('should handle payments without amount', () => {
      const payments = [
        { amount: 999 },
        { amount: null },
        { amount: undefined }
      ];

      const total = calculateTotalAmount(payments);
      expect(total).toBe(999);
    });
  });

  describe('isWithinTimeWindow', () => {
    it('should return true for payments within time window', () => {
      const payment1 = { created: 1000000000 };
      const payment2 = { created: 1000000000 + 3600 }; // 1 hour later

      const result = isWithinTimeWindow(payment1, payment2, 10800); // 3 hours
      expect(result).toBe(true);
    });

    it('should return false for payments outside time window', () => {
      const payment1 = { created: 1000000000 };
      const payment2 = { created: 1000000000 + 14400 }; // 4 hours later

      const result = isWithinTimeWindow(payment1, payment2, 10800); // 3 hours
      expect(result).toBe(false);
    });

    it('should handle same timestamp', () => {
      const payment1 = { created: 1000000000 };
      const payment2 = { created: 1000000000 };

      const result = isWithinTimeWindow(payment1, payment2, 10800);
      expect(result).toBe(true);
    });
  });

  describe('extractCustomerId', () => {
    it('should extract customer ID from object', () => {
      const payment = { customer: { id: 'cus_test123' } };
      const customerId = extractCustomerId(payment);
      expect(customerId).toBe('cus_test123');
    });

    it('should extract customer ID from string', () => {
      const payment = { customer: 'cus_string123' };
      const customerId = extractCustomerId(payment);
      expect(customerId).toBe('cus_string123');
    });

    it('should return null for invalid payment', () => {
      expect(extractCustomerId(null)).toBe(null);
      expect(extractCustomerId(undefined)).toBe(null);
      expect(extractCustomerId({})).toBe(null);
    });

    it('should return null for payment without customer', () => {
      const payment = { id: 'pi_1', amount: 999 };
      const customerId = extractCustomerId(payment);
      expect(customerId).toBe(null);
    });
  });

  describe('filterSuccessfulPayments', () => {
    it('should filter successful payments', () => {
      const payments = [
        { id: 'pi_1', status: 'succeeded', customer: 'cus_1' },
        { id: 'pi_2', status: 'failed', customer: 'cus_2' },
        { id: 'pi_3', status: 'succeeded', customer: 'cus_3' }
      ];

      const filtered = filterSuccessfulPayments(payments);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('pi_1');
      expect(filtered[1].id).toBe('pi_3');
    });

    it('should exclude subscription update payments', () => {
      const payments = [
        { id: 'pi_1', status: 'succeeded', customer: 'cus_1', description: 'Regular payment' },
        { id: 'pi_2', status: 'succeeded', customer: 'cus_2', description: 'Subscription update payment' },
        { id: 'pi_3', status: 'succeeded', customer: 'cus_3', description: 'SUBSCRIPTION UPDATE' }
      ];

      const filtered = filterSuccessfulPayments(payments);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('pi_1');
    });

    it('should exclude payments without customer', () => {
      const payments = [
        { id: 'pi_1', status: 'succeeded', customer: 'cus_1' },
        { id: 'pi_2', status: 'succeeded', customer: null },
        { id: 'pi_3', status: 'succeeded' }
      ];

      const filtered = filterSuccessfulPayments(payments);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('pi_1');
    });
  });
});
