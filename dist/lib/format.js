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
export function formatTelegram(session, customerMetadata = {}) {
    const m = { ...session.metadata, ...customerMetadata };
    const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
    const currency = (session.currency || 'usd').toUpperCase();
    const pm = session.payment_method_types?.[0] || 'card';
    const email = session.customer_details?.email || session.customer_email || '';
    const product_tag = m.product_tag || 'N/A';
    const orderId = session.id.slice(3, 14);
    const country = m.geo_country || m.country || session.customer_details?.address?.country || 'N/A';
    const gender = m.gender || 'N/A';
    const age = m.age || 'N/A';
    const creative_link = m.creative_link || 'N/A';
    const utm_source = m.utm_source || 'N/A';
    const platform_placement = m.platform_placement || 'N/A';
    const ad_name = m.ad_name || 'N/A';
    const adset_name = m.adset_name || 'N/A';
    const campaign_name = m.campaign_name || m.utm_campaign || 'N/A';
    const lines = [
        `🟢 Order ${orderId} was processed!`,
        `---------------------------`,
        `💳 ${pm}`,
        `💰 ${amount} ${currency}`,
        `🏷️ ${product_tag}`,
        `---------------------------`,
        `📧 ${email}`,
        `---------------------------`,
        `🌪️ ${orderId}`,
        `📍 ${country}`,
        `🧍${gender} ${age}`,
        `🔗 ${creative_link}`,
        `${utm_source}`,
        `${platform_placement}`,
        `${ad_name}`,
        `${adset_name}`,
        `${campaign_name}`
    ];
    let text = lines.join('\n');
    if (text.length > 4096)
        text = text.slice(0, 4093) + '...';
    return text;
}
