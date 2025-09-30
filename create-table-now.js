import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

async function createTableNow() {
  try {
    console.log('🚀 СОЗДАЮ ТАБЛИЦУ ПРЯМО СЕЙЧАС...');
    
    const doc = new GoogleSpreadsheet('146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4');
    
    // Аутентификация
    const serviceAccountAuth = new JWT({
      email: 'stripe-ops-service@stripe-ops-service.iam.gserviceaccount.com',
      key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCxVOH92yxe/KkP
5RIcShxh10cxtWOtBw8cjP4XAPDK1YMAo2A+YRRCBzNA5DOSdeMRbHz4QOMbVuzB
954T8bHKHPtnGmPAM17Ts9e1FkIrYaUd1ZxdS5yw1/RtUPvm69H2JUYjrGSGU1a+
P65fe5l8NeU9w1TVbUujn0UbHS/ZdLUUlEp4CU5lg8uKS/z3Iz3egPhgdoM9cKwi
pOWDT27T2UMfIO4uFK04fs2/VZUDonSj1v8SMac7ejecKmXeQTijQmroR78ZM0ON
23jdLLndAsQu2g3Ps90UKmDhozhPVFUS+a4/fWF7ERTNT8m+M1CZkEZCpgE/jpoV
emILOtyNAgMBAAECggEAC8ARYnoU/a1LFuB0UQIQe+OL1jghT5w1t4wDI9Xo3rPY
+fWZbBYQMCjceqVfDR/Oc5TcpLGIqu2EA31Le6Gqs3cJ/zoL1+GU3BJ2YwuDcm7x
BeH7OguyKV4B661vp6HteByJAiuglJhYmYN24+D42ba+MYJsMGE333LEsugonRrG
xvw6LRF2+XrCj4NOXx1WPjQeehD2fk2Ad8lyTip37zWB59uxs1QS6USNG3P3JKDV
t4Oh0WrjdEaW6Velc2Mv5NFOpUgOoctbdTR3l60u59Yf3/+ud2WRqK6IVem0NXx
8mP4xhRNb09ql0SljygxbccBbmBcha+csTeyNRdyqQKBgQDvwOOiwtcWRfSHfxf5
ahQin+SC+2AY9A+YmvZfjb6Y30gfA+a3uodcOgu2RHhS4cub5RbWM/LAc5LWn34M
2lS6Y4UsrPh9EahK+ikoQU/aKXZ5QzE0IwXnlN8+fRacEZuAsIUHvQGXogM8yYgd
UT3XXgH6VrH+si0dSBO4DGGaSQKBgQC9WSIIeSu2YpK8k+YhrgAY1wXIoLcY+3sE
ueDzU5diHGRP0lQX+27ODaL451rE9DAWjKu2kA6nxdONGOM3sWEhOMHgnH08dZcl
nXP43l1zLXgONcQzOXsAjVuqDgWc4qlc5UDWZQXt/3WsHWPZnQYGIKJBA0uXuuhe
rvgdk6MQJQKBgDNSeigkR0CoVvEOXsZwU8EZsyPqxaZx0EjdmzHXON6mpVymTCQ2
VLWEY29v9sXfOeO0RZAy7JsP4nX5DFWaAxsnJKHsoQC83+a06EyKtpo/1/GbVZQQ
jzoEn0lUI5vjFQOWRdPjPM0FzGWdynpkIrXQlOHO3yljYM7s1/PFCrupAoGBALfk
tiHmlKaYi4xsU4gINn3pbuuP8uNnce2AHVIUsCSQEHhZfGSiQ9YI9muoPcakpYNw
8V/n/uPARJp3Pk2bjwq11c2wDg1G4xmcFsLwK3AuC7g5Tai2PZimsQyye48Hr5bR
7CuMh7rCbOVQ0eXKE8ylqw9bBPKCiyVR5xTKiwalAoGALOUxeJ32JcixOtt+HBOD
cnm14OJfAWiKFDWnywP6VJW1w2KJ5k/GjZ+kYFZM6+wJHnRoysCDfpG39FUqtLf6
CLR51/cPiFxKMNRWbRpTSH4/5n1s4Aa2hM2yl/QTS3b6CJ7s3YcZ+VhYJaL5evy4
Vx/2A8IvD9aRB/0xLzbArFA=
-----END PRIVATE KEY-----`,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    await doc.useServiceAccountAuth(serviceAccountAuth);
    await doc.loadInfo();
    
    console.log('✅ Подключение успешно!');
    
    // Создаем лист payments
    const sheet = await doc.addSheet({ 
      title: 'payments',
      headerValues: [
        'created_at', 'session_id', 'payment_status', 'amount', 'currency', 'email', 'country', 'gender', 'age',
        'product_tag', 'creative_link',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'platform_placement', 'ad_name', 'adset_name', 'campaign_name', 'web_campaign',
        'customer_id', 'client_reference_id', 'mode', 'status', 'raw_metadata_json'
      ]
    });
    
    console.log('✅ Лист "payments" создан!');
    
    // Добавляем тестовую строку
    await sheet.addRow({
      created_at: new Date().toISOString(),
      session_id: 'test_session_12345',
      payment_status: 'paid',
      amount: 99.99,
      currency: 'USD',
      email: 'test@example.com',
      country: 'US',
      gender: 'male',
      age: '25-34',
      product_tag: 'premium',
      creative_link: 'https://example.com/creative',
      utm_source: 'facebook',
      utm_medium: 'social',
      utm_campaign: 'summer_sale',
      utm_content: 'video_ad',
      utm_term: 'premium_product',
      platform_placement: 'feed',
      ad_name: 'Summer Sale Video',
      adset_name: 'Premium Users',
      campaign_name: 'Summer Campaign 2024',
      web_campaign: 'summer_2024',
      customer_id: 'cus_test123',
      client_reference_id: 'ref_12345',
      mode: 'payment',
      status: 'complete',
      raw_metadata_json: JSON.stringify({
        test: true,
        source: 'manual_test',
        created_by: 'system'
      })
    });
    
    console.log('✅ Тестовая строка добавлена!');
    console.log('🎉 ТАБЛИЦА СОЗДАНА УСПЕШНО!');
    console.log('🔗 https://docs.google.com/spreadsheets/d/146BkDpmFiw1NWhXMXWcyWFuE2GW1OeTSNIrmgrK3AU4');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

createTableNow();
