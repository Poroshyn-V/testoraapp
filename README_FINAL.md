# 🚀 Stripe Webhook → Telegram + Google Sheets

## ✅ Что готово

- ✅ **Проект скомпилирован** и готов к деплою
- ✅ **Stripe webhook handler** настроен
- ✅ **Telegram уведомления** готовы
- ✅ **Google Sheets интеграция** (опционально)
- ✅ **Безопасность** - ключи в переменных окружения
- ✅ **Документация** по деплою

## 🎯 Следующие шаги

### 1. Создать Telegram Bot
1. Напишите @BotFather в Telegram
2. Отправьте `/newbot`
3. Придумайте имя и username для бота
4. Скопируйте **токен** (например: `1234567890:ABC...`)
5. Узнайте **chat_id**: отправьте боту `/start`, затем перейдите на:
   ```
   https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates
   ```
   Найдите `"chat":{"id":-1001234567890}` - это ваш chat_id

### 2. Деплой на Render
1. Перейдите на [render.com](https://render.com)
2. Войдите через GitHub
3. Создайте **Web Service**
4. Подключите ваш репозиторий
5. Настройте переменные окружения (см. DEPLOY.md)

### 3. Настройка Stripe Webhook
1. В Stripe Dashboard → Webhooks
2. Добавить endpoint: `https://your-app.onrender.com/webhook/stripe`
3. События: `checkout.session.completed`
4. Скопировать **Webhook Secret**

### 4. Переменные окружения в Render
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_... # Из Stripe Dashboard
TELEGRAM_BOT_TOKEN=1234567890:ABC... # От @BotFather
TELEGRAM_CHAT_ID=-1001234567890 # Из getUpdates
PORT=3000
```

### 5. Google Sheets (опционально)
Следуйте инструкции в `GOOGLE_SHEETS_SETUP.md`

## 🔧 Структура проекта

```
stripe-ops/
├── src/
│   ├── api/stripe-webhook.ts    # Webhook handler
│   ├── lib/
│   │   ├── env.ts              # Переменные окружения
│   │   ├── format.ts           # Форматирование Telegram
│   │   ├── sheets.ts           # Google Sheets (отключено)
│   │   ├── store.ts            # Дедупликация
│   │   └── telegram.ts          # Отправка в Telegram
│   └── index.ts                # Главный файл
├── package.json                # Зависимости
├── tsconfig.json              # TypeScript конфиг
├── DEPLOY.md                   # Инструкция по деплою
├── GOOGLE_SHEETS_SETUP.md      # Настройка Google Sheets
└── README_FINAL.md            # Эта инструкция
```

## 🧪 Тестирование

1. **Проверьте деплой**: `https://your-app.onrender.com/health`
2. **Создайте тестовый платеж** в Stripe
3. **Проверьте Telegram** - должно прийти уведомление
4. **Проверьте логи** в Render Dashboard

## 📊 Формат уведомления в Telegram

```
🟢 Order 51S95ai... processed!
---------------------------
💳 card
💰 19.99 USD
🏷️ 30_30D_USD_20_46
---------------------------
📧 user@example.com
---------------------------
🌪️ Wi1Tht3
📍 USA
🧍 Male 30-44
🔗 Creo Link
fb
Facebook_Mobile_Feed (Facebook_Stories)
AdName
AdsetName
CampaignName
```

## 🆘 Решение проблем

### Webhook не работает
- Проверьте URL в Stripe Dashboard
- Убедитесь, что приложение запущено
- Проверьте логи в Render

### Telegram не отправляет
- Проверьте токен бота
- Проверьте chat_id
- Убедитесь, что бот добавлен в чат

### Google Sheets не работает
- Проверьте права Service Account
- Убедитесь, что переменные окружения настроены
- Следуйте инструкции в GOOGLE_SHEETS_SETUP.md

## 🎉 Готово!

После настройки у вас будет:
- ✅ Автоматические уведомления в Telegram при платежах
- ✅ Запись данных в Google Sheets (опционально)
- ✅ Безопасное хранение ключей
- ✅ Стабильная работа на Render

**Удачного деплоя! 🚀**
