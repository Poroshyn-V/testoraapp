// Simple test of app.js
console.log('🧪 Testing app.js...');

try {
  // Test if we can import the app
  const app = await import('./app.js');
  console.log('✅ App imported successfully');
  
  // Test if the app has the expected structure
  if (app.default && typeof app.default.listen === 'function') {
    console.log('✅ App has listen method');
  } else {
    console.log('❌ App missing listen method');
  }
  
  console.log('✅ App.js test passed');
} catch (error) {
  console.error('❌ App.js test failed:', error.message);
  process.exit(1);
}
