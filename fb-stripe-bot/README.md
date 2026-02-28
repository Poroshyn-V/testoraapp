# FB Stripe Bot

Модульный бот для интеграции Facebook рекламы со Stripe платежами.

## 🚀 Возможности

- **Facebook API интеграция** - получение инсайтов рекламы (траты, показы, клики)
- **Google Sheets интеграция** - чтение данных Stripe и запись результатов анализа
- **Умное сопоставление** - автоматическое сопоставление объявлений с покупками по UTM меткам
- **Расчет метрик** - SPA, CTR, CPM, Hook Rate, ROAS
- **Автоматическое обновление** - каждые 15 минут

## 📁 Структура проекта

```
fb-stripe-bot/
│
├── .env                    # Переменные окружения
├── package.json            # Зависимости проекта
├── main.js                 # Главный файл
├── /modules                # Основные модули
│   ├── fb_api.js          # Facebook API
│   ├── sheets.js          # Google Sheets
│   ├── matcher.js         # Сопоставление данных
│   └── aggregator.js      # Агрегация данных
└── /utils                  # Утилиты
    └── scheduler.js        # Планировщик задач
```

## ⚙️ Установка

1. **Клонируйте репозиторий:**
```bash
git clone <repository-url>
cd fb-stripe-bot
```

2. **Установите зависимости:**
```bash
npm install
```

3. **Настройте переменные окружения:**
```bash
cp .env.example .env
# Отредактируйте .env файл с вашими данными
```

4. **Запустите бота:**
```bash
npm start
```

## 🔧 Конфигурация

### Переменные окружения (.env)

```bash
# Facebook API
FB_ACCESS_TOKEN=your_facebook_access_token
FB_ACCOUNT_ID=act_123456789

# Google Sheets
SHEET_ID=your_google_sheet_id
GOOGLE_CREDENTIALS={"type":"service_account","project_id":"..."}

# Дополнительные настройки
PORT=3000
NODE_ENV=development
```

### Facebook API

1. Создайте приложение в Facebook Developers
2. Получите Access Token с правами на чтение рекламы
3. Укажите ID рекламного аккаунта

### Google Sheets

1. Создайте Service Account в Google Cloud Console
2. Скачайте JSON файл с ключами
3. Предоставьте доступ к Google Sheet для Service Account

## 📊 Использование

### Основные функции

- **Автоматическая синхронизация** - данные обновляются каждый час
- **Ежедневные отчеты** - генерируются в 9:00 утра
- **Умное сопоставление** - автоматически находит связи между кампаниями и платежами

### API Endpoints

```javascript
// Получить данные кампаний
const campaigns = await fbApi.getCampaigns();

// Получить данные групп объявлений
const adsets = await fbApi.getAdSets();

// Получить данные объявлений
const ads = await fbApi.getAds();
```

## 🔄 Планировщик задач

- **sync-data** - синхронизация данных каждый час
- **daily-report** - ежедневный отчет в 9:00

## 📈 Аналитика

Бот автоматически:
- Сопоставляет кампании Facebook с платежами Stripe
- Рассчитывает ROI по кампаниям
- Генерирует отчеты о производительности
- Обновляет данные в Google Sheets

## 🛠️ Разработка

```bash
# Режим разработки с автоперезагрузкой
npm run dev

# Запуск в продакшене
npm start
```

## 📝 Логи

Все действия логируются в консоль с эмодзи для удобства:
- 🚀 Запуск
- ✅ Успех
- ❌ Ошибка
- 🔄 Процесс
- 📊 Отчет
