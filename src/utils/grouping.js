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
 * Check if payment is a subscription update
 * @param {Object} payment - Payment object
 * @returns {boolean} - True if payment is a subscription update
 */
export function isSubscriptionUpdate(payment) {
  if (!payment || !payment.description) return false;
  
  const description = payment.description.toLowerCase().trim();
  
  // Check for various subscription update patterns
  const updatePatterns = [
    'subscription update',
    'subscription_update',
    'sub update',
    'sub_update',
    'update subscription',
    'update_subscription'
  ];
  
  return updatePatterns.some(pattern => description.includes(pattern));
}

/**
 * Check if subscription update is an upsell (has creation on the same day)
 * @param {Object} updatePayment - Subscription update payment
 * @param {Array} allPayments - All payments for the customer
 * @returns {boolean} - True if this is an upsell (has creation same day)
 */
export function isSubscriptionUpdateUpsell(updatePayment, allPayments) {
  if (!isSubscriptionUpdate(updatePayment)) return false;
  
  const paymentDate = new Date(updatePayment.created * 1000);
  const dateKey = paymentDate.toISOString().split('T')[0];
  
  // Check if there's a subscription creation on the same day
  const hasCreationSameDay = allPayments.some(otherPayment => {
    if (otherPayment.id === updatePayment.id) return false;
    
    const otherDate = new Date(otherPayment.created * 1000);
    const otherDateKey = otherDate.toISOString().split('T')[0];
    
    if (otherDateKey !== dateKey) return false;
    
    // Check if it's a subscription creation
    const isCreation = otherPayment.description && (
      otherPayment.description.toLowerCase().includes('subscription creation') ||
      otherPayment.description.toLowerCase().includes('w2w:stripe: subscription creation')
    );
    
    return isCreation && otherPayment.status === 'succeeded';
  });
  
  return hasCreationSameDay;
}

/**
 * Filter successful payments (exclude subscription updates that are NOT upsells)
 * Subscription updates are included ONLY if they are upsells (have creation on same day)
 * @param {Array} payments - Array of payment objects
 * @returns {Array} - Array of successful payments (excluding non-upsell subscription updates)
 */
export function filterSuccessfulPayments(payments) {
  return payments.filter(payment => {
    if (payment.status !== 'succeeded' || !payment.customer) return false;
    
    // If it's a subscription update, check if it's an upsell
    if (isSubscriptionUpdate(payment)) {
      // Only include if it's an upsell (has creation on same day)
      return isSubscriptionUpdateUpsell(payment, payments);
    }
    
    return true;
  });
}
