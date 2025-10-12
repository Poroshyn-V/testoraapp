// Validation utilities
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateCustomerId(customerId) {
  return customerId && typeof customerId === 'string' && customerId.startsWith('cus_');
}

export function validatePaymentId(paymentId) {
  return paymentId && typeof paymentId === 'string' && paymentId.startsWith('pi_');
}

export function validateAmount(amount) {
  return typeof amount === 'number' && amount > 0 && amount < 1000000; // максимум $10,000
}

export function validateWebhookSignature(signature, payload, secret) {
  if (!signature || !payload || !secret) {
    return false;
  }
  // Stripe webhook signature validation будет добавлена позже
  return true;
}
