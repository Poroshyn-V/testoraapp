// Test Railway deployment
import fetch from 'node-fetch';

const RAILWAY_URL = 'https://testoraapp.railway.app';

async function testRailwayDeployment() {
  try {
    console.log('🚀 Testing Railway deployment...');
    
    // Test root endpoint
    console.log('1. Testing root endpoint...');
    const rootResponse = await fetch(`${RAILWAY_URL}/`);
    const rootData = await rootResponse.json();
    console.log('✅ Root endpoint:', rootData.message);
    
    // Test health endpoint
    console.log('2. Testing health endpoint...');
    const healthResponse = await fetch(`${RAILWAY_URL}/health`);
    const healthData = await healthResponse.text();
    console.log('✅ Health endpoint:', healthData);
    
    // Test memory status
    console.log('3. Testing memory status...');
    try {
      const memoryResponse = await fetch(`${RAILWAY_URL}/api/memory-status`);
      const memoryData = await memoryResponse.json();
      console.log('✅ Memory status:', memoryData.message);
      console.log('   Count:', memoryData.count);
    } catch (error) {
      console.log('❌ Memory status error:', error.message);
    }
    
    // Test sync endpoint
    console.log('4. Testing sync endpoint...');
    try {
      const syncResponse = await fetch(`${RAILWAY_URL}/api/sync-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const syncData = await syncResponse.json();
      console.log('✅ Sync endpoint:', syncData.message);
      console.log('   Processed:', syncData.processed);
      console.log('   Total groups:', syncData.total_groups);
    } catch (error) {
      console.log('❌ Sync endpoint error:', error.message);
    }
    
    // Test last purchases
    console.log('5. Testing last purchases...');
    try {
      const purchasesResponse = await fetch(`${RAILWAY_URL}/api/last-purchases`);
      const purchasesData = await purchasesResponse.json();
      console.log('✅ Last purchases:', purchasesData.message);
      console.log('   Count:', purchasesData.count);
    } catch (error) {
      console.log('❌ Last purchases error:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Railway test failed:', error.message);
  }
}

testRailwayDeployment();
