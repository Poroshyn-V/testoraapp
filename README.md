# 🤖 Stripe Ops - Advanced Payment Processing System

**Полностью автоматизированная система обработки платежей Stripe с интеграцией Telegram, Slack и Google Sheets**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/stripe-ops)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Stripe](https://img.shields.io/badge/Stripe-API-blue.svg)](https://stripe.com/)

## ✨ Основные возможности

### 🎯 Что умеет бот:

1. **💳 Обработка платежей из двух Stripe аккаунтов**
   - Автоматическая синхронизация основного и второго аккаунта
   - Группировка покупок одного клиента
   - Защита от дубликатов на всех уровнях

2. **📱 Уведомления в реальном времени**
   - Telegram уведомления о каждой покупке
   - Slack интеграция (опционально)
   - VIP алерты для крупных покупок
   - Красивое форматирование с эмодзи

3. **📊 Автоматическая запись в Google Sheets**
   - Все покупки записываются автоматически
   - Два отдельных листа для двух аккаунтов
   - Группировка по клиентам (1 клиент = 1 строка)
   - Автоматическое обновление при апсейлах

4. **📈 Умная аналитика и отчеты**
   - GEO алерты каждый час (ТОП-3 страны)
   - Daily Stats каждое утро (статистика за вчера)
   - Creative Alert 2 раза в день (ТОП-5 креативов из обоих аккаунтов)
   - Weekly Report каждый понедельник
   - Campaign Analysis с рекомендациями
   - Anomaly Detection (обнаружение аномалий)

5. **🔄 Автоматическая синхронизация**
   - Проверка новых покупок каждые 5 минут
   - Webhook поддержка для мгновенных обновлений
   - Автоматическое восстановление после сбоев
   - Retry логика при ошибках API

6. **🛡️ Надежность и безопасность**
   - Многоуровневая защита от дубликатов
   - Блокировки для предотвращения race conditions
   - Очередь уведомлений с повторными попытками
   - Мониторинг производительности
   - Emergency stop/resume функции

---

## 🚀 Что делает система

### 💳 Поддержка двух Stripe аккаунтов
- **Основной аккаунт (W2W)** - все покупки записываются в лист `payments`
- **Второй аккаунт (FL/LowPrice)** - покупки записываются в лист `LowPrice`
- **Единая система** - оба аккаунта синхронизируются автоматически
- **Объединенная аналитика** - Creative Alert включает данные из обоих аккаунтов
- **Независимая синхронизация** - каждый аккаунт обрабатывается отдельно

### 📱 Умные уведомления
- **Telegram & Slack** уведомления о новых покупках в структурированном формате
- **Группировка покупок** - все платежи клиента объединяются в одно уведомление
- **VIP алерты** - специальные уведомления о крупных покупках (от $100+)
- **Очередь уведомлений** - надежная доставка с повторными попытками
- **Форматирование** - красивое форматирование с эмодзи и разделителями

### 📊 Google Sheets интеграция
- **Автоматическая запись** всех покупок в Google Sheets
- **Два листа** - `payments` (основной аккаунт) и `LowPrice` (второй аккаунт)
- **Группировка по клиентам** - 1 клиент = 1 запись со всеми его покупками
- **Обновление данных** - апсейлы автоматически добавляются к существующим записям
- **Защита от дубликатов** - многоуровневая система предотвращения дубликатов
- **Batch операции** - оптимизированные операции для больших объемов данных
- **Автоматическое создание листов** - система создает листы при первом запуске

### 📈 Автоматические отчеты и аналитика
- **GEO алерты** - каждый час ТОП-3 страны за сегодня
- **Daily Stats** - каждое утро в 7:00 UTC+1 статистика за вчера
- **Creative алерты** - в 10:00 и 22:00 UTC+1 ТОП-5 креативов за сегодня (из обоих аккаунтов!)
- **Weekly отчеты** - каждый понедельник в 9:00 UTC+1 полный отчет за прошлую неделю
- **Campaign Analysis** - ежедневный анализ кампаний в 16:00 UTC+1
- **Anomaly Detection** - умное обнаружение аномалий в продажах
- **Smart Alerts** - приоритетные алерты с разными уровнями важности
- **Revenue Drop Alerts** - алерты при падении выручки на 30%+
- **Conversion Drop Alerts** - алерты при падении конверсии на 20%+

### 🔄 Автоматическая синхронизация
- **Проверка Stripe** каждые 5 минут (настраивается)
- **Два аккаунта** - синхронизация обоих Stripe аккаунтов параллельно
- **Группировка платежей** - покупки одного клиента объединяются в течение 3 часов
- **Загрузка существующих данных** - при старте система загружает все покупки из таблицы
- **Защита от race conditions** - блокировки клиентов при одновременной обработке
- **Retry логика** - повторные попытки при ошибках API (до 3 попыток)
- **Webhook поддержка** - обработка событий в реальном времени через Stripe webhooks

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

### 📋 Требования
- Node.js 18+ 
- Stripe аккаунт(ы) с API ключами
- Google Cloud проект с Service Account
- Telegram бот (опционально)
- Slack workspace (опционально)

---

## 📦 Установка и настройка

### Шаг 1: Клонирование репозитория

```bash
git clone https://github.com/your-username/stripe-ops.git
cd stripe-ops
npm install
```

### Шаг 2: Настройка Telegram бота

1. **Создайте бота через @BotFather:**
   - Откройте Telegram и найдите `@BotFather`
   - Отправьте команду `/newbot`
   - Следуйте инструкциям и придумайте имя для бота
   - Скопируйте токен (формат: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

2. **Получите Chat ID:**
   - Отправьте боту любое сообщение (например `/start`)
   - Откройте в браузере:
     ```
     https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates
     ```
   - Найдите в ответе `"chat":{"id":-1001234567890}` - это ваш Chat ID
   - Для групповых чатов: добавьте бота в группу, отправьте сообщение, затем проверьте через getUpdates

### Шаг 3: Настройка Google Sheets

1. **Создайте Google Spreadsheet:**
   - Откройте [Google Sheets](https://sheets.google.com)
   - Создайте новую таблицу
   - Скопируйте ID из URL (часть между `/d/` и `/edit`)
     ```
     https://docs.google.com/spreadsheets/d/1ABC123.../edit
                                          ^^^^^^^^^^^^
                                          Это ваш DOC_ID
     ```

2. **Создайте Service Account:**
   - Откройте [Google Cloud Console](https://console.cloud.google.com)
   - Создайте новый проект или выберите существующий
   - Перейдите в **APIs & Services** → **Credentials**
   - Нажмите **Create Credentials** → **Service Account**
   - Заполните имя (например: `stripe-ops-service`)
   - Нажмите **Create and Continue**
   - Роль: **Editor** (или **Owner**)
   - Нажмите **Done**

3. **Создайте ключ для Service Account:**
   - Найдите созданный Service Account в списке
   - Нажмите на него → вкладка **Keys**
   - **Add Key** → **Create new key** → **JSON**
   - Файл скачается автоматически

4. **Настройте доступ к таблице:**
   - Откройте скачанный JSON файл
   - Найдите поле `client_email` (например: `stripe-ops-service@project-id.iam.gserviceaccount.com`)
   - Откройте вашу Google Sheets таблицу
   - Нажмите **Share** (Поделиться)
   - Вставьте email из `client_email`
   - Выберите роль **Editor**
   - Нажмите **Send**

5. **Извлеките данные из JSON:**
   - Откройте скачанный JSON файл
   - Скопируйте значение `client_email`
   - Скопируйте значение `private_key` (весь текст, включая `-----BEGIN PRIVATE KEY-----` и `-----END PRIVATE KEY-----`)

### Шаг 4: Настройка Stripe

1. **Основной Stripe аккаунт:**
   - Откройте [Stripe Dashboard](https://dashboard.stripe.com)
   - Перейдите в **Developers** → **API keys**
   - Скопируйте **Secret key** (начинается с `sk_live_...` или `sk_test_...`)

2. **Второй Stripe аккаунт (опционально):**
   - Откройте Dashboard второго аккаунта
   - Скопируйте Secret key аналогично
   - Если используете только один аккаунт - пропустите этот шаг

3. **Настройка Webhook (для реального времени):**
   - В Stripe Dashboard → **Developers** → **Webhooks**
   - Нажмите **Add endpoint**
   - URL: `https://your-domain.com/api/stripe-webhook`
   - События: выберите `checkout.session.completed`, `payment_intent.succeeded`
   - После создания скопируйте **Signing secret** (начинается с `whsec_...`)

### Шаг 5: Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```bash
# ============================================
# STRIPE - Основной аккаунт
# ============================================
STRIPE_SECRET_KEY=sk_live_ваш_ключ_основного_аккаунта
STRIPE_WEBHOOK_SECRET=whsec_ваш_webhook_secret

# ============================================
# STRIPE - Второй аккаунт (опционально)
# ============================================
STRIPE_SECRET_KEY_LOW_PRICE=sk_live_ваш_ключ_второго_аккаунта
STRIPE_LOW_PRICE_SHEET_NAME=LowPrice

# ============================================
# TELEGRAM
# ============================================
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890

# ============================================
# SLACK (опционально)
# ============================================
SLACK_BOT_TOKEN=xoxb-ваш_slack_token
SLACK_CHANNEL_ID=C1234567890

# ============================================
# GOOGLE SHEETS
# ============================================
GOOGLE_SHEETS_DOC_ID=1ABC1234567890abcdefghijklmnopqrstuvwxyz
GOOGLE_SERVICE_EMAIL=stripe-ops-service@project-id.iam.gserviceaccount.com
GOOGLE_SERVICE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"

# ============================================
# НАСТРОЙКИ АЛЕРТОВ
# ============================================
VIP_PURCHASE_THRESHOLD=100          # Порог для VIP алертов ($)
DAILY_STATS_HOUR=7                  # Час отправки Daily Stats (UTC+1)
CREATIVE_ALERT_HOURS=10,22           # Часы отправки Creative Alert (UTC+1)
WEEKLY_REPORT_DAY=1                 # День недели для Weekly Report (1=понедельник)
WEEKLY_REPORT_HOUR=9                # Час отправки Weekly Report (UTC+1)

# ============================================
# НАСТРОЙКИ СИСТЕМЫ
# ============================================
AUTO_SYNC_DISABLED=false            # Отключить автосинхронизацию
NOTIFICATIONS_DISABLED=false        # Отключить уведомления
SYNC_INTERVAL_MINUTES=5             # Интервал синхронизации (минуты)
GEO_ALERT_INTERVAL_HOURS=1          # Интервал GEO алертов (часы)
PORT=3000                           # Порт сервера
```

**⚠️ ВАЖНО:** Никогда не коммитьте `.env` файл в Git! Он уже добавлен в `.gitignore`.

### Шаг 6: Запуск локально

```bash
# Установка зависимостей (если еще не установлены)
npm install

# Запуск бота
npm start
```

Бот запустится на `http://localhost:3000`. Проверьте статус:
```bash
curl http://localhost:3000/health
```

### Шаг 7: Деплой на Railway

1. **Подключите репозиторий:**
   - Откройте [Railway](https://railway.app)
   - Войдите через GitHub
   - Нажмите **New Project** → **Deploy from GitHub repo**
   - Выберите ваш репозиторий

2. **Настройте переменные окружения:**
   - В Railway Dashboard откройте ваш проект
   - Перейдите в **Variables**
   - Добавьте все переменные из `.env` файла
   - **ВАЖНО:** Для `GOOGLE_SERVICE_PRIVATE_KEY` вставьте весь ключ в одну строку с `\n` символами

3. **Настройте домен:**
   - Railway автоматически создаст домен
   - Скопируйте URL (например: `https://your-app.up.railway.app`)
   - Обновите Stripe Webhook URL на этот адрес: `https://your-app.up.railway.app/api/stripe-webhook`

4. **Проверьте деплой:**
   - Railway автоматически задеплоит проект
   - Проверьте логи в Railway Dashboard
   - Откройте `https://your-app.up.railway.app/health` в браузере

### Шаг 8: Проверка работы

После деплоя проверьте:

1. **Health Check:**
   ```bash
   curl https://your-app.up.railway.app/health
   ```

2. **Принудительная синхронизация:**
   ```bash
   curl -X POST https://your-app.up.railway.app/api/sync-payments
   ```

3. **Проверьте Google Sheets:**
   - Откройте вашу таблицу
   - Должен появиться лист `payments` (и `LowPrice` если настроен второй аккаунт)
   - Проверьте, что данные записываются

4. **Проверьте Telegram:**
   - Сделайте тестовую покупку в Stripe
   - Проверьте, что уведомление пришло в Telegram

---

## ✅ Что дальше?

После настройки система будет автоматически:
- ✅ Синхронизировать покупки каждые 5 минут
- ✅ Отправлять уведомления в Telegram/Slack
- ✅ Записывать данные в Google Sheets
- ✅ Отправлять алерты по расписанию
- ✅ Анализировать кампании и креативы

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
- **7:00 UTC+1** - Daily Stats (ежедневная статистика за вчера)
- **10:00 UTC+1** - Creative Alert (утренний ТОП-5 креативов за сегодня) ⭐ **Включает данные из обоих Stripe аккаунтов**
- **16:00 UTC+1** - Campaign Analysis Report (анализ кампаний с рекомендациями)
- **22:00 UTC+1** - Creative Alert (вечерний ТОП-5 креативов за сегодня) ⭐ **Включает данные из обоих Stripe аккаунтов**
- **Каждый час** - GEO Alerts (ТОП-3 страны за сегодня)
- **Понедельник 9:00 UTC+1** - Weekly Report (полный отчет за прошлую неделю)
- **Ежедневно 3:00 UTC+1** - Cleanup дубликатов (автоматическая очистка)

### Формат Creative Alert:
```
🎨 **TOP-5 Creative Performance for today (2025-12-03)**

1. 3_2_Testora_s_var6039_IQ_TextCenter_General_VP_En_Impulse_IQ1_4x5_KA - 3 purchases
2. Creative_Name_2 - 2 purchases
...

📈 Total purchases: 4 (W2W + FL)
⏰ Report time: 11:00 UTC+1
```

**Примечание:** Creative Alert объединяет данные из обоих Stripe аккаунтов (листы `payments` и `LowPrice`) для полной картины по креативам.

### Умные алерты:
- **Revenue Drop** - падение выручки на 30%+
- **Conversion Drop** - падение конверсии на 20%+
- **New GEO** - новые страны с 5+ покупками
- **VIP Purchases** - покупки от $100+ (настраивается через `VIP_PURCHASE_THRESHOLD`)

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
1. **Синхронизировать** новые покупки из обоих Stripe аккаунтов каждые 5 минут
2. **Отправлять уведомления** в Telegram и Slack о каждой покупке
3. **Записывать данные** в Google Sheets с группировкой (листы `payments` и `LowPrice`)
4. **Отправлять алерты** по расписанию (GEO, Creative, Daily Stats, Weekly Report)
5. **Предотвращать дубликаты** многоуровневой защитой
6. **Анализировать кампании** и давать рекомендации по масштабированию
7. **Мониторить производительность** и метрики системы
8. **Очищать дубликаты** ежедневно автоматически
9. **Восстанавливаться** после сбоев с retry логикой
10. **Работать без ручного вмешательства** 24/7

### 🚀 Дополнительные возможности:
- **Два Stripe аккаунта** - поддержка основного и второго аккаунта одновременно
- **Объединенная аналитика** - Creative Alert включает данные из обоих аккаунтов
- **Campaign Analysis** - умный анализ кампаний с рекомендациями по масштабированию
- **VIP Alerts** - специальные уведомления о крупных покупках (настраиваемый порог)
- **Smart Alerts** - приоритетные алерты с разными уровнями важности
- **Performance Monitoring** - мониторинг производительности в реальном времени
- **Emergency Controls** - экстренное управление системой (stop/resume)
- **Comprehensive Metrics** - детальные метрики всех операций
- **Webhook поддержка** - обработка событий Stripe в реальном времени

**Система полностью автоматизирована, масштабируема и готова к продакшену!** 🚀

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи через `GET /health`
2. Используйте debug endpoints для диагностики
3. Проверьте статус всех сервисов
4. При необходимости используйте emergency stop/resume

---

**Made with ❤️ for automated payment processing**