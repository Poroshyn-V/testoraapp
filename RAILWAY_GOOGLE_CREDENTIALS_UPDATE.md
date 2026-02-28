# Инструкция по обновлению Google OAuth Credentials в Railway

## Проблема
Если синхронизация не работает из-за истекших или невалидных Google OAuth токенов, нужно обновить credentials в Railway.

## Шаг 1: Получение новых credentials из Google Cloud Console

1. Откройте [Google Cloud Console](https://console.cloud.google.com/)
2. Выберите ваш проект
3. Перейдите в **APIs & Services** → **Credentials**
4. Найдите ваш Service Account (email должен совпадать с `GOOGLE_SERVICE_EMAIL`)
5. Нажмите на Service Account
6. Перейдите на вкладку **Keys**
7. Нажмите **Add Key** → **Create new key**
8. Выберите формат **JSON**
9. Скачайте JSON файл

## Шаг 2: Извлечение данных из JSON

Откройте скачанный JSON файл. Вам понадобятся:

```json
{
  "type": "service_account",
  "project_id": "...",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "your-service-account@project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "...",
  "token_uri": "...",
  ...
}
```

**Важно:**
- `client_email` → это ваш `GOOGLE_SERVICE_EMAIL`
- `private_key` → это ваш `GOOGLE_SERVICE_PRIVATE_KEY` (сохраняйте с переносами строк `\n`)

## Шаг 3: Обновление в Railway

### Вариант A: Через Railway Dashboard

1. Откройте ваш проект в [Railway Dashboard](https://railway.app/)
2. Перейдите в **Variables** (или **Settings** → **Variables**)
3. Найдите следующие переменные:
   - `GOOGLE_SERVICE_EMAIL`
   - `GOOGLE_SERVICE_PRIVATE_KEY`
   - `GOOGLE_SHEETS_DOC_ID` (если нужно обновить)

4. Обновите значения:
   - **GOOGLE_SERVICE_EMAIL**: Вставьте значение `client_email` из JSON
   - **GOOGLE_SERVICE_PRIVATE_KEY**: Вставьте значение `private_key` из JSON
     - ⚠️ **ВАЖНО**: Сохраняйте переносы строк! Ключ должен содержать `\n`
     - Railway автоматически экранирует переносы строк, но убедитесь что ключ полный

5. Нажмите **Save** или **Deploy**

### Вариант B: Через Railway CLI

```bash
# Установите Railway CLI если еще не установлен
npm i -g @railway/cli

# Войдите в Railway
railway login

# Выберите проект
railway link

# Установите переменные
railway variables set GOOGLE_SERVICE_EMAIL="your-service-account@project.iam.gserviceaccount.com"
railway variables set GOOGLE_SERVICE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Шаг 4: Проверка доступа к Google Sheets

После обновления credentials:

1. Убедитесь, что Service Account имеет доступ к Google Sheets документу:
   - Откройте ваш Google Sheets документ
   - Нажмите **Share** (Поделиться)
   - Добавьте email из `GOOGLE_SERVICE_EMAIL` с правами **Editor** (Редактор)

2. Запустите скрипт проверки локально (если есть доступ к .env):
   ```bash
   node check-google-credentials.js
   ```

3. Или проверьте через API после деплоя:
   ```bash
   curl https://your-app.railway.app/api/sync-diagnostics
   ```

## Шаг 5: Перезапуск приложения

После обновления переменных:

1. Railway автоматически перезапустит приложение
2. Или вручную: **Settings** → **Restart**

## Проверка работы

После перезапуска проверьте логи:

```bash
# В Railway Dashboard → Deployments → View Logs
# Ищите:
✅ Google Sheets initialized successfully
✅ Loaded X existing rows from LowPrice sheet
✅ Loaded X existing rows from Primer sheet
```

## Частые проблемы

### Проблема: "Invalid credentials"
- **Решение**: Убедитесь, что `private_key` содержит полный ключ с `\n` переносами строк
- Проверьте, что ключ начинается с `-----BEGIN PRIVATE KEY-----` и заканчивается `-----END PRIVATE KEY-----`

### Проблема: "Access denied"
- **Решение**: Убедитесь, что Service Account email добавлен в Google Sheets с правами Editor

### Проблема: "Token expired"
- **Решение**: После обновления credentials токены должны обновляться автоматически
- Если проблема сохраняется, проверьте сетевые подключения к `oauth2.googleapis.com`

## Дополнительная диагностика

Используйте эндпоинт диагностики:
```
GET /api/sync-diagnostics
```

Он покажет:
- Статус синхронизации
- Проблемы с конфигурацией
- Ошибки токенов
- Рекомендации по исправлению
