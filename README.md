# 🤖 Stripe Ops - Advanced Payment Processing System

**Полностью автоматизированная система обработки платежей Stripe с интеграцией Telegram, Slack и Google Sheets**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/stripe-ops)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Stripe](https://img.shields.io/badge/Stripe-API-blue.svg)](https://stripe.com/)

## 🚀 Что делает система

### 📱 Умные уведомления
- **Telegram & Slack** уведомления о новых покупках в структурированном формате
- **Группировка покупок** - все платежи клиента объединяются в одно уведомление
- **VIP алерты** - специальные уведомления о крупных покупках
- **Очередь уведомлений** - надежная доставка с повторными попытками

### 📊 Google Sheets интеграция
- **Автоматическая запись** всех покупок в Google Sheets
- **Группировка по клиентам** - 1 клиент = 1 запись со всеми его покупками
- **Обновление данных** - апсейлы автоматически добавляются к существующим записям
- **Защита от дубликатов** - многоуровневая система предотвращения дубликатов
- **Batch операции** - оптимизированные операции для больших объемов данных

### 📈 Автоматические отчеты и аналитика
- **GEO алерты** - каждый час ТОП-3 страны за сегодня
- **Daily Stats** - каждое утро в 7:00 UTC+1 статистика за вчера
- **Creative алерты** - в 10:00 и 22:00 UTC+1 ТОП-5 креативов за сегодня
- **Weekly отчеты** - каждый понедельник в 9:00 UTC+1 полный отчет за прошлую неделю
- **Campaign Analysis** - ежедневный анализ кампаний в 16:00 UTC+1
- **Anomaly Detection** - умное обнаружение аномалий в продажах
- **Smart Alerts** - приоритетные алерты с разными уровнями важности

### 🔄 Автоматическая синхронизация
- **Проверка Stripe** каждые 5 минут
- **Группировка платежей** в течение 3 часов
- **Загрузка существующих данных** при старте системы
- **Защита от race conditions** - блокировки клиентов
- **Retry логика** - повторные попытки при ошибках API

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

### VIP Purchase Alert:
```
💎 VIP PURCHASE ALERT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Amount: $299.99
👤 Customer: vip@customer.com
🆔 ID: cus_VIP123456789
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 High-value customer detected!
```

### Campaign Analysis Report:
```
📊 CAMPAIGN PERFORMANCE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Period: today
💰 Total Revenue: $1,234.56
🛒 Total Purchases: 45
📈 Average AOV: $27.43
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏆 TOP PERFORMING CAMPAIGNS:
1. Testora_WEB_US_Core-0030-ABO_cpi_fcb_12.11.2025
   💰 $456.78 | 🛒 12 | 📊 AOV: $38.07

🚀 SCALE THESE CAMPAIGNS:
1. Testora_WEB_US_Core-0030-ABO_cpi_fcb_12.11.2025
   💰 $456.78 | 🛒 12
   ✅ 150% выше средней выручки
   💡 Увеличить бюджет на 20-30%
```

## 🛠️ API Endpoints

### 🔧 Основные
- `GET /` - статус системы и список всех endpoints
- `GET /health` - детальная проверка здоровья всех сервисов
- `GET /api/status` - легкий статус для внешних мониторингов
- `GET /ping` - поддержание активности Railway

### 🔄 Синхронизация
- `POST /api/sync-payments` - принудительная синхронизация с защитой от дубликатов
- `GET /auto-sync` - автоматическая синхронизация
- `POST /api/full-resync` - полная пересинхронизация всех данных
- `POST /api/clean-duplicates` - очистка дубликатов
- `POST /api/fix-duplicates` - агрессивное исправление дубликатов

### 📊 Аналитика и отчеты
- `GET /api/geo-alert` - GEO алерт за сегодня
- `GET /api/daily-stats` - ежедневная статистика
- `GET /api/creative-alert` - алерт по креативам
- `GET /api/weekly-report` - еженедельный отчет
- `GET /api/anomaly-check` - проверка аномалий
- `GET /api/campaigns/analyze` - анализ всех кампаний
- `GET /api/campaigns/:campaignName/analyze` - анализ конкретной кампании
- `POST /api/campaigns/report` - принудительный отчет по кампаниям

### 🛡️ Управление дубликатами
- `GET /api/check-duplicates` - проверка дубликатов
- `GET /api/duplicates/find` - поиск дубликатов
- `GET /api/duplicates/cache-stats` - статистика кэша дубликатов
- `POST /api/duplicates/refresh-cache` - обновление кэша дубликатов
- `GET /api/sync-locks` - статус блокировок синхронизации

### 📱 Уведомления
- `GET /api/notification-queue/stats` - статистика очереди уведомлений
- `POST /api/notification-queue/clear` - очистка очереди
- `POST /api/notification-queue/pause` - приостановка обработки
- `POST /api/notification-queue/resume` - возобновление обработки

### 🚨 Алерты и мониторинг
- `GET /api/alerts/history` - история всех алертов
- `GET /api/alerts/dashboard` - дашборд алертов
- `POST /api/emergency-stop` - экстренная остановка системы
- `POST /api/emergency-resume` - возобновление работы системы

### 📈 Метрики и производительность
- `GET /api/metrics` - все метрики системы
- `GET /api/metrics/summary` - сводка метрик
- `POST /api/metrics/reset` - сброс метрик
- `GET /api/performance-stats` - статистика производительности

### 🗄️ Управление данными
- `GET /api/memory-status` - статус памяти
- `GET /api/cache-stats` - статистика кэшей
- `GET /api/load-existing` - загрузка существующих покупок
- `POST /api/fix-sheets-data` - исправление данных в Google Sheets

### 🔍 Отладка
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

# Настройки алертов
VIP_PURCHASE_THRESHOLD=100
DAILY_STATS_HOUR=7
CREATIVE_ALERT_HOURS=10,22
WEEKLY_REPORT_DAY=1
WEEKLY_REPORT_HOUR=9

# Настройки системы
AUTO_SYNC_DISABLED=false
NOTIFICATIONS_DISABLED=false
SYNC_INTERVAL_MINUTES=5
GEO_ALERT_INTERVAL_HOURS=1
```

### 2. Google Sheets Setup
1. Создайте Google Spreadsheet
2. Создайте Service Account в Google Cloud Console
3. Скачайте JSON ключ и извлеките `client_email` и `private_key`
4. Дайте Service Account доступ **Editor** к вашему Spreadsheet

### 3. Запуск локально
   ```bash
npm install
npm start
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
- `Created UTC` - дата в UTC

### Campaign данные:
- `Ad Name` - название рекламы
- `Adset Name` - название рекламного набора
- `Campaign Name` - название кампании
- `UTM Campaign` - UTM кампания
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

## 🔧 Архитектура системы

### 🏗️ Модульная архитектура
```
src/
├── services/          # Основные сервисы
│   ├── googleSheets.js    # Работа с Google Sheets
│   ├── notifications.js   # Уведомления Telegram/Slack
│   ├── analytics.js       # Аналитика и отчеты
│   ├── purchaseCache.js   # Кэш покупок
│   ├── duplicateChecker.js # Проверка дубликатов
│   ├── campaignAnalyzer.js # Анализ кампаний
│   ├── notificationQueue.js # Очередь уведомлений
│   ├── metrics.js         # Метрики системы
│   └── performanceMonitor.js # Мониторинг производительности
├── utils/             # Утилиты
│   ├── logging.js         # Логирование
│   ├── validation.js      # Валидация данных
│   ├── cache.js          # Кэширование
│   ├── retry.js          # Retry логика
│   └── alertCooldown.js  # Система кулдаунов
└── config/            # Конфигурация
    ├── env.js             # Environment variables
    └── alertConfig.js     # Настройки алертов
```

### 🛡️ Защита от дубликатов
1. **PurchaseCache** - основная система кэширования
2. **DuplicateChecker** - дополнительная проверка дубликатов
3. **Customer Locks** - блокировки для предотвращения race conditions
4. **Triple Check** - тройная проверка перед записью в Google Sheets
5. **Automatic Cleanup** - автоматическая очистка дубликатов

### 📈 Система метрик
- **Counters** - счетчики событий
- **Gauges** - текущие значения
- **Timers** - время выполнения операций
- **Histograms** - распределение значений

## 🚨 Автоматические алерты

### Расписание алертов:
- **7:00 UTC+1** - Daily Stats (ежедневная статистика)
- **10:00 UTC+1** - Creative Alert (утренний)
- **16:00 UTC+1** - Campaign Analysis Report
- **22:00 UTC+1** - Creative Alert (вечерний)
- **Каждый час** - GEO Alerts
- **Понедельник 9:00 UTC+1** - Weekly Report
- **Ежедневно 3:00 UTC+1** - Cleanup дубликатов

### Умные алерты:
- **Revenue Drop** - падение выручки на 30%+
- **Conversion Drop** - падение конверсии на 20%+
- **New GEO** - новые страны с 5+ покупками
- **VIP Purchases** - покупки от $100+

## 🛡️ Безопасность и надежность

### Безопасность:
- ✅ Никогда не коммитьте `.env` в репозиторий
- ✅ Ротируйте ключи при подозрении на компрометацию
- ✅ Email маскируется в уведомлениях, полный записывается в таблицу
- ✅ Проверка подписи Stripe webhook
- ✅ Валидация всех входящих данных
- ✅ Rate limiting для API endpoints

### Надежность:
- ✅ Retry логика для всех внешних API
- ✅ Graceful shutdown с очисткой ресурсов
- ✅ Emergency stop система
- ✅ Очередь уведомлений с повторными попытками
- ✅ Автоматическое восстановление после сбоев
- ✅ Мониторинг производительности

## 📈 Мониторинг и отладка

### Health Check
`GET /health` возвращает:
- Статус всех сервисов (Stripe, Google Sheets, Telegram, Slack)
- Количество загруженных покупок в память
- Время последней синхронизации
- Статистику использования памяти
- Статус всех интервалов
- Метрики производительности

### Логирование
Система ведет детальные логи всех операций:
- Структурированное логирование с JSON
- Контекстная информация для каждой операции
- Метрики производительности
- Ошибки и предупреждения

### Debug Endpoints
- `GET /api/debug-customer/:customerId` - детальная информация о клиенте
- `GET /api/debug-geo` - отладка GEO данных
- `GET /api/check-duplicates` - поиск дубликатов
- `GET /api/memory-status` - статус памяти
- `GET /api/performance-stats` - статистика производительности

## 🎯 Результат

После настройки система будет:

### ✅ Автоматически:
1. **Синхронизировать** новые покупки каждые 5 минут
2. **Отправлять уведомления** в Telegram и Slack
3. **Записывать данные** в Google Sheets с группировкой
4. **Отправлять алерты** по расписанию
5. **Предотвращать дубликаты** многоуровневой защитой
6. **Анализировать кампании** и давать рекомендации
7. **Мониторить производительность** и метрики
8. **Очищать дубликаты** ежедневно
9. **Восстанавливаться** после сбоев
10. **Работать без ручного вмешательства**

### 🚀 Дополнительные возможности:
- **Campaign Analysis** - умный анализ кампаний с рекомендациями
- **VIP Alerts** - специальные уведомления о крупных покупках
- **Smart Alerts** - приоритетные алерты с разными уровнями
- **Performance Monitoring** - мониторинг производительности
- **Emergency Controls** - экстренное управление системой
- **Comprehensive Metrics** - детальные метрики всех операций

**Система полностью автоматизирована, масштабируема и готова к продакшену!** 🚀

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи через `GET /health`
2. Используйте debug endpoints для диагностики
3. Проверьте статус всех сервисов
4. При необходимости используйте emergency stop/resume

---

**Made with ❤️ for automated payment processing**