// Render version - NO NOTIFICATIONS
console.log('🚫 RENDER: Notifications disabled to prevent duplicates');
console.log('🚫 RENDER: Only Vercel should send notifications');

// Disable all notification functions
function sendTelegram() {
  console.log('🚫 Telegram disabled in Render');
}

function sendSlack() {
  console.log('🚫 Slack disabled in Render');
}

// Export empty functions
module.exports = { sendTelegram, sendSlack };
