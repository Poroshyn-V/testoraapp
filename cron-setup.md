# 🤖 НАСТРОЙКА АВТОМАТИЧЕСКОГО БОТА

## ❌ ПРОБЛЕМА: Vercel не поддерживает setInterval

Vercel "засыпает" когда нет активности, поэтому внутренние интервалы не работают.

## ✅ РЕШЕНИЕ: Внешний Cron Job

### 🔗 Настройте cron job на https://cron-job.org/:

**Основная синхронизация (каждые 5 минут):**
- **URL:** `https://testoraapp.vercel.app/api/sync-payments`
- **Method:** POST
- **Interval:** каждые 5 минут

**Дополнительная проверка (каждые 2 минуты):**
- **URL:** `https://testoraapp.vercel.app/auto-sync`
- **Method:** GET
- **Interval:** каждые 2 минуты

**Поддержка активности (каждую минуту):**
- **URL:** `https://testoraapp.vercel.app/ping`
- **Method:** GET
- **Interval:** каждую минуту

## 🎯 РЕЗУЛЬТАТ:

После настройки cron job бот будет:
- ✅ Автоматически проверять Stripe каждые 5 минут
- ✅ Добавлять новые покупки в Google Sheets
- ✅ Отправлять уведомления в Telegram и Slack
- ✅ Работать БЕЗ твоего участия

## 🚀 БОТ БУДЕТ РАБОТАТЬ АВТОМАТИЧЕСКИ!
