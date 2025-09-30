import dotenv from 'dotenv';
dotenv.config();
function requireEnv(name) {
    const v = process.env[name];
    if (!v || !v.trim()) {
        throw new Error(`Missing required env: ${name}`);
    }
    return v;
}
export const ENV = {
    STRIPE_SECRET_KEY: requireEnv('STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: requireEnv('STRIPE_WEBHOOK_SECRET'),
    TELEGRAM_BOT_TOKEN: requireEnv('TELEGRAM_BOT_TOKEN'),
    TELEGRAM_CHAT_ID: requireEnv('TELEGRAM_CHAT_ID'),
    GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID || '',
    GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL || '',
    GOOGLE_SERVICE_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    PORT: Number(process.env.PORT || 3000)
};
