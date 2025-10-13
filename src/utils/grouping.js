/**
 * Payment grouping utilities
 */

/**
 * Group payments by customer within a time window
 * @param {Array} payments - Array of payment objects
 * @param {number} timeWindowSeconds - Time window in seconds (default: 3 hours)
 * @returns {Map} - Map of grouped payments by customer
 */
export function groupPaymentsByCustomer(payments, timeWindowSeconds = 3 * 60 * 60) {
  const groupedPurchases = new Map();
  
  for (const payment of payments) {
    const customerId = payment.customer?.id || payment.customer;
    if (!customerId) continue;
    
    // Find existing group for this customer within time window
    let foundGroup = null;
    
    for (const [key, group] of groupedPurchases.entries()) {
      if (key.startsWith(customerId + '_')) {
        const timeDiff = Math.abs(payment.created - group.firstPayment.created);
        if (timeDiff <= timeWindowSeconds) {
          foundGroup = group;
          break;
        }
      }
    }
    
    if (foundGroup) {
      // Add to existing group
      foundGroup.payments.push(payment);
      foundGroup.totalAmount += payment.amount;
    } else {
      // Create new group
      const groupKey = `${customerId}_${payment.created}`;
      groupedPurchases.set(groupKey, {
        customer: payment.customer,
        payments: [payment],
        totalAmount: payment.amount,
        firstPayment: payment
      });
    }
  }
  
  return groupedPurchases;
}

/**
 * Calculate total amount for a group of payments
 * @param {Array} payments - Array of payment objects
 * @returns {number} - Total amount in cents
 */
export function calculateTotalAmount(payments) {
  return payments.reduce((total, payment) => total + (payment.amount || 0), 0);
}

/**
 * Check if two payments are within time window
 * @param {Object} payment1 - First payment
 * @param {Object} payment2 - Second payment
 * @param {number} timeWindowSeconds - Time window in seconds
 * @returns {boolean} - True if within time window
 */
export function isWithinTimeWindow(payment1, payment2, timeWindowSeconds = 3 * 60 * 60) {
  const timeDiff = Math.abs(payment1.created - payment2.created);
  return timeDiff <= timeWindowSeconds;
}

/**
 * Extract customer ID from payment object
 * @param {Object} payment - Payment object
 * @returns {string|null} - Customer ID or null
 */
export function extractCustomerId(payment) {
  if (!payment) return null;
  if (typeof payment.customer === 'string') return payment.customer;
  if (payment.customer?.id) return payment.customer.id;
  return null;
}

/**
 * Filter successful payments
 * @param {Array} payments - Array of payment objects
 * @returns {Array} - Array of successful payments
 */
export function filterSuccessfulPayments(payments) {
  return payments.filter(payment => {
    if (payment.status !== 'succeeded' || !payment.customer) return false;
    if (payment.description && payment.description.toLowerCase().includes('subscription update')) {
      return false;
    }
    return true;
  });
}
