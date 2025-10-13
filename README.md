# stripe-ops (Stripe → Telegram + Google Sheets)

🤖 **Автоматическая система синхронизации Stripe с Telegram и Google Sheets**

Realtime уведомления об оплатах из Stripe в Telegram и Slack, запись полной информации в Google Sheets с автоматическими отчетами и аналитикой.

## 🚀 Что делает система

### 📱 Уведомления
- **Telegram & Slack** уведомления о новых покупках в структурированном формате
- **Группировка покупок** - все платежи клиента объединяются в одно уведомление
- **Автоматические алерты** по расписанию

### 📊 Google Sheets интеграция
- **Автоматическая запись** всех покупок в Google Sheets
- **Группировка по клиентам** - 1 клиент = 1 запись со всеми его покупками
- **Обновление данных** - апсейлы автоматически добавляются к существующим записям
- **Защита от дубликатов** - система предотвращает повторные записи

### 📈 Автоматические отчеты
- **GEO алерты** - каждый час ТОП-3 страны за сегодня
- **Daily Stats** - каждое утро в 7:00 UTC+1 статистика за вчера
- **Creative алерты** - в 10:00 и 22:00 UTC+1 ТОП-5 креативов за сегодня
- **Weekly отчеты** - каждый понедельник в 9:00 UTC+1 полный отчет за прошлую неделю
- **Anomaly Check** - мониторинг аномалий в продажах

### 🔄 Автоматическая синхронизация
- **Проверка Stripe** каждые 5 минут
- **Группировка платежей** в течение 3 часов
- **Загрузка существующих данных** при старте системы
- **Работа без ручного вмешательства**

## 📋 Формат уведомлений

### Telegram/Slack уведомление о покупке:
```
🟢 Purchase purchase_cus_TDrpXlZEj8RbBo was processed!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 Payment Method: Card
💰 Amount: 9.99 USD
🏷️ Payments: 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 Email: acampen72@gmail.com
📍 Location: US, New York City
🔗 Link: quiz.testora.pro/iq1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Campaign Data:
• Ad: 6025_static_var01_Spectrum_Impulse_12_IQTypes_VP_En
• Adset: WEB_EN_US_Broad_testora-myiq_LC_12.10.2025_Testora_ABO_60
• Campaign: Testora_WEB_US_Core-0030-ABO_cpi_fcb_12.11.2025
```

### GEO Alert (каждый час):
```
📊 **TOP-3 GEO for today (2025-10-13)**

🇺🇸 US - 39
🇨🇦 CA - 3
🇬🇧 GB - 2
🌍 WW - 5

📈 Total purchases: 49
```

### Weekly Report (понедельник 9:00 UTC+1):
```
📊 **Weekly Report - Past Week (2025-10-06 - 2025-10-12)**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 **Total Revenue:** $8246.29
📈 **Revenue Growth:** +101.1% vs week before
🛒 **Total Sales:** 771
📊 **Sales Growth:** +110.7% vs week before
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 **Top Countries (Past Week):**
1. US: 450 sales
2. AU: 68 sales
3. CA: 53 sales
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 **Top Creatives (Past Week):**
1. 6025_static_var01_Spectrum_Impulse_12IQTypes_VP_En: 317 sales
2. 6047_static_var01_PinkMan_Impulse_IQRange_VP_En: 152 sales
3. 6024_video_var01_BWMan_Impulse_PhDIQ160_VP_En: 51 sales
```

## 🛠️ API Endpoints

### Основные
- `GET /` - статус системы
- `GET /health` - детальная проверка здоровья
- `GET /ping` - поддержание активности Railway

### Синхронизация
- `POST /api/sync-payments` - принудительная синхронизация
- `GET /auto-sync` - автоматическая синхронизация
- `POST /api/full-resync` - полная пересинхронизация всех данных
- `POST /api/clean-duplicates` - очистка дубликатов

### Аналитика и отчеты
- `GET /api/geo-alert` - GEO алерт за сегодня
- `GET /api/daily-stats` - ежедневная статистика
- `GET /api/creative-alert` - алерт по креативам
- `GET /api/weekly-report` - еженедельный отчет
- `GET /api/anomaly-check` - проверка аномалий

### Управление данными
- `GET /api/check-duplicates` - проверка дубликатов
- `GET /api/memory-status` - статус памяти
- `GET /api/load-existing` - загрузка существующих покупок
- `POST /api/fix-sheets-data` - исправление данных в Google Sheets

### Тестирование
- `GET /api/test` - тест API
- `POST /api/test-notifications` - тест уведомлений
- `POST /api/test-telegram` - тест Telegram
- `GET /api/debug-customer/:customerId` - отладка клиента
- `GET /api/debug-geo` - отладка GEO данных

## 🚀 Быстрый старт

### 1. Environment Variables
Скопируйте `.env.example` → `.env` и заполните:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Telegram
TELEGRAM_BOT_TOKEN=1234567890:ABC...
TELEGRAM_CHAT_ID=-1001234567890

# Slack (опционально)
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C1234567890

# Google Sheets
GOOGLE_SHEETS_DOC_ID=1ABC...
GOOGLE_SERVICE_EMAIL=service@project.iam.gserviceaccount.com
GOOGLE_SERVICE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Настройки
AUTO_SYNC_DISABLED=false
NOTIFICATIONS_DISABLED=false
```

### 2. Google Sheets Setup
1. Создайте Google Spreadsheet
2. Создайте Service Account в Google Cloud Console
3. Скачайте JSON ключ и извлеките `client_email` и `private_key`
4. Дайте Service Account доступ **Editor** к вашему Spreadsheet

### 3. Запуск локально
```bash
npm install
npm run dev
```

### 4. Railway Deploy
```bash
# Подключите GitHub репозиторий к Railway
# Добавьте все ENV переменные в Railway Dashboard
# Система автоматически задеплоится
```

## 📊 Поля в Google Sheets

### Основные поля:
- `Purchase ID` - уникальный ID покупки
- `Customer ID` - ID клиента в Stripe
- `Email` - email клиента
- `Total Amount` - общая сумма всех покупок клиента
- `Payment Count` - количество платежей клиента
- `Payment Intent IDs` - все ID платежей через запятую
- `Created Local (UTC+1)` - дата первой покупки

### Campaign данные:
- `Ad Name` - название рекламы
- `Adset Name` - название рекламного набора
- `Campaign Name` - название кампании
- `Creative Link` - ссылка на креатив

### GEO данные:
- `GEO` - страна, город
- `Country` - страна
- `City` - город

### UTM данные:
- `UTM Source` - источник трафика
- `UTM Medium` - канал
- `UTM Campaign` - кампания
- `UTM Content` - контент
- `UTM Term` - ключевые слова

## 🔧 Особенности системы

### Группировка покупок
- Все платежи клиента в течение **3 часов** группируются в одну запись
- **Total Amount** = сумма всех платежей клиента
- **Payment Count** = количество платежей клиента
- **Payment Intent IDs** = все ID через запятую

### Защита от дубликатов
- Система загружает существующие покупки в память при старте
- Проверяет дубликаты перед добавлением новых записей
- Автоматически удаляет дубликаты при обнаружении

### Автоматические алерты
- **GEO Alert**: каждый час, ТОП-3 страны за сегодня
- **Daily Stats**: 7:00 UTC+1, статистика за вчера
- **Creative Alert**: 10:00 и 22:00 UTC+1, ТОП-5 креативов
- **Weekly Report**: понедельник 9:00 UTC+1, полный отчет

### Мониторинг
- Детальные логи всех операций
- Health check с проверкой всех сервисов
- Memory status для отслеживания загруженных данных
- Debug endpoints для отладки проблем

## 🛡️ Безопасность

- ✅ Никогда не коммитьте `.env` в репозиторий
- ✅ Ротируйте ключи при подозрении на компрометацию
- ✅ Email маскируется в уведомлениях, полный записывается в таблицу
- ✅ Проверка подписи Stripe webhook
- ✅ Валидация всех входящих данных

## 📈 Мониторинг и отладка

### Логи
Система ведет детальные логи всех операций:
- Синхронизация платежей
- Отправка уведомлений
- Работа с Google Sheets
- Ошибки и предупреждения

### Health Check
`GET /health` возвращает:
- Статус всех сервисов (Stripe, Google Sheets, Telegram, Slack)
- Количество загруженных покупок в память
- Время последней синхронизации
- Статистику использования памяти

### Debug Endpoints
- `GET /api/debug-customer/:customerId` - детальная информация о клиенте
- `GET /api/debug-geo` - отладка GEO данных
- `GET /api/check-duplicates` - поиск дубликатов
- `GET /api/memory-status` - статус памяти

## 🎯 Результат

После настройки система будет:
1. ✅ Автоматически синхронизировать новые покупки каждые 5 минут
2. ✅ Отправлять уведомления в Telegram и Slack
3. ✅ Записывать данные в Google Sheets с группировкой
4. ✅ Отправлять алерты по расписанию
5. ✅ Предотвращать дубликаты
6. ✅ Работать без ручного вмешательства

**Система полностью автоматизирована и готова к продакшену!** 🚀