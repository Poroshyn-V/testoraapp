# 🤖 ПОЛНЫЙ БЭКАП РАБОЧЕГО БОТА

## ✅ ВСЕ РАБОЧИЕ ФУНКЦИИ СОХРАНЕНЫ

### 🔧 ОСНОВНЫЕ ФУНКЦИИ
- ✅ **Синхронизация Stripe** - получает покупки за последние 7 дней
- ✅ **Группировка покупок** - по customer_id + дата
- ✅ **Суммирование** - если один клиент купил несколько раз в день
- ✅ **Проверка дубликатов** - не добавляет существующие покупки
- ✅ **Google Sheets** - сохраняет все данные
- ✅ **Telegram уведомления** - с полным форматом
- ✅ **Slack уведомления** - с полным форматом

### 📊 ФОРМАТ ДАННЫХ В GOOGLE SHEETS
```
Purchase ID | Total Amount | Currency | Status | Created UTC | Created Local (UTC+1) | Customer ID | Customer Email | GEO | UTM Source | UTM Medium | UTM Campaign | UTM Content | UTM Term | Ad Name | Adset Name | Payment Count
```

### 📱 ФОРМАТ TELEGRAM УВЕДОМЛЕНИЙ
```
🟢 Order [purchase_id] was processed!
---------------------------
💳 card
💰 [amount] [currency]
🏷️ [payment_count]
---------------------------
📧 [email]
---------------------------
🌪️ [purchase_id]
📍 [country]
🔗 quiz.testora.pro/iq1
meta
[platform_placement]
[ad_name]
[adset_name]
[campaign_name]
```

### 🌍 GEO ФОРМАТ
- ✅ **Правильный формат:** `Country, City` (например: `FR, Perpignan`)
- ✅ **Источники данных:** Stripe API + метаданные
- ✅ **Fallback:** метаданные если API не работает

### ⏰ UTC+1 ВРЕМЯ
- ✅ **Правильный расчет:** UTC + 1 час
- ✅ **Формат:** `2025-10-02 22:57:27 UTC+1`
- ✅ **Колонка:** `Created Local (UTC+1)`

### 🔄 ЛОГИКА ДУБЛИКАТОВ
- ✅ **Проверка по:** `purchase_id`
- ✅ **Колонки:** `Purchase ID` или `purchase_id`
- ✅ **Логика:** `rows.some((row) => row.get('Purchase ID') === purchaseId || row.get('purchase_id') === purchaseId)`

### 📈 ГРУППИРОВКА ПОКУПОК
- ✅ **Ключ группировки:** `customer_id + date`
- ✅ **Суммирование:** `totalAmount += payment.amount`
- ✅ **Счетчик:** `payment_count = group.payments.length`
- ✅ **ID покупки:** `purchase_${customerId}_${date}`

### 🔧 ОБНОВЛЕНИЕ СУЩЕСТВУЮЩИХ ЗАПИСЕЙ
- ✅ **UTC+1 время** - обновляется для всех существующих
- ✅ **GEO данные** - обновляются для всех существующих
- ✅ **Формат:** `Country, City`

### 🚀 АВТОМАТИЗАЦИЯ
- ✅ **Основная проверка:** каждые 5 минут
- ✅ **Дополнительная проверка:** каждые 2 минуты
- ✅ **Первый запуск:** через 30 секунд после старта

### 🛠️ ТЕХНИЧЕСКИЕ ДЕТАЛИ
- ✅ **Stripe API:** `paymentIntents.list` за 7 дней
- ✅ **Google Sheets:** `google-spreadsheet` + JWT auth
- ✅ **Telegram:** Bot API
- ✅ **Slack:** Web API
- ✅ **Обработка ошибок:** try-catch везде
- ✅ **Логирование:** подробные console.log

### 📋 ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
```
STRIPE_SECRET_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
SLACK_BOT_TOKEN
SLACK_CHANNEL_ID
GOOGLE_SERVICE_EMAIL
GOOGLE_SERVICE_PRIVATE_KEY
GOOGLE_SHEETS_DOC_ID
```

### 🎯 РЕЗУЛЬТАТ
Бот полностью автоматический:
- 🔍 Проверяет Stripe каждые 5 минут
- 📊 Добавляет новые покупки в Google Sheets
- 📱 Отправляет уведомления в Telegram и Slack
- 🔄 Обновляет существующие записи (UTC+1, GEO)
- 🚫 Не создает дубликаты
- ⚡ Работает без участия пользователя

## 🚀 ГОТОВ К ДЕПЛОЮ НА RAILWAY!
