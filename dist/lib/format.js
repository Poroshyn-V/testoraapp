export function maskEmail(email) {
    if (!email)
        return '-';
    const [u, d] = email.split('@');
    if (!d)
        return email;
    const maskedLocal = u.length <= 1 ? '*' : u[0] + '*'.repeat(Math.max(1, u.length - 1));
    return `${maskedLocal}@${d}`;
}
export function shortId(id) {
    if (!id)
        return '-';
    return id.slice(0, 7) + '...';
}
export function formatTelegram(session) {
    const m = session.metadata || {};
    const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
    const currency = (session.currency || 'usd').toUpperCase();
    const pm = session.payment_method_types?.[0] || 'card';
    const email = session.customer_details?.email || session.customer_email || '';
    const masked = maskEmail(email);
    const product_tag = m.product_tag || '';
    const utm_campaign = m.utm_campaign || '-';
    const country = m.country || session.customer_details?.address?.country || '-';
    const genderAge = [m.gender || '', m.age || ''].filter(Boolean).join(' ') || '-';
    const creative_link = m.creative_link || '-';
    const platform_placement = m.platform_placement || '-';
    const ad_name = m.ad_name || '-';
    const adset_name = m.adset_name || '-';
    const campaign_name = m.campaign_name || '-';
    const web_campaign = m.web_campaign || '-';
    const lines = [
        `🟢 Order ${shortId(session.id)} processed!`,
        `---------------------------`,
        `💳 ${pm}`,
        `💰 ${amount} ${currency}`,
        `🏷️ ${product_tag}`,
        `---------------------------`,
        `📧 ${masked}`,
        `---------------------------`,
        `🌪️ ${utm_campaign}`,
        `📍 ${country}`,
        `🧍 ${genderAge}`,
        `🔗 ${creative_link}`,
        `fb`,
        `${platform_placement}`,
        `${ad_name}`,
        `${adset_name}`,
        `${campaign_name}`,
        // В исходном примере дальше не выводили web_campaign; при желании добавь:
        // `${web_campaign}`
    ];
    let text = lines.join('\n');
    if (text.length > 4096)
        text = text.slice(0, 4093) + '...';
    return text;
}
