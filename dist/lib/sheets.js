import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { ENV } from './env.js';
let doc = null;
async function getDoc() {
    if (doc)
        return doc;
    const serviceAccountAuth = new JWT({
        email: ENV.GOOGLE_SERVICE_EMAIL,
        key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}
const HEADER = [
    'created_at', 'session_id', 'payment_status', 'amount', 'currency', 'email', 'country', 'gender', 'age',
    'product_tag', 'creative_link',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'platform_placement', 'ad_name', 'adset_name', 'campaign_name', 'web_campaign',
    'customer_id', 'client_reference_id', 'mode', 'status', 'raw_metadata_json'
];
// Проверка существования платежа в Google Sheets
async function paymentExists(sheet, sessionId) {
    try {
        const rows = await sheet.getRows();
        return rows.some((row) => row.get('session_id') === sessionId);
    }
    catch (error) {
        console.error('Error checking payment existence:', error);
        return false;
    }
}
export async function appendPaymentRow(session) {
    try {
        const d = await getDoc();
        let sheet = d.sheetsByTitle['payments'];
        if (!sheet) {
            sheet = await d.addSheet({ title: 'payments', headerValues: HEADER });
        }
        else {
            // ensure headers at least once
            if (sheet.headerValues?.length !== HEADER.length) {
                await sheet.setHeaderRow(HEADER);
            }
        }
        // ПРОВЕРКА НА ДУБЛИКАТЫ - ключевое исправление!
        const exists = await paymentExists(sheet, session.id);
        if (exists) {
            console.log('⏭️ Payment already exists in Google Sheets, skipping:', session.id);
            return;
        }
        const m = session.metadata || {};
        const email = session.customer_details?.email || session.customer_email || '';
        const amount = (session.amount_total ?? 0) / 100;
        const currency = (session.currency || 'usd').toUpperCase();
        const country = m.country || session.customer_details?.address?.country || '';
        const row = {
            created_at: new Date((session.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
            session_id: session.id,
            payment_status: session.payment_status || '',
            amount,
            currency,
            email,
            country,
            gender: m.gender || '',
            age: m.age || '',
            product_tag: m.product_tag || '',
            creative_link: m.creative_link || '',
            utm_source: m.utm_source || '',
            utm_medium: m.utm_medium || '',
            utm_campaign: m.utm_campaign || '',
            utm_content: m.utm_content || '',
            utm_term: m.utm_term || '',
            platform_placement: m.platform_placement || '',
            ad_name: m.ad_name || '',
            adset_name: m.adset_name || '',
            campaign_name: m.campaign_name || '',
            web_campaign: m.web_campaign || '',
            customer_id: session.customer || '',
            client_reference_id: session.client_reference_id || '',
            mode: session.mode || '',
            status: session.status || '',
            raw_metadata_json: JSON.stringify(m)
        };
        await sheet.addRow(row);
        console.log('✅ Payment data saved to Google Sheets:', session.id);
    }
    catch (error) {
        console.error('Error saving to Google Sheets:', error);
        // Fallback: log to console if Google Sheets fails
        console.log('Google Sheets error - payment data:', {
            session_id: session.id,
            amount: (session.amount_total ?? 0) / 100,
            currency: session.currency,
            email: session.customer_details?.email || session.customer_email
        });
    }
}
