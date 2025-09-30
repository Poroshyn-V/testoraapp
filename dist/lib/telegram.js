import fetch from 'node-fetch';
import { ENV } from './env.js';
export async function sendTelegram(text) {
    const url = `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = {
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Telegram error: ${res.status} ${t}`);
    }
}
