# 🧪 РУЧНОЙ ТЕСТ GOOGLE SHEETS

## 📊 **СОЗДАНИЕ ТЕСТОВОЙ СТРУКТУРЫ**

### 1️⃣ **Откройте Google Sheets:**
- Перейдите: [docs.google.com/spreadsheets/d/146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4](https://docs.google.com/spreadsheets/d/146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4)

### 2️⃣ **Создайте лист "payments":**
- **Правый клик** на вкладку → **"Insert sheet"**
- **Название**: `payments`

### 3️⃣ **Добавьте заголовки в первую строку:**

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R | S | T | U | V | W | X | Y | Z |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| created_at | session_id | payment_status | amount | currency | email | country | gender | age | product_tag | creative_link | utm_source | utm_medium | utm_campaign | utm_content | utm_term | platform_placement | ad_name | adset_name | campaign_name | web_campaign | customer_id | client_reference_id | mode | status | raw_metadata_json |

### 4️⃣ **Добавьте тестовую строку:**

| created_at | session_id | payment_status | amount | currency | email | country | gender | age | product_tag | creative_link | utm_source | utm_medium | utm_campaign | utm_content | utm_term | platform_placement | ad_name | adset_name | campaign_name | web_campaign | customer_id | client_reference_id | mode | status | raw_metadata_json |
|------------|-------------|----------------|--------|----------|-------|---------|--------|-----|-------------|---------------|------------|------------|--------------|-------------|----------|-------------------|---------|------------|---------------|--------------|-------------|-------------------|------|--------|-------------------|
| 2024-01-29T12:00:00.000Z | test_session_12345 | paid | 99.99 | USD | test@example.com | US | male | 25-34 | premium | https://example.com/creative | facebook | social | summer_sale | video_ad | premium_product | feed | Summer Sale Video | Premium Users | Summer Campaign 2024 | summer_2024 | cus_test123 | ref_12345 | payment | complete | {"test":true,"source":"manual_test","created_by":"system"} |

---

## 🎯 **ПРОВЕРКА СИСТЕМЫ:**

### ✅ **После создания структуры:**
1. **Протестируйте Stripe webhook** в Render
2. **Проверьте Telegram** - должно прийти уведомление
3. **Проверьте Slack** - должно прийти уведомление  
4. **Проверьте Google Sheets** - должна появиться новая строка

### 📋 **Ожидаемый результат:**
- ✅ **Telegram**: Уведомление в группе `Valerii & Testora`
- ✅ **Slack**: Уведомление в канале `#testora_payments`
- ✅ **Google Sheets**: Новая строка с данными платежа

---

## 🚀 **СИСТЕМА ГОТОВА К ТЕСТИРОВАНИЮ!**

**Создайте структуру в Google Sheets и протестируйте webhook!** 🧪
