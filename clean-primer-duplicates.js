/**
 * Primer Sheet Duplicate Cleaner
 *
 * Finds and removes duplicate rows from the Primer Google Sheet.
 * A duplicate is defined as: same Customer ID appearing more than once.
 * Keeps the FIRST row (oldest/first entry), deletes all subsequent ones.
 *
 * Run: node clean-primer-duplicates.js
 * Add --dry-run to preview without deleting.
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const SHEET_NAME = process.env.PRIMER_SHEET_NAME || 'Primer';

const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_EMAIL,
  key: process.env.GOOGLE_SERVICE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_DOC_ID, auth);

async function main() {
  console.log(`🔍 Primer Duplicate Cleaner${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`📋 Sheet: ${SHEET_NAME}\n`);

  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[SHEET_NAME];

  if (!sheet) {
    console.error(`❌ Sheet "${SHEET_NAME}" not found`);
    process.exit(1);
  }

  await sheet.loadHeaderRow();
  console.log('⏳ Loading rows...');
  const rows = await sheet.getRows();
  console.log(`✅ Loaded ${rows.length} rows\n`);

  // Group rows by Customer ID
  const customerMap = new Map(); // customerId -> [row, ...]
  const noCustomerRows = [];

  for (const row of rows) {
    const customerId = row.get('Customer ID') || '';
    if (!customerId || customerId === 'N/A') {
      noCustomerRows.push(row);
      continue;
    }
    if (!customerMap.has(customerId)) {
      customerMap.set(customerId, []);
    }
    customerMap.get(customerId).push(row);
  }

  // Find duplicates
  const duplicateGroups = Array.from(customerMap.entries())
    .filter(([, rows]) => rows.length > 1);

  console.log(`📊 Stats:`);
  console.log(`   Total rows: ${rows.length}`);
  console.log(`   Unique customers: ${customerMap.size}`);
  console.log(`   Customers with duplicates: ${duplicateGroups.length}`);
  console.log(`   Rows without Customer ID: ${noCustomerRows.length}\n`);

  if (duplicateGroups.length === 0) {
    console.log('✅ No duplicates found!');
    process.exit(0);
  }

  // Show what will be deleted
  let totalToDelete = 0;
  for (const [customerId, dupeRows] of duplicateGroups) {
    const keep = dupeRows[0];
    const toDelete = dupeRows.slice(1);
    totalToDelete += toDelete.length;

    console.log(`🔁 Customer: ${customerId}`);
    console.log(`   Keep row #${keep.rowNumber}: ${keep.get('Email') || 'no email'} | ${keep.get('Created UTC') || 'no date'}`);
    for (const d of toDelete) {
      console.log(`   ❌ Delete row #${d.rowNumber}: ${d.get('Email') || 'no email'} | ${d.get('Created UTC') || 'no date'}`);
    }
  }

  console.log(`\n📋 Total rows to delete: ${totalToDelete}`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — nothing deleted. Run without --dry-run to apply.');
    process.exit(0);
  }

  console.log('\n⏳ Deleting duplicates (in reverse order to preserve row numbers)...');

  // Collect all rows to delete and sort by rowNumber descending
  // (delete from bottom to top so row numbers don't shift)
  const rowsToDelete = [];
  for (const [, dupeRows] of duplicateGroups) {
    rowsToDelete.push(...dupeRows.slice(1));
  }
  rowsToDelete.sort((a, b) => b.rowNumber - a.rowNumber);

  let deleted = 0;
  for (const row of rowsToDelete) {
    try {
      await row.delete();
      deleted++;
      console.log(`   ✅ Deleted row #${row.rowNumber} (${row.get('Customer ID')})`);
      // Small delay to avoid Sheets rate limits
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`   ❌ Failed to delete row #${row.rowNumber}: ${err.message}`);
    }
  }

  console.log(`\n✅ Done! Deleted ${deleted} duplicate rows.`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
