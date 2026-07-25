import { ENV } from '../config/env.js';
import { logInfo, logWarn } from '../utils/logging.js';

// Meta Marketing API client for spend alerts.
// Configured via FB_ACCESS_TOKEN; ad accounts either come from
// FB_AD_ACCOUNT_IDS (comma-separated act_XXX) or are auto-discovered
// as active accounts whose name contains "Testora".

const GRAPH = 'https://graph.facebook.com/v21.0';
const ACCOUNTS_CACHE_TTL = 6 * 60 * 60 * 1000;

let cachedAccountIds = null;
let cachedAccountsAt = 0;

export function isMetaConfigured() {
  return !!ENV.FB_ACCESS_TOKEN;
}

async function graphGet(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('access_token', ENV.FB_ACCESS_TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (data.error) {
    throw new Error(`Graph API: ${data.error.message} (code ${data.error.code})`);
  }
  return data;
}

export async function getAdAccountIds() {
  if (ENV.FB_AD_ACCOUNT_IDS) {
    return ENV.FB_AD_ACCOUNT_IDS.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (cachedAccountIds && Date.now() - cachedAccountsAt < ACCOUNTS_CACHE_TTL) {
    return cachedAccountIds;
  }
  const data = await graphGet('me/adaccounts', {
    fields: 'name,account_status',
    limit: '200'
  });
  cachedAccountIds = (data.data || [])
    .filter(a => a.account_status === 1 && /testora/i.test(a.name || ''))
    .map(a => a.id);
  cachedAccountsAt = Date.now();
  logInfo(`Meta: discovered ${cachedAccountIds.length} active Testora ad accounts`);
  return cachedAccountIds;
}

/**
 * Today's spend per campaign across all configured accounts.
 * Returns Map<campaignName, spendUSD>. "Today" is in each account's own
 * timezone — callers should compare against a purchase window wider than
 * the calendar day to avoid boundary false positives.
 */
export async function getTodaySpendByCampaign() {
  const accountIds = await getAdAccountIds();
  const spendByCampaign = new Map();

  for (const accountId of accountIds) {
    try {
      const data = await graphGet(`${accountId}/insights`, {
        level: 'campaign',
        fields: 'campaign_name,spend',
        date_preset: 'today',
        limit: '500'
      });
      for (const row of data.data || []) {
        const name = (row.campaign_name || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
        if (!name) continue;
        spendByCampaign.set(name, (spendByCampaign.get(name) || 0) + (parseFloat(row.spend) || 0));
      }
    } catch (error) {
      logWarn(`Meta insights failed for ${accountId}: ${error.message}`);
    }
  }

  return spendByCampaign;
}
