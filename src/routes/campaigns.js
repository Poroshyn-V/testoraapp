// Campaign analysis endpoints
import express from 'express';
import { logger } from '../utils/logging.js';
import { campaignAnalyzer } from '../services/campaignAnalyzer.js';
import { sendTextNotifications } from '../services/notifications.js';
import { googleSheets } from '../services/googleSheets.js';

const router = express.Router();

// Campaign analysis endpoints
router.get('/api/campaigns/analyze', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || 'today'; // today, yesterday, week, month
    
    const analysis = await campaignAnalyzer.analyzeCampaigns(timeframe);
    
    if (!analysis) {
      return res.json({
        success: true,
        message: 'No campaign data found for the specified timeframe',
        timeframe,
        analysis: null
      });
    }
    
    res.json({
      success: true,
      message: 'Campaign analysis completed',
      timeframe,
      analysis
    });
  } catch (error) {
    logger.error('Error analyzing campaigns', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze campaigns',
      error: error.message
    });
  }
});

// Single campaign analysis endpoint
router.get('/api/campaigns/:campaignName/analyze', async (req, res) => {
  try {
    const { campaignName } = req.params;
    const timeframe = req.query.timeframe || 'week';
    
    const analysis = await campaignAnalyzer.analyzeSingleCampaign(
      decodeURIComponent(campaignName),
      timeframe
    );
    
    if (!analysis) {
      return res.json({
        success: true,
        message: 'No data found for this campaign',
        campaignName: decodeURIComponent(campaignName),
        timeframe,
        analysis: null
      });
    }
    
    res.json({
      success: true,
      message: 'Single campaign analysis completed',
      campaignName: decodeURIComponent(campaignName),
      timeframe,
      analysis
    });
  } catch (error) {
    logger.error('Error analyzing single campaign', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze campaign',
      error: error.message
    });
  }
});

// Campaign report endpoint - sends to Telegram
router.post('/api/campaigns/report', async (req, res) => {
  try {
    const timeframe = req.body.timeframe || 'today';
    
    const analysis = await campaignAnalyzer.analyzeCampaigns(timeframe);
    
    if (!analysis) {
      return res.json({
        success: true,
        message: 'No campaign data found for the specified timeframe',
        timeframe,
        reportSent: false
      });
    }
    
    // Generate report message
    const reportMessage = campaignAnalyzer.generateReportMessage(analysis, timeframe);
    
    // Send to Telegram
    await sendTextNotifications(reportMessage);
    
    res.json({
      success: true,
      message: 'Campaign report sent successfully',
      timeframe,
      reportSent: true,
      analysis: {
        totalCampaigns: analysis.campaigns.length,
        totalRevenue: analysis.summary.totalRevenue,
        totalPurchases: analysis.summary.totalPurchases
      }
    });
  } catch (error) {
    logger.error('Error sending campaign report', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send campaign report',
      error: error.message
    });
  }
});

// List all campaigns endpoint
router.get('/api/campaigns/list', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || 'week';
    
    const rows = await googleSheets.getAllRows();
    const purchases = campaignAnalyzer.filterByTimeframe(rows, timeframe);
    
    // Get unique campaigns
    const campaigns = [...new Set(purchases.map(p => {
      const campaign = p.get('UTM Campaign') || p.get('Campaign Name') || 'Unknown';
      return campaign;
    }))].filter(Boolean);
    
    // Get campaign stats
    const campaignStats = campaigns.map(campaignName => {
      const campaignPurchases = purchases.filter(p => {
        const campaign = p.get('UTM Campaign') || p.get('Campaign Name') || 'Unknown';
        return campaign === campaignName;
      });
      
      const totalRevenue = campaignPurchases.reduce((sum, p) => {
        const amount = parseFloat(p.get('Total Amount') || 0);
        return sum + amount;
      }, 0);
      
      const totalPurchases = campaignPurchases.length;
      
      return {
        name: campaignName,
        purchases: totalPurchases,
        revenue: totalRevenue.toFixed(2),
        avgOrderValue: totalPurchases > 0 ? (totalRevenue / totalPurchases).toFixed(2) : '0.00'
      };
    }).sort((a, b) => b.revenue - a.revenue);
    
    res.json({
      success: true,
      message: 'Campaign list retrieved',
      timeframe,
      totalCampaigns: campaigns.length,
      campaigns: campaignStats
    });
  } catch (error) {
    logger.error('Error listing campaigns', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list campaigns',
      error: error.message
    });
  }
});

export default router;
