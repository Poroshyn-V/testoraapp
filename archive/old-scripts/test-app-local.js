// Test app.js locally
import app from './app.js';

const PORT = 3001; // Use different port to avoid conflicts

app.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
  console.log('✅ App.js loaded successfully');
  
  // Test the endpoints
  setTimeout(async () => {
    try {
      const response = await fetch(`http://localhost:${PORT}/api/test`);
      const data = await response.json();
      console.log('✅ API test endpoint works:', data.message);
      
      // Test sync endpoint
      const syncResponse = await fetch(`http://localhost:${PORT}/api/sync-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const syncData = await syncResponse.json();
      console.log('✅ Sync endpoint works:', syncData.message);
      
      process.exit(0);
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    }
  }, 2000);
});
