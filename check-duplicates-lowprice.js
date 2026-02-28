// Скрипт для проверки дубликатов в LowPrice листе
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const { ENV } = await import('./src/config/env.js');
const { googleSheets } = await import('./src/services/googleSheets.js');

async function checkDuplicates() {
  console.log('🔍 Проверяем дубликаты в LowPrice листе...\n');

  try {
    const LOW_PRICE_SHEET_NAME = ENV.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
    
    await googleSheets.initialize();
    const lowPriceSheet = await googleSheets.getSheetByName(LOW_PRICE_SHEET_NAME);
    await lowPriceSheet.loadHeaderRow();

    const allRows = await lowPriceSheet.getRows();
    console.log(`📋 Найдено ${allRows.length} записей в листе "${LOW_PRICE_SHEET_NAME}"\n`);

    // Группируем строки по Customer ID
    const customerGroups = new Map();
    for (const row of allRows) {
      const customerId = row.get('Customer ID');
      if (!customerId || customerId === 'N/A') continue;
      
      if (!customerGroups.has(customerId)) {
        customerGroups.set(customerId, []);
      }
      customerGroups.get(customerId).push(row);
    }

    // Находим дубликаты
    const duplicates = [];
    for (const [customerId, rows] of customerGroups.entries()) {
      if (rows.length > 1) {
        duplicates.push({
          customerId,
          count: rows.length,
          rows: rows.map(row => ({
            rowNumber: row.rowNumber,
            email: row.get('Email'),
            totalAmount: row.get('Total Amount'),
            paymentIds: row.get('Payment Intent IDs'),
            created: row.get('Created UTC')
          }))
        });
      }
    }

    if (duplicates.length === 0) {
      console.log('✅ Дубликатов не найдено!\n');
      return;
    }

    console.log(`⚠️ Найдено ${duplicates.length} клиентов с дубликатами:\n`);
    
    for (const dup of duplicates) {
      console.log(`\n👤 Customer ID: ${dup.customerId}`);
      console.log(`   Количество дубликатов: ${dup.count}`);
      console.log(`   Строки:`);
      for (const row of dup.rows) {
        console.log(`      Строка ${row.rowNumber}: Email=${row.email}, Amount=$${row.totalAmount}, Payments=${row.paymentIds?.split(',').length || 0}`);
      }
    }

    console.log(`\n📊 Итого: ${duplicates.length} клиентов с дубликатами, ${duplicates.reduce((sum, d) => sum + d.count - 1, 0)} лишних строк`);
    console.log(`\n💡 Для удаления дубликатов запустите: ./node-v20.11.0-darwin-x64/bin/node merge-duplicate-customers-lowprice.js`);

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkDuplicates();





