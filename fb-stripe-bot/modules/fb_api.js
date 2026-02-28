// Facebook API Module
import fetch from 'node-fetch';

export class FB_API {
  constructor() {
    this.accessToken = process.env.FB_ACCESS_TOKEN;
    this.accountId = process.env.FB_ACCOUNT_ID;
    this.baseUrl = 'https://graph.facebook.com/v18.0';
  }

  async initialize() {
    console.log('🔧 Initializing Facebook API...');
    
    if (!this.accessToken || !this.accountId) {
      throw new Error('Facebook API credentials not configured');
    }
    
    console.log('✅ Facebook API initialized');
  }

  async getCampaigns() {
    try {
      const url = `${this.baseUrl}/${this.accountId}/campaigns`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Facebook API error: ${response.status}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      throw error;
    }
  }

  async getAdSets() {
    try {
      const url = `${this.baseUrl}/${this.accountId}/adsets`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Facebook API error: ${response.status}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching adsets:', error);
      throw error;
    }
  }

  async getAds() {
    try {
      const url = `${this.baseUrl}/${this.accountId}/ads`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Facebook API error: ${response.status}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching ads:', error);
      throw error;
    }
  }

  async getAdInsights(since, until) {
    try {
      const url = `${this.baseUrl}/${this.accountId}/insights?fields=ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,unique_inline_link_clicks&level=ad&time_range={'since':'${since}','until':'${until}'}&access_token=${this.accessToken}`;
      
      const response = await fetch(url);
      const json = await response.json();
      
      if (json.error) {
        throw new Error(json.error.message);
      }
      
      return json.data || [];
    } catch (error) {
      console.error('Error fetching ad insights:', error);
      throw error;
    }
  }

  // Get insights for specific date range
  async getInsightsForDateRange(since, until) {
    try {
      console.log(`📊 Fetching insights from ${since} to ${until}`);
      const insights = await this.getAdInsights(since, until);
      console.log(`✅ Retrieved ${insights.length} insight records`);
      return insights;
    } catch (error) {
      console.error('Error fetching insights for date range:', error);
      throw error;
    }
  }

  // Get insights for last N days
  async getInsightsForLastDays(days = 7) {
    const until = new Date();
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    return this.getInsightsForDateRange(
      since.toISOString().split('T')[0],
      until.toISOString().split('T')[0]
    );
  }
}
