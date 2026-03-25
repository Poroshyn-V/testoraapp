// Primer API service for PayPal payments
import { ENV } from '../config/env.js';
import { logInfo, logError } from '../utils/logging.js';
import { fetchWithRetry } from '../utils/retry.js';

// Primer API configuration
const PRIMER_API_URL = ENV.PRIMER_API_URL || 'https://api.primer.io';
const PRIMER_API_KEY = ENV.PRIMER_API_KEY;
const PRIMER_API_VERSION = ENV.PRIMER_API_VERSION || '2.4';

// Helper function to make Primer API requests
async function primerApiRequest(endpoint, options = {}) {
  if (!PRIMER_API_KEY) {
    throw new Error('Primer API key not configured');
  }

  const url = `${PRIMER_API_URL}${endpoint}`;
  const headers = {
    'X-API-KEY': PRIMER_API_KEY, // Primer использует X-API-KEY заголовок (заглавные буквы)
    'X-API-VERSION': PRIMER_API_VERSION, // Primer требует версию API (заглавные буквы)
    'Content-Type': 'application/json',
    ...options.headers
  };

  try {
    const response = await fetchWithRetry(() => 
      fetch(url, {
        ...options,
        headers
      })
    );

    if (!response.ok) {
      const errorText = await response.text();
      logError('Primer API FULL error response', new Error('Primer API error'), {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        endpoint,
        url,
        apiVersion: PRIMER_API_VERSION,
        hasApiKey: !!PRIMER_API_KEY,
        apiKeyPrefix: PRIMER_API_KEY ? PRIMER_API_KEY.substring(0, 8) + '...' : 'MISSING'
      });
      throw new Error(`Primer API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    logError('Primer API request failed', error, { endpoint, url });
    throw error;
  }
}

/**
 * Get recent payments from Primer API
 * Документация: https://primer.io/docs/api-reference/v2.4/api-reference/payments-api/search-&-list-payments
 * @param {number} limit - Maximum number of payments to fetch
 * @param {number} days - Number of days to look back (default: 7)
 * @returns {Promise<Array>} Array of payment objects
 */
export async function getRecentPaymentsPrimer(limit = 100, days = 7) {
  if (!PRIMER_API_KEY) {
    logInfo('Primer API not configured, skipping');
    return [];
  }

  try {
    logInfo('Fetching recent payments from Primer API (with pagination)', { limit, days });

    const endpoint = '/payments';

    // Calculate date range
    const toDate = new Date().toISOString();
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const allPayments = [];
    let cursor = null;
    let requestCount = 0;
    const maxRequests = 100; // Защита от бесконечного цикла

    while (requestCount < maxRequests) {
      requestCount++;

      const params = new URLSearchParams({
        limit: '100', // Maximum per page
        from_date: fromDate,
        to_date: toDate,
        status: 'SETTLED,AUTHORIZED'
      });

      if (cursor) {
        params.append('cursor', cursor);
      }

      try {
        const response = await primerApiRequest(`${endpoint}?${params.toString()}`);
        const payments = response.data || [];

        // Фильтруем только payments для приложения "testora"
        const testoraPayments = payments.filter(payment => {
          const metadata = payment.metadata || {};
          const application = metadata.application || '';
          return application.toLowerCase() === 'testora';
        });

        allPayments.push(...testoraPayments);

        if (requestCount === 1) {
          logInfo(`First page: total=${payments.length}, testora=${testoraPayments.length}`);
        }

        // Check for more pages
        if (response.nextCursor && payments.length > 0) {
          cursor = response.nextCursor;
          logInfo(`Fetched ${allPayments.length} testora payments so far (page ${requestCount}), fetching next...`);
        } else {
          break;
        }

        // Stop if we have enough
        if (allPayments.length >= limit) {
          break;
        }
      } catch (error) {
        if (error.message && (error.message.includes('PaginationLimitError') || error.message.includes('400'))) {
          logInfo(`⚠️ Pagination limit reached, stopping. Total fetched: ${allPayments.length} payments`);
          break;
        }
        if (allPayments.length === 0) {
          throw error;
        }
        logInfo(`⚠️ Error during pagination, but already have ${allPayments.length} payments. Stopping.`);
        break;
      }
    }

    logInfo(`✅ Fetched ${allPayments.length} testora payments from Primer API (${requestCount} pages, ${days} days)`, {
      count: allPayments.length,
      pages: requestCount,
      days
    });

    // Limit results
    return allPayments.slice(0, limit);
  } catch (error) {
    logError('Error fetching payments from Primer API', error);
    return [];
  }
}

/**
 * Get all payments from Primer API (with pagination)
 * @returns {Promise<Array>} Array of all payment objects
 */
export async function getAllPaymentsPrimer() {
  if (!PRIMER_API_KEY) {
    logInfo('Primer API not configured, skipping');
    return [];
  }

  try {
    logInfo('Fetching ALL payments from Primer API (this may take a while)...');
    
    const allPayments = [];
    let cursor = null;
    const endpoint = '/payments'; // Primer API endpoint for payments
    
    let requestCount = 0;
    const maxRequests = 1000; // Защита от бесконечного цикла
    
    while (requestCount < maxRequests) {
      requestCount++;
      
      const params = new URLSearchParams({
        limit: '100', // Maximum per request
        status: 'SETTLED,AUTHORIZED' // Only successful payments
      });
      
      if (cursor) {
        params.append('cursor', cursor);
      }
      
      try {
        const response = await primerApiRequest(`${endpoint}?${params.toString()}`);
        let payments = response.data || [];
        
        // ✅ КРИТИЧЕСКИ ВАЖНО: Фильтруем только payments для приложения "testora"
        const testoraPayments = payments.filter(payment => {
          const metadata = payment.metadata || {};
          const application = metadata.application || '';
          // Проверяем application в разных форматах
          const appLower = application.toLowerCase();
          return appLower === 'testora' || appLower === 'testora ' || appLower.includes('testora');
        });
        
        allPayments.push(...testoraPayments);
        
        // Логируем для отладки
        if (requestCount === 1) {
          logInfo(`First batch: total=${payments.length}, testora=${testoraPayments.length}, sample metadata:`, 
            payments[0]?.metadata || {});
        }
        
        // Check if there are more pages
        if (response.nextCursor && payments.length > 0) {
          cursor = response.nextCursor;
          logInfo(`Fetched ${allPayments.length} testora payments so far, fetching next page...`);
        } else {
          logInfo(`No more pages or empty response, stopping pagination. Total: ${allPayments.length} payments`);
          break; // No more pages
        }
      } catch (error) {
        // Если ошибка пагинации - останавливаемся и возвращаем что получили
        if (error.message && (error.message.includes('PaginationLimitError') || error.message.includes('400'))) {
          logInfo(`⚠️ Pagination limit reached or error, stopping. Total fetched: ${allPayments.length} payments`);
          // Возвращаем что получили, не бросаем ошибку
          break;
        }
        // Для других ошибок - пробрасываем дальше только если ничего не получили
        if (allPayments.length === 0) {
          throw error;
        } else {
          logInfo(`⚠️ Error during pagination, but already have ${allPayments.length} payments. Stopping.`);
          break;
        }
      }
    }
    
    logInfo('Successfully fetched payments from Primer API', { 
      count: allPayments.length 
    });
    
    // Возвращаем даже если была ошибка - главное что получили данные
    return allPayments;
  } catch (error) {
    logError('Error fetching all payments from Primer API', error);
    return [];
  }
}

/**
 * Get customer payments from Primer API (captures filtered by customer_id in metadata)
 * @param {string} customerId - Customer ID from metadata
 * @param {number} limit - Maximum number of payments
 * @returns {Promise<Array>} Array of payment objects
 */
export async function getCustomerPaymentsPrimer(customerId, limit = 100) {
  if (!PRIMER_API_KEY) {
    throw new Error('Primer API not configured');
  }

  try {
    logInfo('Fetching customer payments from Primer API (with pagination)', { customerId, limit });

    // Primer API не поддерживает фильтрацию по customer_id в query параметрах
    // Пагинируем через все страницы и фильтруем client-side
    const endpoint = '/payments';
    const allPayments = [];
    let cursor = null;
    let requestCount = 0;
    const maxRequests = 50; // Защита от бесконечного цикла

    while (requestCount < maxRequests) {
      requestCount++;

      const params = new URLSearchParams({
        limit: '100',
        status: 'SETTLED,AUTHORIZED'
      });

      if (cursor) {
        params.append('cursor', cursor);
      }

      try {
        const response = await primerApiRequest(`${endpoint}?${params.toString()}`);
        const payments = response.data || [];

        // Фильтруем по testora
        const testoraPayments = payments.filter(payment => {
          const metadata = payment.metadata || {};
          const application = metadata.application || '';
          return application.toLowerCase() === 'testora';
        });

        // Фильтруем по customerId
        const matchingPayments = testoraPayments.filter(payment => {
          const paymentCustomerId = payment.customerId || payment.metadata?.customer_id;
          return paymentCustomerId === customerId;
        });

        allPayments.push(...matchingPayments);

        // Check for more pages
        if (response.nextCursor && payments.length > 0) {
          cursor = response.nextCursor;
        } else {
          break;
        }

        // Если уже нашли достаточно, продолжаем дальше для полноты (нужны ВСЕ платежи клиента)
        // Но если нашли > limit, можно остановиться
        if (allPayments.length >= limit) {
          break;
        }
      } catch (error) {
        if (error.message && (error.message.includes('PaginationLimitError') || error.message.includes('400'))) {
          logInfo(`⚠️ Pagination limit reached for customer ${customerId}, returning ${allPayments.length} payments`);
          break;
        }
        if (allPayments.length > 0) {
          logInfo(`⚠️ Error during pagination for customer ${customerId}, returning ${allPayments.length} payments found so far`);
          break;
        }
        throw error;
      }
    }

    logInfo(`Successfully fetched customer payments from Primer API`, {
      customerId,
      count: allPayments.length,
      pages: requestCount
    });

    return allPayments.slice(0, limit);
  } catch (error) {
    logError('Error fetching customer payments from Primer API', error, { customerId });
    throw error;
  }
}

/**
 * Get customer information from Primer API
 * Since Primer stores customer_id in metadata, we create a customer object from payments
 * @param {string} customerId - Customer ID from metadata
 * @returns {Promise<Object>} Customer object
 */
export async function getCustomerPrimer(customerId) {
  if (!PRIMER_API_KEY) {
    throw new Error('Primer API not configured');
  }

  try {
    logInfo('Fetching customer from Primer API', { customerId });
    
    // Get customer payments to extract customer info
    const payments = await getCustomerPaymentsPrimer(customerId, 1);
    
    if (payments.length === 0) {
      // Return minimal customer object if no payments found
      return {
        id: customerId,
        email: null,
        metadata: {}
      };
    }
    
    // Получаем детальную информацию о payment чтобы получить customer.emailAddress
    // В списке payments нет полного customer объекта, нужно получить конкретный payment
    const firstPayment = payments[0];
    let paymentDetail = null;
    let email = null;
    
    // Пытаемся получить детальную информацию о payment через GET /payments/{paymentId}
    if (firstPayment.id) {
      try {
        paymentDetail = await primerApiRequest(`/payments/${firstPayment.id}`);
        // Extract email from multiple sources (Primer API stores it in different places)
        email = paymentDetail.customer?.emailAddress 
          || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
          || paymentDetail.paymentMethod?.paymentMethodData?.paypalBillingAgreementId // Fallback
          || null;
        
        // Extract GEO (country code) from order object
        const countryCode = paymentDetail.order?.countryCode 
          || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
          || null;
        
        logInfo('Fetched payment details for email and GEO extraction', { 
          paymentId: firstPayment.id, 
          emailFound: !!email,
          countryCode: countryCode || 'not found'
        });
      } catch (error) {
        // Если ошибка пагинации при получении детального payment, пробуем использовать данные из списка
        if (error.message && error.message.includes('PaginationLimitError')) {
          logInfo('Pagination limit error when fetching payment details, using data from list', { 
            paymentId: firstPayment.id 
          });
          // Используем данные из firstPayment если они есть
          email = firstPayment.customer?.emailAddress 
            || firstPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
            || email;
        } else {
          logInfo('Could not fetch payment details for email', { paymentId: firstPayment.id, error: error.message });
        }
      }
    }
    
    // Fallback: используем metadata из первого payment
    const metadata = (paymentDetail || firstPayment).metadata || {};
    
    // Если email не найден в детальном payment, пробуем другие источники
    if (!email) {
      email = metadata.email 
        || firstPayment.email 
        || null;
    }
    
    // Extract GEO from payment detail or metadata
    let countryCode = null;
    if (paymentDetail) {
      countryCode = paymentDetail.order?.countryCode 
        || paymentDetail.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
        || null;
    }
    
    // Fallback to metadata
    if (!countryCode) {
      countryCode = metadata.geo_country 
        || metadata.country_code
        || null;
    }
    
    // Create customer object from payment metadata with GEO
    const customer = {
      id: customerId,
      email: email,
      address: countryCode ? { country: countryCode } : null,
      country: countryCode, // ✅ Сохраняем country code напрямую
      metadata: {
        ...metadata,
        customer_id: customerId,
        purchase_id: metadata.purchase_id || null,
        subscription_id: metadata.subscription_id || null,
        email: email, // Сохраняем email в metadata тоже
        geo_country: countryCode || metadata.geo_country || null,
        country_code: countryCode || metadata.country_code || null
      }
    };
    
    logInfo('Customer object created with email and GEO', { 
      customerId, 
      email: email || 'not found',
      countryCode: countryCode || 'not found'
    });
    
    logInfo('Successfully fetched customer from Primer API', { customerId });
    
    return customer;
  } catch (error) {
    logError('Error fetching customer from Primer API', error, { customerId });
    // Return minimal customer object on error to allow processing to continue
    return {
      id: customerId,
      email: null,
      metadata: {}
    };
  }
}

/**
 * Normalize Primer payment to Stripe-like format for compatibility
 * Based on Primer API v2.4 structure from documentation:
 * https://primer.io/docs/api-reference/v2.4/api-reference/payments-api/search-&-list-payments
 * 
 * Primer API Payment structure:
 * - id: "IHQlakKC"
 * - date: "2021-03-24T14:56:56.869248"
 * - status: "SETTLED", "AUTHORIZED", "SETTLING", "PARTIALLY_SETTLED", etc.
 * - amount: 700 (in smallest currency unit, e.g. cents)
 * - currencyCode: "EUR"
 * - metadata: { customer_id, purchase_id, subscription_id, UTM params, application: "testora", etc. }
 * @param {Object} primerPayment - Payment object from Primer API
 * @returns {Object} Normalized payment object
 */
export function normalizePrimerPayment(primerPayment) {
  // Extract metadata (contains all UTM and customer data)
  const metadata = primerPayment.metadata || {};
  
  // Extract customer ID - Primer API может хранить в customerId или metadata.customer_id
  const customerId = primerPayment.customerId || metadata.customer_id || primerPayment.customer?.id || null;
  
  // Extract amount - Primer API stores amount in smallest currency unit (cents for USD)
  // From docs: amount: 700 (integer, in cents)
  let amount = 0;
  if (primerPayment.amount !== undefined && primerPayment.amount !== null) {
    amount = typeof primerPayment.amount === 'number' 
      ? Math.round(primerPayment.amount)
      : parseInt(primerPayment.amount) || 0;
  }
  
  // Extract currency - Primer uses currencyCode field
  const currency = (primerPayment.currencyCode || primerPayment.currency || metadata.currency || 'USD').toLowerCase();
  
  // Extract status - Primer uses: SETTLED, AUTHORIZED, SETTLING, PARTIALLY_SETTLED, FAILED, CANCELLED, etc.
  const status = mapPrimerStatus(primerPayment.status || '');
  
  // Extract created timestamp - Primer uses "date" field
  const createdAt = primerPayment.date || primerPayment.createdAt || primerPayment.created_at || new Date().toISOString();
  const created = Math.floor(new Date(createdAt).getTime() / 1000);
  
  // Extract email - Primer API stores it in multiple places
  // Priority: customer.emailAddress > paymentMethod.externalPayerInfo.email > metadata.email
  const email = primerPayment.customer?.emailAddress 
    || primerPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.email
    || metadata.email 
    || primerPayment.email 
    || null;
  
  // Extract GEO (country code) from order object or metadata
  const countryCode = primerPayment.order?.countryCode 
    || primerPayment.paymentMethod?.paymentMethodData?.externalPayerInfo?.countryCode
    || metadata.geo_country 
    || metadata.country_code
    || null;
  
  // Extract description from metadata
  const description = metadata.description || primerPayment.description || '';
  
  // Payment method type (from processor or metadata)
  const paymentMethod = primerPayment.paymentMethodType || primerPayment.processor?.name?.toLowerCase() || metadata.payment_method || 'paypal';
  
  // Extract order ID
  const orderId = primerPayment.orderId || metadata.order_id || null;
  
  return {
    id: primerPayment.id || `primer_${metadata.purchase_id || Date.now()}`,
    amount: amount, // Amount in cents
    currency: currency,
    status: status,
    customer: customerId,
    created: created,
    metadata: {
      ...metadata,
      // Ensure all UTM fields are in metadata
      utm_source: metadata.utm_source || null,
      utm_medium: metadata.utm_medium || null,
      utm_campaign: metadata.utm_campaign || null,
      utm_content: metadata.utm_content || null,
      utm_term: metadata.utm_term || null,
      // Ad data (from Primer metadata: utm_ad_name, utm_adset_name)
      ad_name: metadata.utm_ad_name || null,
      adset_name: metadata.utm_adset_name || null,
      campaign_name: metadata.utm_campaign_name || metadata.utm_campaign || null,
      // Customer data (from Primer metadata)
      customer_id: customerId,
      purchase_id: metadata.purchase_id || null,
      subscription_id: metadata.subscription_id || null,
      order_id: orderId,
      // GEO data
      geo_country: countryCode || metadata.geo_country || null,
      country_code: countryCode || metadata.country_code || null,
      email: email || null,
      // Additional Primer metadata fields
      application: metadata.application || null,
      browser: metadata.browser || null,
      os: metadata.os || null,
      os_version: metadata.os_version || null
    },
    payment_method: paymentMethod,
    description: description,
    email: email,
    country: countryCode, // ✅ Сохраняем country code напрямую в payment объекте
    // Additional Primer-specific fields
    _primer: true,
    _source: 'primer',
    _original: primerPayment // ✅ Сохраняем оригинальный объект для доступа к полным данным
  };
}

/**
 * Map Primer payment status to Stripe-like status
 * Based on Primer API v2.4 statuses from documentation:
 * https://primer.io/docs/api-reference/v2.4/api-reference/payments-api/search-&-list-payments
 * 
 * Primer statuses: SETTLED, AUTHORIZED, SETTLING, PARTIALLY_SETTLED, FAILED, CANCELLED, etc.
 * @param {string} primerStatus - Status from Primer API
 * @returns {string} Stripe-like status
 */
function mapPrimerStatus(primerStatus) {
  if (!primerStatus) return 'unknown';
  
  // Normalize status string (handle spaces, case variations)
  const statusUpper = primerStatus.toString().trim().toUpperCase();
  
  const statusMap = {
    'SETTLED': 'succeeded',           // Payment settled
    'AUTHORIZED': 'succeeded',         // Payment authorized
    'SETTLING': 'processing',         // Payment settling
    'PARTIALLY_SETTLED': 'succeeded',  // Payment partially settled
    'PENDING': 'processing',      // Payment pending
    'PROCESSING': 'processing',   // Payment processing
    'FAILED': 'failed',           // Payment failed
    'CANCELLED': 'canceled',      // Payment cancelled
    'CANCELED': 'canceled',       // Payment canceled (US spelling)
    'REFUNDED': 'refunded',       // Payment refunded
    'REVERSED': 'reversed',       // Payment reversed
    'DECLINED': 'failed'          // Payment declined
  };
  
  return statusMap[statusUpper] || 'unknown';
}

/**
 * Check if Primer API is configured
 * @returns {boolean}
 */
export function isPrimerConfigured() {
  return !!PRIMER_API_KEY;
}
