import express from 'express';
import Stripe from 'stripe';
import { ENV } from '../lib/env.js';

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
const router = express.Router();

// Функция для извлечения UTM меток из URL
function extractUtmParams(url) {
  const urlObj = new URL(url);
  const params = urlObj.searchParams;
  
  return {
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
    ad_name: params.get('ad_name') || '',
    adset_name: params.get('adset_name') || '',
    campaign_name: params.get('campaign_name') || '',
    campaign_id: params.get('campaign_id') || '',
    adset_id: params.get('adset_id') || '',
    ad_id: params.get('ad_id') || '',
    publisher_site_id: params.get('publisher_site_id') || '',
    fbclid: params.get('fbclid') || '',
    gclid: params.get('gclid') || '',
    // Дополнительные параметры
    gender: params.get('gender') || '',
    age: params.get('age') || '',
    product_tag: params.get('product_tag') || '',
    creative_link: params.get('creative_link') || '',
    platform_placement: params.get('platform_placement') || ''
  };
}

// Создание checkout session с UTM метками
router.post('/create-checkout', async (req, res) => {
  try {
    const { 
      price_data, 
      quantity = 1, 
      success_url, 
      cancel_url,
      referrer_url // URL откуда пришел пользователь с UTM метками
    } = req.body;

    // Извлекаем UTM метки из referrer_url
    const utmParams = referrer_url ? extractUtmParams(referrer_url) : {};

    // Создаем checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: price_data.currency || 'usd',
          product_data: {
            name: price_data.product_name || 'Product',
          },
          unit_amount: price_data.unit_amount || 100,
        },
        quantity: quantity,
      }],
      mode: 'payment',
      success_url: success_url || `${process.env.BASE_URL || 'https://stripe-ops.onrender.com'}/success`,
      cancel_url: cancel_url || `${process.env.BASE_URL || 'https://stripe-ops.onrender.com'}/cancel`,
      metadata: {
        // UTM метки
        utm_source: utmParams.utm_source,
        utm_medium: utmParams.utm_medium,
        utm_campaign: utmParams.utm_campaign,
        utm_content: utmParams.utm_content,
        utm_term: utmParams.utm_term,
        ad_name: utmParams.ad_name,
        adset_name: utmParams.adset_name,
        campaign_name: utmParams.campaign_name,
        campaign_id: utmParams.campaign_id,
        adset_id: utmParams.adset_id,
        ad_id: utmParams.ad_id,
        publisher_site_id: utmParams.publisher_site_id,
        fbclid: utmParams.fbclid,
        gclid: utmParams.gclid,
        // Дополнительные параметры
        gender: utmParams.gender,
        age: utmParams.age,
        product_tag: utmParams.product_tag,
        creative_link: utmParams.creative_link,
        platform_placement: utmParams.platform_placement,
        // Технические параметры
        source: 'api',
        created_at: new Date().toISOString()
      }
    });

    res.json({ 
      id: session.id,
      url: session.url,
      metadata: session.metadata
    });

  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
