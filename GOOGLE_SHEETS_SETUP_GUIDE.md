# 🎯 **СОЗДАНИЕ СТРУКТУРЫ GOOGLE SHEETS**

## 📊 **ШАГ 1: ОТКРОЙТЕ GOOGLE SHEETS**

**Ссылка:** [docs.google.com/spreadsheets/d/146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4](https://docs.google.com/spreadsheets/d/146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4)

---

## 📝 **ШАГ 2: СОЗДАЙТЕ ЛИСТ "payments"**

1. **Правый клик** на вкладку внизу
2. **"Insert sheet"** → **"Insert new sheet"**
3. **Название**: `payments`
4. **Нажмите Enter**

---

## 📋 **ШАГ 3: ДОБАВЬТЕ ЗАГОЛОВКИ В ПЕРВУЮ СТРОКУ**

**Скопируйте и вставьте в ячейки A1-Z1:**

```
created_at	session_id	payment_status	amount	currency	email	country	gender	age	product_tag	creative_link	utm_source	utm_medium	utm_campaign	utm_content	utm_term	platform_placement	ad_name	adset_name	campaign_name	web_campaign	customer_id	client_reference_id	mode	status	raw_metadata_json
```

---

## 🧪 **ШАГ 4: ДОБАВЬТЕ ТЕСТОВУЮ СТРОКУ**

**Скопируйте и вставьте в ячейки A2-Z2:**

```
2024-01-29T12:00:00.000Z	test_session_12345	paid	99.99	USD	test@example.com	US	male	25-34	premium	https://example.com/creative	facebook	social	summer_sale	video_ad	premium_product	feed	Summer Sale Video	Premium Users	Summer Campaign 2024	summer_2024	cus_test123	ref_12345	payment	complete	{"test":true,"source":"manual_test","created_by":"system"}
```

---

## ✅ **ШАГ 5: ПРОВЕРЬТЕ РЕЗУЛЬТАТ**

**Должна получиться таблица:**

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R | S | T | U | V | W | X | Y | Z |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| created_at | session_id | payment_status | amount | currency | email | country | gender | age | product_tag | creative_link | utm_source | utm_medium | utm_campaign | utm_content | utm_term | platform_placement | ad_name | adset_name | campaign_name | web_campaign | customer_id | client_reference_id | mode | status | raw_metadata_json |
| 2024-01-29T12:00:00.000Z | test_session_12345 | paid | 99.99 | USD | test@example.com | US | male | 25-34 | premium | https://example.com/creative | facebook | social | summer_sale | video_ad | premium_product | feed | Summer Sale Video | Premium Users | Summer Campaign 2024 | summer_2024 | cus_test123 | ref_12345 | payment | complete | {"test":true,"source":"manual_test","created_by":"system"} |

---

## 🎉 **ГОТОВО!**

**После создания структуры:**
1. ✅ **Протестируйте Stripe webhook**
2. ✅ **Проверьте Telegram уведомления**
3. ✅ **Проверьте Slack уведомления**
4. ✅ **Проверьте Google Sheets** - должна появиться новая строка

**Система полностью готова к работе!** 🚀
