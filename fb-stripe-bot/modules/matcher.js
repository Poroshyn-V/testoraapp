// Data Matcher Module
export class Matcher {
  constructor() {
    this.matchedData = new Map();
  }

  // Match Facebook ads with Stripe purchases
  matchPurchases(fbAds, stripeRows) {
    return fbAds.map(ad => {
      const matches = stripeRows.filter(r =>
        (r["Ad Name"] && ad.ad_name.includes(r["Ad Name"])) ||
        (r["UTM Term"] && ad.ad_name.includes(r["UTM Term"])) ||
        (r["UTM Content"] && ad.ad_name.includes(r["UTM Content"]))
      );

      const purchases = matches.length;
      const revenue = matches.reduce((sum, r) => sum + parseFloat(r["Total Amount"] || 0), 0);
      const spend = parseFloat(ad.spend || 0);
      const impressions = parseFloat(ad.impressions || 0);
      const clicks = parseFloat(ad.clicks || 0);
      const hookClicks = parseFloat(ad.unique_inline_link_clicks || clicks);

      const spa = purchases > 0 ? (spend / purchases).toFixed(2) : "-";
      const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) + "%" : "-";
      const cpm = impressions > 0 ? ((spend / impressions) * 1000).toFixed(2) : "-";
      const hookRate = impressions > 0 ? ((hookClicks / impressions) * 100).toFixed(2) + "%" : "-";

      return {
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        adset_name: ad.adset_name,
        campaign_name: ad.campaign_name,
        spend: spend,
        impressions: impressions,
        clicks: clicks,
        purchases: purchases,
        revenue: revenue,
        spa: spa,
        ctr: ctr,
        cpm: cpm,
        hookRate: hookRate,
        matches: matches
      };
    });
  }

  // Match Facebook campaigns with Stripe data (legacy method)
  matchCampaignsWithPayments(fbCampaigns, stripePayments) {
    const matches = [];
    
    for (const campaign of fbCampaigns) {
      for (const payment of stripePayments) {
        if (this.isMatch(campaign, payment)) {
          matches.push({
            campaign: campaign,
            payment: payment,
            matchScore: this.calculateMatchScore(campaign, payment)
          });
        }
      }
    }
    
    return matches.sort((a, b) => b.matchScore - a.matchScore);
  }

  // Check if campaign and payment match
  isMatch(campaign, payment) {
    // Match by campaign name in payment metadata
    const campaignName = campaign.name?.toLowerCase() || '';
    const paymentMetadata = payment.metadata || {};
    
    // Check various metadata fields for campaign name
    const metadataFields = [
      'utm_campaign',
      'campaign_name',
      'campaign',
      'source'
    ];
    
    for (const field of metadataFields) {
      const fieldValue = paymentMetadata[field]?.toLowerCase() || '';
      if (fieldValue.includes(campaignName) || campaignName.includes(fieldValue)) {
        return true;
      }
    }
    
    return false;
  }

  // Calculate match confidence score
  calculateMatchScore(campaign, payment) {
    let score = 0;
    const campaignName = campaign.name?.toLowerCase() || '';
    const paymentMetadata = payment.metadata || {};
    
    // Exact match gets highest score
    const metadataFields = [
      'utm_campaign',
      'campaign_name',
      'campaign'
    ];
    
    for (const field of metadataFields) {
      const fieldValue = paymentMetadata[field]?.toLowerCase() || '';
      if (fieldValue === campaignName) {
        score += 100;
      } else if (fieldValue.includes(campaignName)) {
        score += 50;
      } else if (campaignName.includes(fieldValue)) {
        score += 30;
      }
    }
    
    return score;
  }

  // Get best matches for each campaign
  getBestMatches(matches) {
    const campaignMatches = new Map();
    
    for (const match of matches) {
      const campaignId = match.campaign.id;
      
      if (!campaignMatches.has(campaignId) || 
          match.matchScore > campaignMatches.get(campaignId).matchScore) {
        campaignMatches.set(campaignId, match);
      }
    }
    
    return Array.from(campaignMatches.values());
  }

  // Prepare data for Google Sheets
  prepareSheetData(results) {
    const header = [
      "Ad ID", "Ad Name", "Adset Name", "Campaign Name",
      "Spend (USD)", "Impressions", "Clicks", "Purchases",
      "Revenue (USD)", "SPA (USD)", "CTR (%)", "CPM (USD)", "Hook Rate (%)"
    ];
    
    const rows = results.map(result => [
      result.ad_id,
      result.ad_name,
      result.adset_name,
      result.campaign_name,
      result.spend,
      result.impressions,
      result.clicks,
      result.purchases,
      result.revenue,
      result.spa,
      result.ctr,
      result.cpm,
      result.hookRate
    ]);
    
    return [header, ...rows];
  }
}
