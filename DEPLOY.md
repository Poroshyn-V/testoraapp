# 🚀 Деплой на Render

## Пошаговая инструкция деплоя

### 1. Подготовка проекта
Проект уже готов к деплою! Все файлы настроены.

### 2. Создание аккаунта на Render
1. Перейдите на [render.com](https://render.com)
2. Нажмите "Get Started for Free"
3. Войдите через GitHub аккаунт

### 3. Создание Web Service
1. В Dashboard нажмите "New +"
2. Выберите "Web Service"
3. Подключите ваш GitHub репозиторий
4. Выберите папку с проектом

### 4. Настройка деплоя
**Build Command:**
```bash
npm install && npm run build
```

**Start Command:**
```bash
npm start
```

**Node Version:** 20.x

### 5. Переменные окружения
В разделе "Environment" добавьте:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_... # Получить из Stripe Dashboard
TELEGRAM_BOT_TOKEN=ваш_токен_бота
TELEGRAM_CHAT_ID=ваш_chat_id
PORT=3000
```

### 6. Настройка Stripe Webhook
1. В Stripe Dashboard → Webhooks
2. Добавить endpoint: `https://your-app.onrender.com/webhook/stripe`
3. События: `checkout.session.completed`
4. Скопировать Webhook Secret в переменные окружения

### 7. Настройка Telegram Bot
1. Создайте бота через @BotFather
2. Получите токен бота
3. Узнайте chat_id (отправьте /start боту, затем перейдите на https://api.telegram.org/bot<TOKEN>/getUpdates)

## 🔧 Альтернативные платформы

### Railway (альтернатива)
1. [railway.app](https://railway.app)
2. Подключить GitHub
3. Автоматический деплой
4. 500 часов бесплатно

### DigitalOcean App Platform
1. [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. Создать App
3. Подключить GitHub
4. От $5/месяц

## 📝 После деплоя

1. Проверьте, что сервис запустился
2. Протестируйте webhook endpoint
3. Настройте мониторинг
4. Добавьте Google Sheets (опционально)

## 🆘 Поддержка

Если возникнут проблемы:
1. Проверьте логи в Render Dashboard
2. Убедитесь, что все переменные окружения настроены
3. Проверьте, что Stripe webhook настроен правильно
