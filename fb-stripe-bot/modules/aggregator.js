// Data Aggregator Module
export class Aggregator {
  constructor() {
    this.aggregatedData = new Map();
  }

  // Aggregate campaign performance data with Facebook insights
  aggregateCampaignData(matches, fbInsights = []) {
    const aggregated = new Map();
    
    // Process matches (campaign + payment data)
    for (const match of matches) {
      const campaignId = match.campaign.id;
      const campaignName = match.campaign.name;
      
      if (!aggregated.has(campaignId)) {
        aggregated.set(campaignId, {
          campaignId,
          campaignName,
          totalRevenue: 0,
          paymentCount: 0,
          averageOrderValue: 0,
          payments: [],
          fbData: match.campaign,
          fbInsights: {
            totalSpend: 0,
            totalImpressions: 0,
            totalClicks: 0,
            totalLinkClicks: 0,
            ctr: 0,
            cpc: 0,
            roas: 0
          }
        });
      }
      
      const data = aggregated.get(campaignId);
      data.totalRevenue += parseFloat(match.payment.amount) / 100; // Convert from cents
      data.paymentCount += 1;
      data.payments.push(match.payment);
    }
    
    // Process Facebook insights
    for (const insight of fbInsights) {
      const campaignName = insight.campaign_name;
      
      // Find matching campaign by name
      for (const [campaignId, data] of aggregated) {
        if (data.campaignName === campaignName) {
          data.fbInsights.totalSpend += parseFloat(insight.spend || 0);
          data.fbInsights.totalImpressions += parseInt(insight.impressions || 0);
          data.fbInsights.totalClicks += parseInt(insight.clicks || 0);
          data.fbInsights.totalLinkClicks += parseInt(insight.unique_inline_link_clicks || 0);
          break;
        }
      }
    }
    
    // Calculate metrics
    for (const [campaignId, data] of aggregated) {
      data.averageOrderValue = data.totalRevenue / data.paymentCount;
      
      // Calculate Facebook metrics
      const insights = data.fbInsights;
      if (insights.totalImpressions > 0) {
        insights.ctr = (insights.totalClicks / insights.totalImpressions) * 100;
      }
      if (insights.totalClicks > 0) {
        insights.cpc = insights.totalSpend / insights.totalClicks;
      }
      if (insights.totalSpend > 0) {
        insights.roas = data.totalRevenue / insights.totalSpend;
      }
    }
    
    return Array.from(aggregated.values());
  }

  // Generate performance report
  generateReport(aggregatedData) {
    const report = {
      totalCampaigns: aggregatedData.length,
      totalRevenue: 0,
      totalPayments: 0,
      topCampaigns: [],
      summary: {}
    };
    
    // Calculate totals
    for (const data of aggregatedData) {
      report.totalRevenue += data.totalRevenue;
      report.totalPayments += data.paymentCount;
    }
    
    // Sort campaigns by revenue
    report.topCampaigns = aggregatedData
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);
    
    // Generate summary
    report.summary = {
      averageRevenuePerCampaign: report.totalRevenue / report.totalCampaigns,
      averageOrderValue: report.totalRevenue / report.totalPayments,
      topPerformingCampaign: report.topCampaigns[0]?.campaignName || 'N/A'
    };
    
    return report;
  }

  // Format data for Google Sheets with Facebook insights
  formatForSheets(aggregatedData) {
    const headers = [
      'Campaign ID',
      'Campaign Name',
      'Total Revenue',
      'Payment Count',
      'Average Order Value',
      'Facebook Spend',
      'Impressions',
      'Clicks',
      'Link Clicks',
      'CTR (%)',
      'CPC',
      'ROAS',
      'Status',
      'Last Updated'
    ];
    
    const rows = [headers];
    
    for (const data of aggregatedData) {
      const insights = data.fbInsights;
      rows.push([
        data.campaignId,
        data.campaignName,
        data.totalRevenue.toFixed(2),
        data.paymentCount,
        data.averageOrderValue.toFixed(2),
        insights.totalSpend.toFixed(2),
        insights.totalImpressions,
        insights.totalClicks,
        insights.totalLinkClicks,
        insights.ctr.toFixed(2),
        insights.cpc.toFixed(2),
        insights.roas.toFixed(2),
        data.fbData.status || 'ACTIVE',
        new Date().toISOString()
      ]);
    }
    
    return rows;
  }
}
