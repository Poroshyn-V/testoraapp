// Comprehensive Google Sheets data fix script
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const ENV = {
  GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
  GOOGLE_SERVICE_PRIVATE_KEY: process.env.GOOGLE_SERVICE_PRIVATE_KEY,
  GOOGLE_SHEETS_DOC_ID: process.env.GOOGLE_SHEETS_DOC_ID,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY
};

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function comprehensiveFix() {
  try {
    console.log('🔧 Starting comprehensive Google Sheets data fix...');
    console.log('📋 This script will:');
    console.log('  1. Fix GEO data (Unknown -> correct country/city)');
    console.log('  2. Fix payment sums and counts');
    console.log('  3. Ensure proper grouping logic');
    console.log('  4. Update Payment Intent IDs');
    
    // Check environment variables
    if (!ENV.GOOGLE_SERVICE_EMAIL || !ENV.GOOGLE_SERVICE_PRIVATE_KEY || !ENV.GOOGLE_SHEETS_DOC_ID) {
      console.log('❌ Missing environment variables');
      return;
    }
    
    if (!ENV.STRIPE_SECRET_KEY) {
      console.log('❌ Missing STRIPE_SECRET_KEY');
      return;
    }
    
    console.log('✅ Environment variables loaded');
    
    // Initialize Google Sheets
    const serviceAccountAuth = new JWT({
      email: ENV.GOOGLE_SERVICE_EMAIL,
      key: ENV.GOOGLE_SERVICE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEETS_DOC_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📊 Found ${rows.length} rows to process`);
    
    if (rows.length === 0) {
      console.log('📭 No data in sheet');
      return;
    }
    
    let stats = {
      total: rows.length,
      processed: 0,
      skipped: 0,
      geoFixed: 0,
      sumFixed: 0,
      errors: 0
    };
    
    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const customerId = row.get('Customer ID');
      const email = row.get('Email');
      
      console.log(`\n🔍 Processing row ${i + 1}/${rows.length}: ${email}`);
      
      if (!customerId || customerId === 'N/A' || !email || email === 'N/A') {
        console.log(`  ⏭️ Skipping - no valid customer ID or email`);
        stats.skipped++;
        continue;
      }
      
      try {
        let needsUpdate = false;
        
        // 1. Fix GEO data
        const currentGeo = row.get('GEO') || '';
        if (currentGeo.includes('Unknown') || currentGeo === '') {
          console.log(`  🌍 Fixing GEO data...`);
          
          const customer = await stripe.customers.retrieve(customerId);
          if (customer && !('deleted' in customer && customer.deleted)) {
            const customerMetadata = customer.metadata || {};
            let geoCountry = customerMetadata.geo_country || customer?.address?.country || 'Unknown';
            let geoCity = customerMetadata.geo_city || customer?.address?.city || '';
            
            // Fallback: try payment methods
            if (geoCountry === 'Unknown' && customer?.id) {
              try {
                const paymentMethods = await stripe.paymentMethods.list({
                  customer: customer.id,
                  type: 'card',
                  limit: 1
                });
                
                if (paymentMethods.data.length > 0 && paymentMethods.data[0].card && paymentMethods.data[0].card.country) {
                  geoCountry = paymentMethods.data[0].card.country;
                }
              } catch (pmError) {
                // Ignore payment method errors
              }
            }
            
            const newGeo = geoCity ? `${geoCountry}, ${geoCity}` : geoCountry;
            row.set('GEO', newGeo);
            console.log(`    ✅ GEO: "${currentGeo}" -> "${newGeo}"`);
            stats.geoFixed++;
            needsUpdate = true;
          }
        }
        
        // 2. Fix payment data
        const currentPaymentIds = row.get('Payment Intent IDs') || '';
        const currentTotalAmount = parseFloat(row.get('Total Amount') || '0');
        const currentPaymentCount = parseInt(row.get('Payment Count') || '1');
        
        if (currentPaymentIds) {
          console.log(`  💰 Checking payment data...`);
          
          const payments = await stripe.paymentIntents.list({
            customer: customerId,
            limit: 100
          });
          
          // Filter successful payments (only Subscription creation)
          const successfulPayments = payments.data.filter(p => {
            if (p.status !== 'succeeded' || !p.customer) return false;
            if (p.description && p.description.toLowerCase().includes('subscription update')) {
              return false;
            }
            return true;
          });
          
          if (successfulPayments.length > 0) {
            // Group payments within 3 hours
            const groupedPayments = [];
            const processedPayments = new Set();
            
            for (const payment of successfulPayments) {
              if (processedPayments.has(payment.id)) continue;
              
              const group = [payment];
              processedPayments.add(payment.id);
              
              // Find related payments within 3 hours
              for (const otherPayment of successfulPayments) {
                if (processedPayments.has(otherPayment.id)) continue;
                
                const timeDiff = Math.abs(payment.created - otherPayment.created);
                const hoursDiff = timeDiff / 3600;
                
                if (hoursDiff <= 3) {
                  group.push(otherPayment);
                  processedPayments.add(otherPayment.id);
                }
              }
              
              groupedPayments.push(group);
            }
            
            // Calculate correct totals
            let correctTotalAmount = 0;
            let correctPaymentCount = 0;
            const correctPaymentIds = [];
            
            for (const group of groupedPayments) {
              for (const payment of group) {
                correctTotalAmount += payment.amount;
                correctPaymentCount++;
                correctPaymentIds.push(payment.id);
              }
            }
            
            const correctTotalAmountFormatted = (correctTotalAmount / 100).toFixed(2);
            const correctPaymentIdsString = correctPaymentIds.join(', ');
            
            // Check if update is needed
            const amountDiff = Math.abs(currentTotalAmount - correctTotalAmount / 100);
            const countDiff = Math.abs(currentPaymentCount - correctPaymentCount);
            const idsDiff = currentPaymentIds !== correctPaymentIdsString;
            
            if (amountDiff > 0.01 || countDiff > 0 || idsDiff) {
              row.set('Total Amount', correctTotalAmountFormatted);
              row.set('Payment Count', correctPaymentCount.toString());
              row.set('Payment Intent IDs', correctPaymentIdsString);
              
              console.log(`    ✅ Payment data updated:`);
              console.log(`      Amount: $${currentTotalAmount} -> $${correctTotalAmountFormatted}`);
              console.log(`      Count: ${currentPaymentCount} -> ${correctPaymentCount}`);
              console.log(`      IDs: ${currentPaymentIds.split(', ').length} -> ${correctPaymentIds.length}`);
              
              stats.sumFixed++;
              needsUpdate = true;
            } else {
              console.log(`    ✅ Payment data is correct`);
            }
          }
        }
        
        // Save row if updated
        if (needsUpdate) {
          await row.save();
          console.log(`  💾 Row saved`);
          
          // Add delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        stats.processed++;
        
      } catch (error) {
        console.log(`  ❌ Error processing row: ${error.message}`);
        stats.errors++;
      }
    }
    
    console.log(`\n🎉 Comprehensive fix completed!`);
    console.log(`📊 Statistics:`);
    console.log(`  Total rows: ${stats.total}`);
    console.log(`  Processed: ${stats.processed}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  GEO fixes: ${stats.geoFixed}`);
    console.log(`  Sum fixes: ${stats.sumFixed}`);
    console.log(`  Errors: ${stats.errors}`);
    
  } catch (error) {
    console.error('❌ Comprehensive fix failed:', error.message);
  }
}

// Run the comprehensive fix
comprehensiveFix();
