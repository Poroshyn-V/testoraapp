# 📊 Настройка Google Sheets API

## Пошаговая инструкция

### 1. Создание проекта в Google Cloud Console
1. Перейдите на [console.cloud.google.com](https://console.cloud.google.com)
2. Создайте новый проект или выберите существующий
3. Включите Google Sheets API

### 2. Создание Service Account
1. В Google Cloud Console → IAM & Admin → Service Accounts
2. Нажмите "Create Service Account"
3. Заполните:
   - **Name**: `stripe-ops-service`
   - **Description**: `Service account for Stripe webhook integration`
4. Нажмите "Create and Continue"
5. Роль: "Editor" (или создайте кастомную роль)
6. Нажмите "Done"

### 3. Создание ключа
1. Найдите созданный Service Account
2. Нажмите на него → "Keys" → "Add Key" → "Create new key"
3. Выберите "JSON" формат
4. Скачайте файл (сохраните в безопасном месте!)

### 4. Создание Google Spreadsheet
1. Перейдите на [sheets.google.com](https://sheets.google.com)
2. Создайте новый документ
3. Назовите его "Stripe Payments"
4. Скопируйте ID документа из URL:
   ```
   https://docs.google.com/spreadsheets/d/1ABC123.../edit
   ID: 1ABC123...
   ```

### 5. Предоставление доступа
1. Откройте скачанный JSON файл
2. Скопируйте `client_email` (например: `stripe-ops@project.iam.gserviceaccount.com`)
3. В Google Sheets → "Share" → "Add people"
4. Вставьте email и дайте права "Editor"
5. Нажмите "Send"

### 6. Настройка переменных окружения
Добавьте в Render Dashboard:

```
GOOGLE_SHEETS_DOC_ID=1ABC123... # ID из URL документа
GOOGLE_SERVICE_EMAIL=stripe-ops@project.iam.gserviceaccount.com
GOOGLE_SERVICE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

**Важно:** 
- Скопируйте весь private_key из JSON файла
- Замените `\n` на реальные переносы строк
- Или используйте `\\n` в переменных окружения

### 7. Активация Google Sheets в коде
После настройки переменных окружения:

1. Откройте `src/lib/sheets.ts`
2. Раскомментируйте код в функции `appendPaymentRow`
3. Раскомментируйте импорт и функции в начале файла
4. Перезапустите приложение

### 8. Тестирование
1. Создайте тестовый платеж в Stripe
2. Проверьте, что данные появились в Google Sheets
3. Проверьте логи в Render Dashboard

## 🔧 Структура таблицы

Таблица будет содержать следующие колонки:
- `created_at` - время создания платежа
- `session_id` - ID сессии Stripe
- `payment_status` - статус платежа
- `amount` - сумма
- `currency` - валюта
- `email` - email клиента
- `country` - страна
- `gender`, `age` - демографические данные
- `product_tag` - тег продукта
- `creative_link` - ссылка на креатив
- `utm_*` - UTM параметры
- `platform_placement` - размещение
- `ad_name`, `adset_name`, `campaign_name` - данные рекламы
- `raw_metadata_json` - полные метаданные

## 🆘 Решение проблем

### Ошибка "Permission denied"
- Проверьте, что Service Account имеет доступ к таблице
- Убедитесь, что email правильный

### Ошибка "Invalid credentials"
- Проверьте формат private_key
- Убедитесь, что ключ не поврежден

### Таблица не создается
- Проверьте права Service Account
- Убедитесь, что GOOGLE_SHEETS_DOC_ID правильный
