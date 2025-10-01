# Автоматический API Polling для Stripe

## Описание
Отдельный скрипт для автоматической обработки новых покупок из Stripe каждые 5 минут.

## Установка

### 1. Установите зависимости
```bash
npm install --save dotenv node-fetch stripe
```

### 2. Настройте переменные окружения
Создайте файл `.env` с теми же переменными, что и в основном проекте:
```
STRIPE_SECRET_KEY=sk_live_...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
SLACK_WEBHOOK_URL=...
GOOGLE_SHEETS_DOC_ID=...
GOOGLE_SERVICE_EMAIL=...
GOOGLE_SERVICE_PRIVATE_KEY=...
```

### 3. Запустите скрипт
```bash
node auto-polling.js
```

## Что делает скрипт

1. **Проверяет новые платежи** каждые 5 минут
2. **Группирует покупки** по клиенту и дате
3. **Отправляет уведомления** в Telegram и Slack
4. **Обновляет Google Sheets** автоматически
5. **Предотвращает дублирование** с помощью Set

## Запуск в фоне

### Linux/Mac:
```bash
nohup node auto-polling.js > polling.log 2>&1 &
```

### Windows:
```bash
start /B node auto-polling.js
```

## Мониторинг

Проверьте логи:
```bash
tail -f polling.log
```

## Остановка

Найдите процесс и остановите:
```bash
ps aux | grep auto-polling
kill [PID]
```

## Преимущества

✅ **Независимый** - работает отдельно от основного сервера  
✅ **Надежный** - не зависит от перезапусков сервера  
✅ **Автоматический** - работает 24/7  
✅ **Группировка** - объединяет покупки как в Stripe  
✅ **Полные данные** - GEO, UTM, Ad информация  
