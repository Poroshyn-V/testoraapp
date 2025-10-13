import { describe, it, expect, beforeEach } from 'vitest';
import { formatPaymentForSheets, formatTelegramNotification, formatCampaignName } from '../src/utils/formatting.js';

describe('Formatting Functions', () => {
  let mockPayment;
  let mockCustomer;

  beforeEach(() => {
    mockCustomer = {
      id: 'cus_test123',
      email: 'test@example.com',
      metadata: {
        ad_name: 'TestAd',
        adset_name: 'TestAdset',
        campaign_name: 'TestCampaign',
        creative_link: 'https://example.com'
      }
    };

    mockPayment = {
      id: 'pi_test123',
      amount: 999,
      currency: 'usd',
      created: 1000000000,
      description: 'Test payment',
      metadata: {
        ad_name: 'PaymentAd',
        adset_name: 'PaymentAdset'
      }
    };
  });

  describe('formatPaymentForSheets', () => {
    it('should format payment data for Google Sheets', () => {
      const result = formatPaymentForSheets(mockPayment, mockCustomer);
      
      expect(result).toHaveProperty('Customer ID', 'cus_test123');
      expect(result).toHaveProperty('Email', 'test@example.com');
      expect(result).toHaveProperty('Amount', '9.99');
      expect(result).toHaveProperty('Currency', 'USD');
      expect(result).toHaveProperty('Payment Intent ID', 'pi_test123');
    });

    it('should prioritize customer metadata over payment metadata', () => {
      const result = formatPaymentForSheets(mockPayment, mockCustomer);
      
      expect(result).toHaveProperty('Ad Name', 'TestAd');
      expect(result).toHaveProperty('Adset Name', 'TestAdset');
      expect(result).toHaveProperty('Campaign Name', 'TestCampaign');
    });

    it('should handle missing metadata gracefully', () => {
      const customerNoMeta = { id: 'cus_test123', email: 'test@example.com' };
      const paymentNoMeta = { id: 'pi_test123', amount: 999, currency: 'usd' };
      
      const result = formatPaymentForSheets(paymentNoMeta, customerNoMeta);
      
      expect(result).toHaveProperty('Ad Name', 'N/A');
      expect(result).toHaveProperty('Adset Name', 'N/A');
      expect(result).toHaveProperty('Campaign Name', 'N/A');
    });

    it('should format timestamp correctly', () => {
      const result = formatPaymentForSheets(mockPayment, mockCustomer);
      
      expect(result).toHaveProperty('Created Local (UTC+1)');
      expect(result['Created Local (UTC+1)']).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\+1/);
    });
  });

  describe('formatTelegramNotification', () => {
    it('should format notification with structured data', () => {
      const metadata = {
        'Ad Name': 'TestAd',
        'Adset Name': 'TestAdset',
        'Campaign Name': 'TestCampaign',
        'Creative Link': 'https://example.com'
      };

      const result = formatTelegramNotification(mockPayment, mockCustomer, metadata);
      
      expect(result).toContain('🟢 Purchase');
      expect(result).toContain('💰 9.99 USD');
      expect(result).toContain('📧 test@example.com');
      expect(result).toContain('TestAd');
      expect(result).toContain('TestAdset');
      expect(result).toContain('TestCampaign');
    });

    it('should handle missing data gracefully', () => {
      const result = formatTelegramNotification(mockPayment, mockCustomer, {});
      
      expect(result).toContain('N/A');
      expect(result).toContain('Unknown');
    });

    it('should format purchase ID correctly', () => {
      const result = formatTelegramNotification(mockPayment, mockCustomer, {});
      
      expect(result).toContain('purchase_cus_test123');
    });
  });

  describe('formatCampaignName', () => {
    it('should add separators to campaign names', () => {
      expect(formatCampaignName('WEBENUS')).toBe('WEB_EN_US');
      expect(formatCampaignName('41Testora')).toBe('41_Testora');
      expect(formatCampaignName('TestoraWEB')).toBe('Testora_WEB');
    });

    it('should handle camelCase names', () => {
      expect(formatCampaignName('testCampaign')).toBe('test_Campaign');
      expect(formatCampaignName('myTestCampaign')).toBe('my_Test_Campaign');
    });

    it('should handle numbers and letters', () => {
      expect(formatCampaignName('test123')).toBe('test_123');
      expect(formatCampaignName('123test')).toBe('123_test');
      expect(formatCampaignName('test123abc')).toBe('test_123_abc');
    });

    it('should handle common abbreviations', () => {
      expect(formatCampaignName('WEBENUSBroad')).toBe('WEB_EN_US_Broad');
      expect(formatCampaignName('testoraLC')).toBe('testora_LC');
      expect(formatCampaignName('CoreABO')).toBe('Core_ABO');
    });

    it('should clean up multiple underscores', () => {
      expect(formatCampaignName('test__name')).toBe('test_name');
      expect(formatCampaignName('test___name')).toBe('test_name');
    });

    it('should remove leading and trailing underscores', () => {
      expect(formatCampaignName('_test_name_')).toBe('test_name');
      expect(formatCampaignName('__test__')).toBe('test');
    });

    it('should handle N/A values', () => {
      expect(formatCampaignName('N/A')).toBe('N/A');
      expect(formatCampaignName(null)).toBe(null);
      expect(formatCampaignName(undefined)).toBe(undefined);
    });

    it('should handle empty strings', () => {
      expect(formatCampaignName('')).toBe('');
    });
  });
});
