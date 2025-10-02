# 🤖 НАСТРОЙКА АВТОМАТИЧЕСКОГО БОТА

## ❌ ПРОБЛЕМА
Vercel засыпает через несколько минут без активности. `setInterval` не работает на серверных платформах.

## ✅ РЕШЕНИЕ
Нужно настроить внешний cron job для автоматического запуска бота.

---

## 🚀 ИНСТРУКЦИЯ ПО НАСТРОЙКЕ

### ШАГ 1: Иди на [cron-job.org](https://cron-job.org/)
- Зарегистрируйся или войди в аккаунт
- Это бесплатный сервис для автоматических задач

### ШАГ 2: Создай 3 cron job

#### 1️⃣ ОСНОВНАЯ СИНХРОНИЗАЦИЯ (каждые 5 минут)
- **URL:** `https://testoraapp.vercel.app/api/sync-payments`
- **Method:** `POST`
- **Schedule:** `Every 5 minutes`
- **Title:** `Stripe Bot - Main Sync`

#### 2️⃣ ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА (каждые 2 минуты)
- **URL:** `https://testoraapp.vercel.app/auto-sync`
- **Method:** `GET`
- **Schedule:** `Every 2 minutes`
- **Title:** `Stripe Bot - Extra Check`

#### 3️⃣ ПОДДЕРЖАНИЕ АКТИВНОСТИ (каждую минуту)
- **URL:** `https://testoraapp.vercel.app/ping`
- **Method:** `GET`
- **Schedule:** `Every minute`
- **Title:** `Vercel Keep Alive`

---

## 🎯 РЕЗУЛЬТАТ
После настройки этих 3 cron job:
- ✅ Бот будет работать **ПОЛНОСТЬЮ АВТОМАТИЧЕСКИ**
- ✅ Проверять Stripe каждые 5 минут
- ✅ Добавлять новые покупки в Google Sheets
- ✅ Отправлять уведомления в Telegram и Slack
- ✅ Работать **БЕЗ твоего участия**

---

## 🔧 АЛЬТЕРНАТИВА
Если не хочешь настраивать cron job, можешь:
- Запускать синхронизацию вручную: `curl -X POST https://testoraapp.vercel.app/api/sync-payments`
- Или попросить меня запускать когда нужно

Но для полной автоматизации нужен внешний cron job!
