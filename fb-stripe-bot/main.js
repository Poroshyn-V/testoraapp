// FB Stripe Bot - Main Entry Point
import dotenv from 'dotenv';
import { FB_API } from './modules/fb_api.js';
import { Sheets } from './modules/sheets.js';
import { Matcher } from './modules/matcher.js';
import { Aggregator } from './modules/aggregator.js';
import { Scheduler } from './utils/scheduler.js';

// Load environment variables
dotenv.config();

// Main update function
export async function mainUpdate() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const until = new Date().toISOString().split("T")[0];

    console.log("📊 Fetching Facebook spend...");
    const fbApi = new FB_API();
    await fbApi.initialize();
    const fbData = await fbApi.getAdInsights(since, until);

    console.log("💳 Reading Stripe purchases from Sheets...");
    const sheets = new Sheets();
    await sheets.initialize();
    const stripeRows = await sheets.getSheetData("Stripe!A1:Z");

    console.log("🔗 Matching...");
    const matcher = new Matcher();
    const results = matcher.matchPurchases(fbData, stripeRows);
    const sheetData = matcher.prepareSheetData(results);

    console.log("📝 Writing to Summary sheet...");
    await sheets.writeToSheet("Summary!A1", sheetData);

    console.log("✅ Update complete!");
  } catch (e) {
    console.error("❌ Error:", e.message);
  }
}

// Start scheduler
export function startScheduler() {
  console.log("⏰ Scheduler started: updating every 15 minutes");
  mainUpdate();
  setInterval(mainUpdate, 15 * 60 * 1000);
}

// Start the bot
startScheduler();
