import crypto from 'crypto';
import { ENV } from '../config/env.js';

export function requireAdminKey(req, res, next) {
  if (!ENV.ADMIN_API_KEY) {
    return next();
  }

  const providedKey = req.get('x-api-key') || req.query.api_key;

  if (!providedKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  // Timing-safe comparison to protect against timing attacks
  const expected = Buffer.from(ENV.ADMIN_API_KEY);
  const provided = Buffer.from(providedKey);

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  return next();
}
