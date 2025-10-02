# 🚀 ДЕПЛОЙ БОТА НА RAILWAY

## ✅ ПРЕИМУЩЕСТВА RAILWAY
- 🚀 **Поддерживает setInterval** - бот работает автоматически
- 💰 **Дешевле** чем Vercel для постоянной работы  
- 🔄 **Не засыпает** - всегда активен
- ⚡ **Быстрый деплой** из GitHub

## 🚀 ИНСТРУКЦИЯ ПО ДЕПЛОЮ

### ШАГ 1: Создай аккаунт на Railway
1. Иди на [railway.app](https://railway.app)
2. Зарегистрируйся через GitHub
3. Подключи свой репозиторий `testoraapp`

### ШАГ 2: Настрой переменные окружения
В Railway Dashboard добавь все переменные:
- `STRIPE_SECRET_KEY`
- `TELEGRAM_BOT_TOKEN` 
- `TELEGRAM_CHAT_ID`
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`
- `GOOGLE_SERVICE_EMAIL`
- `GOOGLE_SERVICE_PRIVATE_KEY`
- `GOOGLE_SHEETS_DOC_ID`

### ШАГ 3: Настрой деплой
- **Build Command:** `npm install`
- **Start Command:** `node app.js`
- **Port:** `3000`

## 🎯 РЕЗУЛЬТАТ
После деплоя на Railway:
- ✅ Бот будет работать **ПОЛНОСТЬЮ АВТОМАТИЧЕСКИ**
- ✅ Проверять Stripe каждые 5 минут
- ✅ Добавлять новые покупки в Google Sheets
- ✅ Отправлять уведомления в Telegram и Slack
- ✅ Работать **БЕЗ твоего участия**

## 💰 СТОИМОСТЬ
- **Бесплатно:** $5 кредитов в месяц
- **Платно:** $5/месяц за постоянную работу
- **Дешевле** чем Vercel для ботов!
