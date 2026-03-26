import pg from 'pg';
import { logger } from '../utils/logging.js';

const { Pool } = pg;

let pool = null;
let initPromise = null;

function getDatabaseUrl() {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || null;
}

async function init() {
  const url = getDatabaseUrl();
  if (!url) return { enabled: false };

  if (!pool) {
    pool = new Pool({
      connectionString: url,
      // Railway internal Postgres обычно требует SSL только для внешних коннектов.
      // Если SSL нужен, Postgres сам вернет ошибку — добавим позже при необходимости.
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000
    });
  }

  // One-time schema init.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS primer_webhook_processed (
      payment_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  return { enabled: true };
}

async function ensureInit() {
  if (!initPromise) {
    initPromise = init().catch((e) => {
      // If init fails, keep idempotency disabled (better to accept webhook than hard-fail).
      logger.error({ err: e }, 'Primer idempotency store init failed');
      return { enabled: false };
    });
  }
  return initPromise;
}

/**
 * Atomically marks payment as processed.
 * @returns {Promise<{enabled: boolean, inserted: boolean}>}
 */
export async function markPrimerPaymentOnce(paymentId) {
  const url = getDatabaseUrl();
  if (!url || !paymentId) return { enabled: false, inserted: false };

  const { enabled } = await ensureInit();
  if (!enabled) return { enabled: false, inserted: false };

  try {
    const res = await pool.query(
      `INSERT INTO primer_webhook_processed(payment_id) VALUES ($1) ON CONFLICT DO NOTHING;`,
      [paymentId]
    );
    return { enabled: true, inserted: res.rowCount === 1 };
  } catch (e) {
    logger.error({ err: e, paymentId }, 'Primer idempotency store insert failed');
    // Fail open: treat as not inserted to allow processing.
    return { enabled: true, inserted: true };
  }
}

