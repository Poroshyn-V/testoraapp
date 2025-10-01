# 🚀 Stripe Payment Bot - Готовый Сервис

## ✅ Что работает:

### 1. Автоматические уведомления при покупке
- ✅ **Webhook** от Stripe → автоматическое уведомление в Telegram + Slack
- ✅ **Сохранение в Google Sheets** с проверкой дубликатов
- ✅ **Правильный формат** уведомлений с UTM метками и GEO

### 2. Синхронизация через API
- ✅ **Ручной запуск** через endpoint `/api/sync-payments`
- ✅ **Автоматический фильтр** - только покупки за последние 24 часа
- ✅ **Проверка дубликатов** - каждая покупка добавляется только 1 раз
- ✅ **Лимит 100 покупок** за один запрос

### 3. Формат уведомления в Telegram
```
🟢 Order i2c3qs6ry9l was processed!
---------------------------
💳 card
💰 9.99 USD
🏷️ product_name
---------------------------
📧 customer@email.com
---------------------------
🌪️ i2c3qs
📍 US
🧍male 25
🔗 creative_link
meta
Facebook_Mobile_Reels
ad_creative_name
adset_name
campaign_name
```

### 4. Google Sheets структура
| Поле | Описание |
|------|----------|
| created_at | Дата создания (UTC) |
| session_id | ID сессии Stripe |
| payment_status | Статус оплаты |
| amount | Сумма |
| currency | Валюта |
| email | Email клиента |
| country | GEO (страна, город) |
| gender | Пол |
| age | Возраст |
| product_tag | Тег продукта |
| creative_link | Ссылка на креатив |
| utm_source | UTM source |
| utm_medium | UTM medium |
| utm_campaign | UTM campaign |
| utm_content | UTM content |
| utm_term | UTM term |
| platform_placement | Размещение |
| ad_name | Название объявления |
| adset_name | Название группы |
| campaign_name | Название кампании |
| web_campaign | Web кампания |
| customer_id | ID клиента |
| client_reference_id | Референс ID |
| mode | Режим (payment/subscription) |
| status | Статус |
| raw_metadata_json | Все metadata в JSON |

## 🌐 Endpoints:

### Основные:
- `GET /health` - Проверка статуса сервиса
- `POST /webhook/stripe` - Webhook для Stripe
- `POST /api/sync-payments` - Ручная синхронизация
- `POST /api/send-last-payment` - Отправить последнюю покупку
- `GET /test` - Тестовая страница с кнопками

### Тестовая страница:
Откройте https://stripe-ops.onrender.com/test

Две кнопки:
1. **📊 Синхронизировать все покупки** - полная синхронизация за 24 часа
2. **📱 Отправить последнюю покупку** - отправить уведомление о последней

## ⚙️ Переменные окружения (Render):

```bash
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Google Sheets
GOOGLE_SHEETS_DOC_ID=...
GOOGLE_SERVICE_EMAIL=...
GOOGLE_SERVICE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Slack (опционально)
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=...

# Server
PORT=3000
```

## 🔧 Как использовать:

### 1. При новой покупке (автоматически):
Stripe → Webhook → Ваш сервис → Google Sheets + Telegram + Slack

### 2. Ручная синхронизация:
```bash
curl -X POST https://stripe-ops.onrender.com/api/sync-payments \
  -H "Content-Type: application/json"
```

### 3. Через браузер:
1. Откройте https://stripe-ops.onrender.com/test
2. Нажмите "📊 Синхронизировать все покупки"
3. Проверьте результаты

## 🔍 Устранение проблем:

### Дубликаты в Telegram:
✅ **ИСПРАВЛЕНО** - уведомления отправляются только для НОВЫХ покупок

### Дубликаты в Google Sheets:
✅ **ИСПРАВЛЕНО** - проверка session_id перед добавлением

### Старые покупки:
✅ **ИСПРАВЛЕНО** - фильтр только за последние 24 часа

### Покупка не появляется:
❓ Проверьте:
- Режим (Test / Live)
- Тип покупки (CheckoutSession vs PaymentIntent)
- Дата покупки (старше 24 часов?)

## 📊 Архитектура:

```
Stripe Payment
    ↓
Webhook → stripe-webhook.ts
    ↓
├─→ appendPaymentRow() → Google Sheets (с проверкой дубликатов)
├─→ sendTelegram() → Telegram Bot
└─→ sendSlack() → Slack

API Sync (каждые 5 мин или по запросу)
    ↓
stripe.checkout.sessions.list()
    ↓
Фильтр: последние 24 часа
    ↓
Для каждой сессии:
    ├─→ Проверка дубликата в Google Sheets
    └─→ Если новая:
        ├─→ Добавить в Google Sheets
        └─→ Отправить уведомления
```

## 🎯 Ключевые особенности:

1. **Нет дубликатов** - каждая покупка обрабатывается только 1 раз
2. **UTM метки** - все данные из metadata сохраняются
3. **GEO данные** - страна и город из metadata
4. **Автоматический режим** - webhook + опциональный polling
5. **Ручной контроль** - можно запустить синхронизацию вручную

## 🔄 Обновление:

```bash
git pull origin main
# Render автоматически задеплоит изменения
```

## 📝 Логи:

Render Dashboard → stripe-ops → Logs

Смотрите:
- `✅ Payment data saved to Google Sheets` - успешное сохранение
- `⏭️ Payment already exists` - дубликат пропущен
- `📱 Telegram notification sent` - уведомление отправлено
- `❌ Error` - ошибки

---

**Версия:** 1.0.0  
**URL:** https://stripe-ops.onrender.com  
**GitHub:** https://github.com/Poroshyn-V/testoraapp
