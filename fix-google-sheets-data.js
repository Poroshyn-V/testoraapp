import { ENV } from './src/config/env.js';
import googleSheets from './src/services/googleSheets.js';
import { getCustomer } from './src/services/stripe.js';

async function fixGoogleSheetsData() {
  try {
    console.log('🔧 Starting Google Sheets data fix...');
    
    // Get all rows from Google Sheets
    const rows = await googleSheets.getRows();
    console.log(`📊 Found ${rows.length} rows to check`);
    
    let fixedCount = 0;
    
    for (const row of rows) {
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      if (!customerId || customerId === 'N/A') continue;
      
      console.log(`🔍 Checking customer: ${email} (${customerId})`);
      
      // Get customer data from Stripe
      const customer = await getCustomer(customerId);
      if (!customer) {
        console.log(`❌ Customer not found in Stripe: ${customerId}`);
        continue;
      }
      
      // Get customer's payments to find metadata
      const payments = await getCustomerPayments(customerId);
      const successfulPayments = payments.filter(p => p.status === 'succeeded');
      
      if (successfulPayments.length === 0) {
        console.log(`❌ No successful payments found for: ${customerId}`);
        continue;
      }
      
      // Get metadata from the first successful payment
      const payment = successfulPayments[0];
      const m = { ...payment.metadata, ...(customer?.metadata || {}) };
      
      // Check if we need to update any fields
      const currentAdName = row.get('Ad Name');
      const currentAdsetName = row.get('Adset Name');
      const currentCampaignName = row.get('Campaign Name');
      const currentCreativeLink = row.get('Creative Link');
      
      const newAdName = m.ad_name || m['Ad Name'] || 'N/A';
      const newAdsetName = m.adset_name || m['Adset Name'] || 'N/A';
      const newCampaignName = m.campaign_name || m['Campaign Name'] || m.utm_campaign || 'N/A';
      const newCreativeLink = m.creative_link || m['Creative Link'] || 'N/A';
      
      // Check if any field needs updating
      const needsUpdate = 
        (currentAdName === 'N/A' && newAdName !== 'N/A') ||
        (currentAdsetName === 'N/A' && newAdsetName !== 'N/A') ||
        (currentCampaignName === 'N/A' && newCampaignName !== 'N/A') ||
        (currentCreativeLink === 'N/A' && newCreativeLink !== 'N/A');
      
      if (needsUpdate) {
        console.log(`✅ Updating data for: ${email}`);
        console.log(`   Ad Name: ${currentAdName} → ${newAdName}`);
        console.log(`   Adset Name: ${currentAdsetName} → ${newAdsetName}`);
        console.log(`   Campaign Name: ${currentCampaignName} → ${newCampaignName}`);
        console.log(`   Creative Link: ${currentCreativeLink} → ${newCreativeLink}`);
        
        await googleSheets.updateRow(row, {
          'Ad Name': newAdName,
          'Adset Name': newAdsetName,
          'Campaign Name': newCampaignName,
          'Creative Link': newCreativeLink
        });
        
        fixedCount++;
      } else {
        console.log(`⏭️ No update needed for: ${email}`);
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`🎉 Fix completed! Updated ${fixedCount} rows`);
    
  } catch (error) {
    console.error('❌ Error fixing Google Sheets data:', error);
  }
}

// Import getCustomerPayments
import { getCustomerPayments } from './src/services/stripe.js';

fixGoogleSheetsData();
