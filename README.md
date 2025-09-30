# stripe-ops (Stripe → Telegram + Google Sheets)

Realtime уведомления об оплатах из Stripe в Telegram и запись полной информации в Google Sheets.

## Что делает
- Принимает `checkout.session.completed` вебхук Stripe (с проверкой подписи).
- Формирует **сообщение для Telegram** строго по шаблону:
  ```
  🟢 Order <first7>... processed!
  ---------------------------
  💳 card
  💰 19.99 USD
  🏷️ 30_30D_USD_20_46
  ---------------------------
  📧 email@user.com
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
- Пишет полные данные в Google Sheets (лист `payments`).

## Быстрый старт (локально)
1. Скопируйте `.env.example` → `.env` и заполните:
   - `STRIPE_SECRET_KEY` — секретный ключ Stripe
   - `STRIPE_WEBHOOK_SECRET` — секрет вебхука (после создания endpoint в Stripe)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `GOOGLE_SHEETS_DOC_ID`, `GOOGLE_SERVICE_EMAIL`, `GOOGLE_SERVICE_PRIVATE_KEY`
2. Дайте сервисному аккаунту доступ **Editor** к вашему Spreadsheet (`GOOGLE_SHEETS_DOC_ID`).
3. Установите зависимости и запустите сервер:
   ```bash
   npm i
   npm run dev
   ```
4. В другом терминале запустите Stripe CLI для проксирования вебхука:
   ```bash
   stripe listen --forward-to localhost:3000/webhook/stripe
   ```
5. Выполните тестовую оплату (Checkout Session). Должно прийти сообщение в TG и появиться строка в листе `payments`.

## Деплой
- **Vercel/Render/Cloud Run** — добавьте ENV из `.env.example`.
- В Stripe Dashboard создайте webhook endpoint `https://<your-domain>/webhook/stripe`,
  подпишитесь на `checkout.session.completed`, получите секрет — присвойте `STRIPE_WEBHOOK_SECRET`.

## Важно (безопасность)
- Никогда не коммитьте .env в репозиторий.
- Ротируйте ключи при подозрении на компрометацию.
- Email маскируется в Telegram, а в таблицу пишется полный — при желании можете менять логику.

## Поля в Google Sheets
Заголовки:
```
created_at, session_id, payment_status, amount, currency, email, country, gender, age,
product_tag, creative_link,
utm_source, utm_medium, utm_campaign, utm_content, utm_term,
platform_placement, ad_name, adset_name, campaign_name, web_campaign,
customer_id, client_reference_id, mode, status, raw_metadata_json
```
