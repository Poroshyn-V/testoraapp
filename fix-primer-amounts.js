#!/usr/bin/env node
/**
 * Скрипт для исправления неправильных сумм в Primer листе
 * Исправляет суммы которые показываются как 999 вместо 9.99
 */

import dotenv from 'dotenv';
dotenv.config();

if (!process.env.GOOGLE_SERVICE_EMAIL || !process.env.GOOGLE_SERVICE_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_DOC_ID) {
  console.error('❌ Ошибка: Google Sheets не настроен!');
  process.exit(1);
}

async function fixPrimerAmounts() {
  const { ENV } = await import('./src/config/env.js');
  const { logger } = await import('./src/utils/logging.js');
  const googleSheetsModule = await import('./src/services/googleSheets.js');
  const googleSheets = googleSheetsModule.default;
  
  try {
    logger.info('🔧 Начинаю исправление сумм в Primer листе...');
    
    const PRIMER_SHEET_NAME = ENV.PRIMER_SHEET_NAME || 'Primer';
    const primerSheet = await googleSheets.getSheetByName(PRIMER_SHEET_NAME);
    await primerSheet.loadHeaderRow();
    
    const rows = await primerSheet.getRows();
    logger.info(`📋 Найдено ${rows.length} строк в листе Primer`);
    
    let fixed = 0;
    let skipped = 0;
    
    for (const row of rows) {
      try {
        const currentAmount = row.get('Total Amount');
        const currency = row.get('Currency') || 'USD';
        
        // Пропускаем если сумма уже правильная (содержит точку или запятую)
        if (!currentAmount || currentAmount === 'N/A' || currentAmount.includes('.') || currentAmount.includes(',')) {
          skipped++;
          continue;
        }
        
        // Пытаемся распарсить как число
        const amountNum = parseFloat(currentAmount);
        if (isNaN(amountNum)) {
          skipped++;
          continue;
        }
        
        // Если сумма > 100, скорее всего это центы (999 = $9.99)
        // Если сумма < 100, возможно это уже доллары, но проверим
        // Обычно Primer суммы в центах, так что если > 10, точно центы
        if (amountNum >= 10) {
          const correctAmount = (amountNum / 100).toFixed(2);
          row.set('Total Amount', correctAmount);
          await row.save();
          fixed++;
          logger.info(`✅ Исправлено: ${currentAmount} → ${correctAmount} ${currency}`);
        } else {
          skipped++;
        }
        
        // Небольшая задержка
        await new Promise(resolve => setTimeout(resolve, 200));
        
        if (fixed % 10 === 0) {
          logger.info(`📊 Исправлено ${fixed} записей...`);
        }
        
      } catch (error) {
        logger.error(`❌ Ошибка при обработке строки ${row.rowNumber}:`, error);
      }
    }
    
    logger.info('✅ Исправление завершено!', { fixed, skipped, total: rows.length });
    
    console.log('\n📊 Результаты исправления:');
    console.log(`   Всего строк: ${rows.length}`);
    console.log(`   Исправлено: ${fixed}`);
    console.log(`   Пропущено: ${skipped}`);
    
  } catch (error) {
    logger.error('❌ Критическая ошибка при исправлении', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

fixPrimerAmounts()
  .then(() => {
    console.log('✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Скрипт завершился с ошибкой', error);
    process.exit(1);
  });

