// Скрипт для добавления формулы LA времени в колонку G (только для листа LowPrice)
import { config } from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

config();

const GOOGLE_SHEETS_DOC_ID = process.env.GOOGLE_SHEETS_DOC_ID;
const LOW_PRICE_SHEET_NAME = process.env.STRIPE_LOW_PRICE_SHEET_NAME || 'LowPrice';
const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const GOOGLE_SERVICE_PRIVATE_KEY = (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

async function addLaTimeFormula() {
  console.log(`🔄 Добавляем формулу LA времени в колонку G листа "${LOW_PRICE_SHEET_NAME}"...\n`);

  try {
    // Подключаемся к Google Sheets
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_EMAIL,
      key: GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    // Работаем только с листом LowPrice
    const sheet = doc.sheetsByTitle[LOW_PRICE_SHEET_NAME];
    if (!sheet) {
      throw new Error(`Лист "${LOW_PRICE_SHEET_NAME}" не найден!`);
    }
    await sheet.loadHeaderRow();
    
    // Находим колонку "Created UTC"
    const utcColumnIndex = sheet.headerValues.indexOf('Created UTC');
    if (utcColumnIndex === -1) {
      throw new Error('Колонка "Created UTC" не найдена!');
    }
    
    // Определяем колонку G (индекс 6, так как A=0, B=1, C=2, D=3, E=4, F=5, G=6)
    const columnGIndex = 6;
    const columnGLetter = 'G';
    
    console.log(`📋 Колонка "Created UTC" находится в колонке ${String.fromCharCode(65 + utcColumnIndex)} (индекс ${utcColumnIndex})`);
    console.log(`📋 Будем добавлять формулу в колонку ${columnGLetter} (индекс ${columnGIndex})\n`);
    
    // Получаем количество строк с данными
    const rows = await sheet.getRows();
    const totalRows = rows.length;
    
    console.log(`📊 Найдено ${totalRows} строк с данными\n`);
    
    if (totalRows === 0) {
      console.log('⚠️ Нет данных для обработки');
      return;
    }
    
    // Найдем букву колонки с UTC временем
    const utcColumnLetter = String.fromCharCode(65 + utcColumnIndex);
    
    // Формула для конвертации UTC в LA время (Pacific Time, UTC-8)
    // Используем простую формулу: вычитаем 8 часов из UTC времени
    // Формат UTC: 2025-11-03T17:51:17.000Z
    const workingFormula = `=IF(${utcColumnLetter}2="","",TEXT(DATEVALUE(LEFT(${utcColumnLetter}2,10))+TIMEVALUE(MID(${utcColumnLetter}2,12,8))-TIME(8,0,0),"YYYY-MM-DD HH:MM:SS.000")&" LA Time")`;
    
    console.log(`📝 Добавляем формулу в колонку ${columnGLetter} листа "${LOW_PRICE_SHEET_NAME}"...\n`);
    console.log(`   Колонка UTC: ${utcColumnLetter}`);
    console.log(`   Формула: ${workingFormula.replace('2', '2')}\n`);
    
    // Добавляем формулу в первую строку (после заголовков)
    // Используем Google Sheets API для добавления формулы
    const { google } = await import('googleapis');
    const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
    
    // Создаем массив формул для всех строк
    const formulas = [];
    for (let i = 2; i <= totalRows + 1; i++) { // Строка 2 - первая строка данных (строка 1 - заголовок)
      formulas.push([workingFormula.replace('2', i.toString())]);
    }
    
    // Обновляем колонку G формулами
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_DOC_ID,
      range: `${columnGLetter}2:${columnGLetter}${totalRows + 1}`,
      valueInputOption: 'USER_ENTERED', // Важно использовать USER_ENTERED для формул
      requestBody: {
        values: formulas
      }
    });
    
    console.log(`✅ Формула успешно добавлена в колонку ${columnGLetter} для ${totalRows} строк!\n`);
    console.log('✅ Проверьте таблицу - в колонке G должно появиться LA время\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error);
    process.exit(1);
  }
}

addLaTimeFormula();

