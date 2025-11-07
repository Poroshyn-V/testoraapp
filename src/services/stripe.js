import Stripe from 'stripe';
import { ENV, STRIPE_CONFIG } from '../config/env.js';
import { logInfo, logError } from '../utils/logging.js';

// Initialize Stripe (main account)
export const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { 
  apiVersion: STRIPE_CONFIG.API_VERSION 
});

// Initialize Stripe (low-price account)
export const stripeLowPrice = ENV.STRIPE_SECRET_KEY_LOW_PRICE 
  ? new Stripe(ENV.STRIPE_SECRET_KEY_LOW_PRICE, { 
      apiVersion: STRIPE_CONFIG.API_VERSION 
    })
  : null;

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

// Functions for Low Price Stripe account
export async function getRecentPaymentsLowPrice(limit = 1000) {
  if (!stripeLowPrice) {
    throw new Error('Low Price Stripe account not configured');
  }
  
  try {
    logInfo('Fetching recent payments from Low Price Stripe', { limit });
    
    // ✅ Используем пагинацию для получения всех платежей за последние 7 дней
    const allPayments = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore && allPayments.length < limit) {
      const params = {
        limit: Math.min(100, limit - allPayments.length), // Stripe max is 100 per request
        created: {
          gte: Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000) // Last 7 days
        }
      };
      
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
      
      const payments = await stripeLowPrice.paymentIntents.list(params);
      allPayments.push(...payments.data);
      
      hasMore = payments.has_more && allPayments.length < limit;
      if (hasMore && payments.data.length > 0) {
        startingAfter = payments.data[payments.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }
    
    logInfo('Successfully fetched payments from Low Price Stripe', { 
      count: allPayments.length,
      requestedLimit: limit
    });
    
    return allPayments;
  } catch (error) {
    logError('Error fetching payments from Low Price Stripe', error);
    throw error;
  }
}

// Get all payments from Low Price Stripe account (with pagination)
export async function getAllPaymentsLowPrice() {
  if (!stripeLowPrice) {
    throw new Error('Low Price Stripe account not configured');
  }
  
  try {
    logInfo('Fetching ALL payments from Low Price Stripe (this may take a while)...');
    
    const allPayments = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore) {
      const params = {
        limit: 100, // Maximum per request
      };
      
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
      
      const payments = await stripeLowPrice.paymentIntents.list(params);
      
      allPayments.push(...payments.data);
      
      logInfo(`Fetched ${allPayments.length} payments so far...`);
      
      hasMore = payments.has_more;
      if (hasMore && payments.data.length > 0) {
        startingAfter = payments.data[payments.data.length - 1].id;
      }
    }
    
    logInfo('Successfully fetched all payments from Low Price Stripe', { 
      totalCount: allPayments.length 
    });
    
    return allPayments;
  } catch (error) {
    logError('Error fetching all payments from Low Price Stripe', error);
    throw error;
  }
}

export async function getCustomerPaymentsLowPrice(customerId, limit = 100) {
  if (!stripeLowPrice) {
    throw new Error('Low Price Stripe account not configured');
  }
  
  try {
    logInfo('Fetching customer payments from Low Price Stripe', { customerId, limit });
    
    const payments = await stripeLowPrice.paymentIntents.list({
      customer: customerId,
      limit
    });
    
    logInfo('Successfully fetched customer payments from Low Price Stripe', { 
      customerId, 
      count: payments.data.length 
    });
    
    return payments.data;
  } catch (error) {
    logError('Error fetching customer payments from Low Price Stripe', error, { customerId });
    throw error;
  }
}

export async function getCustomerLowPrice(customerId) {
  if (!stripeLowPrice) {
    throw new Error('Low Price Stripe account not configured');
  }
  
  try {
    logInfo('Fetching customer from Low Price Stripe', { customerId });
    
    const customer = await stripeLowPrice.customers.retrieve(customerId);
    
    logInfo('Successfully fetched customer from Low Price Stripe', { customerId });
    
    return customer;
  } catch (error) {
    logError('Error fetching customer from Low Price Stripe', error, { customerId });
    throw error;
  }
}
