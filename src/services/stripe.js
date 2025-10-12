import Stripe from 'stripe';
import { ENV, STRIPE_CONFIG } from '../config/env.js';
import { logInfo, logError } from '../utils/logging.js';

// Initialize Stripe
export const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { 
  apiVersion: STRIPE_CONFIG.API_VERSION 
});

// Stripe service functions
export async function getRecentPayments(limit = 100) {
  try {
    logInfo('Fetching recent payments from Stripe', { limit });
    
    const payments = await stripe.paymentIntents.list({
      limit,
      created: {
        gte: Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000) // Last 7 days
      }
    });
    
    logInfo('Successfully fetched payments from Stripe', { 
      count: payments.data.length 
    });
    
    return payments.data;
  } catch (error) {
    logError('Error fetching payments from Stripe', error);
    throw error;
  }
}

export async function getCustomerPayments(customerId, limit = 100) {
  try {
    logInfo('Fetching customer payments from Stripe', { customerId, limit });
    
    const payments = await stripe.paymentIntents.list({
      customer: customerId,
      limit
    });
    
    logInfo('Successfully fetched customer payments from Stripe', { 
      customerId, 
      count: payments.data.length 
    });
    
    return payments.data;
  } catch (error) {
    logError('Error fetching customer payments from Stripe', error, { customerId });
    throw error;
  }
}

export async function getCustomer(customerId) {
  try {
    logInfo('Fetching customer from Stripe', { customerId });
    
    const customer = await stripe.customers.retrieve(customerId);
    
    logInfo('Successfully fetched customer from Stripe', { customerId });
    
    return customer;
  } catch (error) {
    logError('Error fetching customer from Stripe', error, { customerId });
    throw error;
  }
}
