# 📋 Инструкция: Настройка Primer API для PayPal платежей

## 🎯 Что нужно сделать

Настроить выгрузку данных из **Primer API** (PayPal платежи) в **отдельный лист "Primer"** Google Sheets.

---

## ⚙️ Шаг 1: Получить API ключ от Primer

### Вариант 1: Через Primer Dashboard

1. **Войдите в Primer Dashboard:**
   - Откройте [https://dashboard.primer.io/](https://dashboard.primer.io/)
   - Авторизуйтесь используя свои учетные данные

2. **Перейдите в раздел Developers:**
   - В меню найдите раздел **"Developers"** или **"Settings"** → **"API Keys"**
   - Если не видите раздел Developers, попробуйте **"Settings"** → **"API Keys"** или **"Integrations"** → **"API Keys"**

3. **Создайте или найдите API ключ:**
   - Если ключа еще нет, нажмите **"Create API Key"** или **"Generate New Key"**
   - Если ключ уже есть, найдите его в списке

4. **Настройте права доступа (scopes):**
   Для работы с captures (завершенными платежами) нужны следующие права:
   - ✅ `transactions:read` - чтение транзакций
   - ✅ `transactions:capture` - просмотр captures
   - ✅ `payment_instrument:read` - чтение платежных методов
   
   **Важно:** Не давайте больше прав, чем нужно!

5. **Скопируйте API ключ:**
   - После создания ключ будет показан только один раз!
   - Скопируйте его сразу и сохраните в безопасном месте
   - Ключ будет выглядеть примерно так: `primer_live_1234567890abcdef` или `pk_live_...`

### Вариант 2: Через Primer API (если есть доступ)

Если у вас уже есть доступ к Primer API, вы можете использовать существующий ключ.

**Важно:** 
- API ключи предоставляют значительные привилегии
- Храните их в безопасности
- НЕ коммитьте ключи в git!
- Используйте только на серверной стороне

### Где искать API ключ в Dashboard:

Если не можете найти раздел "Developers", попробуйте:

1. **Settings** → **API Keys** (самый частый вариант)
2. **Integrations** → **API Keys**
3. **Account Settings** → **API Keys**
4. **Developer Tools** → **API Keys**
5. В боковом меню поищите раздел **"API"** или **"Developers"**

### Как проверить, что ключ работает:

После получения ключа можно проверить его через API:

```bash
curl -X GET 'https://api.primer.io/v1/captures' \
  --header 'X-Api-Key: ваш_api_ключ'
```

**Ожидаемые результаты:**
- ✅ **200 OK** с данными - ключ работает!
- ✅ **401 Unauthorized** - ключ неверный или нет прав
- ✅ **404 Not Found** - возможно, endpoint другой (нужно проверить документацию Primer)
- ✅ **403 Forbidden** - ключ правильный, но нет прав на этот endpoint

**Примечание:** Если получаете ошибку 404, возможно endpoint `/v1/captures` неверный. Нужно проверить документацию Primer API для вашей версии API.

### Если не можете найти API ключ:

1. **Обратитесь в поддержку Primer:**
   - Email: support@primer.io
   - Или через чат в Dashboard

2. **Проверьте документацию:**
   - [Primer API Documentation](https://primer.io/docs)
   - Раздел "Authentication" или "Getting Started"

3. **Проверьте, есть ли у вас доступ:**
   - Возможно, нужны дополнительные права в аккаунте
   - Или аккаунт еще не активирован для API доступа

---

## 📝 Шаг 2: Добавить ключ в .env файл

Откройте файл `.env` в корне проекта и добавьте:

```bash
# Primer API для PayPal платежей
PRIMER_API_KEY=ваш_api_ключ_здесь
PRIMER_API_URL=https://api.primer.io
PRIMER_SHEET_NAME=Primer
```

**Пример:**
```bash
PRIMER_API_KEY=77615311-ca46-4776-bcbd-5fc24bab510f
PRIMER_API_URL=https://api.primer.io
PRIMER_API_VERSION=2.4
PRIMER_SHEET_NAME=Primer
```

**Важно:** 
- Используйте ваш реальный API ключ (не коммитьте его в git!)
- Версия API должна быть `2.4` (обязательно)

---

## ✅ Шаг 3: Проверить настройки Google Sheets

Убедитесь, что в `.env` файле есть:

```bash
GOOGLE_SHEETS_DOC_ID=ваш_id_таблицы
GOOGLE_SERVICE_EMAIL=ваш_service_account_email
GOOGLE_SERVICE_PRIVATE_KEY=ваш_приватный_ключ
```

*(Эти настройки уже должны быть, если основной бот работает)*

---

## 🚀 Шаг 4: Запустить выгрузку

### Вариант 1: Однократная выгрузка (вручную)

```bash
curl -X POST http://localhost:3000/api/sync-primer-payments
```

Или через браузер:
```
http://your-domain.com/api/sync-primer-payments
```

### Вариант 2: Автоматическая выгрузка

Синхронизация Primer запускается **автоматически** вместе с основной синхронизацией каждые 5 минут (если настроен `AUTO_SYNC`).

---

## 📊 Что делает система

1. ✅ Подключается к **Primer API**
2. ✅ Получает все **captures** (завершенные платежи) за последние 7 дней
3. ✅ Извлекает данные из **metadata** каждого capture:
   - `customer_id` - ID клиента
   - `purchase_id` - ID покупки
   - `subscription_id` - ID подписки (если есть)
   - `utm_source`, `utm_campaign`, `utm_content` - UTM параметры
   - `utm_ad_name`, `utm_adset_name` - данные рекламы
   - `email` - email клиента
   - И другие данные из metadata
4. ✅ Проверяет, какие платежи уже есть в таблице
5. ✅ Добавляет **только новые платежи** в лист **"Primer"**
6. ✅ Автоматически создает лист, если его нет
7. ✅ Отправляет уведомления в Telegram/Slack для новых покупок

---

## 📋 Структура данных в листе "Primer"

Лист будет содержать следующие колонки (аналогично другим листам):

- **Purchase ID** - ID покупки (purchase_{customer_id})
- **Created UTC** - Дата создания (UTC)
- **Created Local (LA Time)** - Дата создания (LA Time)
- **Payment Intent IDs** - ID платежа из Primer
- **Total Amount** - Сумма платежа
- **Currency** - Валюта
- **Email** - Email клиента
- **GEO** - Геолокация
- **UTM Source** - Источник трафика
- **UTM Medium** - Канал трафика
- **UTM Campaign** - Название кампании
- **UTM Content** - Контент креатива
- **Ad Name** - Название объявления
- **Adset Name** - Название группы объявлений
- **Campaign Name** - Название кампании
- **Customer ID** - ID клиента из Primer metadata
- **Payment Method** - Способ оплаты (PayPal)
- **Status** - Статус платежа
- **Raw Metadata JSON** - Все metadata в JSON формате

---

## 🔄 Интеграция с существующей системой

### Отчеты включают данные Primer:

1. **Hourly Report** - включает покупки из Primer листа
2. **Creative Alert** - включает креативы из Primer
3. **Real-time Alerts** - отслеживает горячие кампании из Primer
4. **Campaign Analysis** - анализирует кампании из Primer

### Уведомления:

- ✅ Telegram уведомления для новых Primer покупок
- ✅ Slack уведомления с меткой "Primer (PayPal)"
- ✅ Формат уведомлений идентичен Stripe покупкам

---

## ⚠️ Важные моменты

1. **Не перезаписывает данные** - если платеж уже есть, он не будет добавлен повторно
2. **Только успешные платежи** - обрабатываются только captures со статусом:
   - `COMPLETED`
   - `FINAL_CAPTURE`
   - `SUBMITTED_FOR_CAPTURE`
3. **Автоматическое создание листа** - если листа "Primer" нет, он будет создан автоматически
4. **Та же таблица** - использует ту же Google Sheets таблицу, что и основной бот (просто другой лист!)
5. **Безопасность** - ключи хранятся только в `.env` файле (не коммитьте его в git!)
6. **Не ломает существующую логику** - Primer данные в отдельном листе, не влияют на другие листы

---

## 🔍 Проверка результата

После запуска синхронизации:

1. Откройте вашу Google Sheets таблицу (ту же самую, где основной лист с покупками)
2. Найдите лист **"Primer"** (или то название, которое вы указали)
3. Проверьте, что данные добавились
4. Проверьте уведомления в Telegram/Slack

**Важно:** Система использует **ту же самую таблицу Google Sheets**, что и основной бот, но создает/использует отдельный лист "Primer"!

---

## 📡 Primer API Endpoints

Система использует следующие endpoints Primer API v2.4:

- `GET /payments` - получение всех payments (завершенных платежей)
- Документация: https://primer.io/docs/api-reference/v2.4/api-reference/payments-api/search-&-list-payments
- Фильтрация по `customer_id` через query параметр
- Фильтрация по статусу: `SETTLED,AUTHORIZED` (только успешные)
- Фильтрация по датам через `from_date` и `to_date`
- Фильтрация по `application = "testora"` в metadata

**Примечание:** Если структура Primer API отличается, можно настроить endpoints в файле `src/services/primer.js`

---

## ❓ Если что-то не работает

### Ошибка: "Primer API key not configured"
→ Проверьте, что добавили `PRIMER_API_KEY` в `.env` файл

### Ошибка: "Google Sheets not configured"
→ Проверьте настройки `GOOGLE_SHEETS_DOC_ID`, `GOOGLE_SERVICE_EMAIL`, `GOOGLE_SERVICE_PRIVATE_KEY`

### Ошибка: "Primer API error: 401 Unauthorized"
→ Проверьте правильность API ключа Primer
→ Убедитесь, что используете заголовок `X-Api-Key` (не `Authorization: Bearer`)
→ Проверьте, что у API ключа есть права `transactions:read` и `transactions:capture`

### Ошибка: "Primer API error: 404 Not Found"
→ Endpoint должен быть `/payments` (не `/v1/payments`!)
→ Убедитесь, что используете правильный URL: `https://api.primer.io/payments`
→ Проверьте документацию: https://primer.io/docs/api-reference/v2.4/api-reference/payments-api/search-&-list-payments

### Ошибка: "COMPLETED is invalid"
→ Статус `COMPLETED` не существует в Primer API
→ Используйте только: `SETTLED,AUTHORIZED` для успешных платежей
→ Код уже обновлен с правильными статусами

### Ошибка: "Primer API error: 403 Forbidden"
→ У API ключа нет прав на чтение captures
→ Нужно добавить права `transactions:read` в настройках API ключа

### Нет данных в листе Primer
→ Проверьте логи синхронизации. Возможно, нет новых captures за последние 7 дней, или все платежи уже были добавлены ранее.
→ Проверьте, что captures имеют статус "Final capture" или "Submitted for capture"
→ Убедитесь, что в captures есть `metadata.customer_id`

### Не могу найти API ключ в Dashboard
→ Обратитесь в поддержку Primer: support@primer.io
→ Проверьте, есть ли у вашего аккаунта доступ к API
→ Возможно, нужны дополнительные права администратора

---

## 🎉 Готово!

После настройки вы сможете:
- ✅ Выгружать данные из Primer API (PayPal платежи)
- ✅ Хранить их в отдельном листе "Primer"
- ✅ Получать уведомления о новых PayPal покупках
- ✅ Видеть данные Primer в отчетах и аналитике
- ✅ Отслеживать все платежи в единой системе

**Вопросы?** Проверьте логи синхронизации - там будет подробная информация о процессе выгрузки!

---

## 📚 Дополнительная информация

### Структура Primer Capture Response

Пример данных из Primer API:

```json
{
  "id": "capture_123",
  "status": "FINAL_CAPTURE",
  "amount": 999,
  "currency": "USD",
  "createdAt": "2025-12-24T23:02:31Z",
  "metadata": {
    "customer_id": "926236a0-f2e9-4af6-ac42-d82a8c57cd0e",
    "purchase_id": "11816959",
    "subscription_id": "sub_d565981rcb4c8851is10",
    "utm_source": "axon",
    "utm_campaign": "Testora_WEB_T1_Test-003-FL-ROAS_apl_11.12.2025",
    "utm_content": "2_183_6111_Testora_m_var_n-a-_IQ_IH_IQ1_En_9x16_KA.mp4",
    "utm_medium": "paid",
    "utm_ad_name": "...",
    "utm_adset_name": "...",
    "email": "customer@example.com"
  }
}
```

Система автоматически извлекает все эти данные и записывает в Google Sheets.

