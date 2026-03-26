#!/usr/bin/env node
/**
 * Fix duplicates in Primer sheet.
 *
 * What it does:
 * - Dedup by Customer ID: keep the oldest row by "Created UTC", delete the rest.
 * - Optional extra pass by Email (conservative): if multiple rows share the same Email,
 *   we only delete when:
 *     - Customer ID is the same, OR
 *     - one of the rows has missing/invalid Customer ID ("N/A"/empty).
 *
 * Notes:
 * - Uses Google Sheets API via google-spreadsheet (same auth as other scripts).
 * - Deletes from bottom to top (descending rowNumber) to avoid shifting issues.
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '.env') });

function normalizeCustomerId(v) {
  const s = (v ?? '').toString().trim();
  if (!s || s.toUpperCase() === 'N/A') return null;
  return s;
}

function normalizeEmail(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  if (!s || s === 'n/a') return null;
  return s;
}

function parseCreatedUtc(v) {
  const s = (v ?? '').toString().trim();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

async function loadPrimerRows() {
  const { googleSheets } = await import('./src/services/googleSheets.js');
  const { ENV } = await import('./src/config/env.js');
  const SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';

  await googleSheets.initialize();
  const sheet = await googleSheets.getSheetByName(SHEET_NAME);
  try {
    await sheet.loadHeaderRow();
  } catch {
    // ignore
  }
  const rows = await sheet.getRows();
  return { sheet, rows, SHEET_NAME };
}

function chooseKeepRow(rows) {
  // Keep the oldest by Created UTC; tie-breaker: smallest rowNumber.
  return [...rows].sort((a, b) => {
    const ta = parseCreatedUtc(a.get('Created UTC'));
    const tb = parseCreatedUtc(b.get('Created UTC'));
    if (ta !== tb) return ta - tb;
    return (a.rowNumber ?? 0) - (b.rowNumber ?? 0);
  })[0];
}

async function deleteRows(rowsToDelete, fetchWithRetry) {
  // Delete from bottom to top for safety.
  const sorted = [...rowsToDelete].sort((a, b) => (b.rowNumber ?? 0) - (a.rowNumber ?? 0));
  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const row of sorted) {
    try {
      await fetchWithRetry(() => row.delete());
      deleted++;
      if (deleted % 25 === 0) {
        console.log(`🧹 Deleted ${deleted}/${sorted.length}...`);
      }
      await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      failed++;
      const msg = e?.message || String(e);
      errors.push({ rowNumber: row.rowNumber, error: msg });
      if (failed === 1) {
        console.log(`❌ First delete error (row ${row.rowNumber}): ${msg}`);
      }
    }
  }

  return { deleted, failed, errors };
}

async function main() {
  const { distributedLock } = await import('./src/services/distributedLock.js');
  const { clearSheetsCache } = await import('./src/utils/cache.js');
  const { logger } = await import('./src/utils/logging.js');
  const { fetchWithRetry } = await import('./src/utils/retry.js');

  // Determine sheet name after dotenv is loaded
  const { ENV } = await import('./src/config/env.js');
  const SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';

  const lockKey = `fix_duplicates_${SHEET_NAME}`;
  const lockId = await distributedLock.acquire(lockKey, 100, 200);
  try {
    logger.info(`🧹 Fixing duplicates in sheet "${SHEET_NAME}"...`);

    // Make sure we don't use stale cached rows during this run.
    clearSheetsCache();

    const { rows } = await loadPrimerRows();
    logger.info(`📋 Loaded ${rows.length} rows from Primer sheet`);

    // Pass 1: dedup by Customer ID
    const byCustomer = new Map();
    for (const row of rows) {
      const customerId = normalizeCustomerId(row.get('Customer ID'));
      if (!customerId) continue;
      if (!byCustomer.has(customerId)) byCustomer.set(customerId, []);
      byCustomer.get(customerId).push(row);
    }

    const customerDeletes = [];
    for (const [customerId, group] of byCustomer.entries()) {
      if (group.length <= 1) continue;
      const keep = chooseKeepRow(group);
      const del = group.filter(r => r.rowNumber !== keep.rowNumber);
      if (del.length > 0) {
        logger.info(`🧾 Customer duplicate: ${customerId} keep row ${keep.rowNumber}, delete ${del.length}`);
        customerDeletes.push(...del);
      }
    }

    // Pass 2: conservative dedup by Email
    const byEmail = new Map();
    for (const row of rows) {
      const email = normalizeEmail(row.get('Email'));
      if (!email) continue;
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(row);
    }

    const emailDeletes = [];
    for (const [email, group] of byEmail.entries()) {
      if (group.length <= 1) continue;

      // If different valid customerIds exist, skip (could be real different customers).
      const customerIds = new Set(group.map(r => normalizeCustomerId(r.get('Customer ID'))).filter(Boolean));
      const hasMultipleValidCustomers = customerIds.size > 1;
      if (hasMultipleValidCustomers) {
        logger.warn(`⚠️ Email shared across multiple customers, skipping email-dedup: ${email}`, {
          customers: [...customerIds].slice(0, 10)
        });
        continue;
      }

      // Otherwise we can dedup by email: keep oldest, delete rest.
      const keep = chooseKeepRow(group);
      const del = group.filter(r => r.rowNumber !== keep.rowNumber);
      if (del.length > 0) {
        logger.info(`📧 Email duplicate: ${email} keep row ${keep.rowNumber}, delete ${del.length}`);
        emailDeletes.push(...del);
      }
    }

    // Merge deletes (rowNumber unique)
    const toDeleteByRowNumber = new Map();
    for (const r of [...customerDeletes, ...emailDeletes]) {
      if (r?.rowNumber) toDeleteByRowNumber.set(r.rowNumber, r);
    }
    const toDelete = [...toDeleteByRowNumber.values()];

    if (toDelete.length === 0) {
      logger.info('✅ No duplicates found to delete');
      return;
    }

    logger.info(`🗑️ Deleting ${toDelete.length} duplicate rows...`);
    const result = await deleteRows(toDelete, fetchWithRetry);

    // Clear cache again so next operations read fresh data.
    clearSheetsCache();

    console.log(`✅ Primer dedup finished. Attempted=${toDelete.length}, Deleted=${result.deleted}, Failed=${result.failed}`);
    if (result.errors.length > 0) {
      console.log('⚠️ First 10 delete errors:');
      for (const e of result.errors.slice(0, 10)) {
        console.log(`   - Row ${e.rowNumber}: ${e.error}`);
      }
    }
  } finally {
    distributedLock.release(lockKey, lockId);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Dedup script failed:', e?.message || e);
    process.exit(1);
  });

