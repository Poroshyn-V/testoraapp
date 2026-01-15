#!/usr/bin/env node

/**
 * Script to verify and sync recent purchases (yesterday and today)
 * This script calls the /api/verify-and-sync-recent endpoint
 */

import fetch from 'node-fetch';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
config({ path: resolve(process.cwd(), '.env') });

const API_URL = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const ENDPOINT = `${API_URL}/api/verify-and-sync-recent`;

async function verifyAndSync() {
  console.log('🔍 Starting verification and sync of recent purchases...\n');
  console.log(`📡 Calling endpoint: ${ENDPOINT}\n`);

  try {
    const startTime = Date.now();
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const duration = Date.now() - startTime;
    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Error:', data.message || data.error);
      console.error('Details:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('✅ Verification and sync completed!\n');
    console.log('📊 Results:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Stripe results
    console.log('\n💳 Stripe (Main):');
    console.log(`   Found: ${data.results.stripe.found}`);
    console.log(`   Missing: ${data.results.stripe.missing}`);
    console.log(`   Synced: ${data.results.stripe.synced}`);
    
    // LowPrice results
    console.log('\n💰 LowPrice:');
    console.log(`   Found: ${data.results.lowPrice.found}`);
    console.log(`   Missing: ${data.results.lowPrice.missing}`);
    console.log(`   Synced: ${data.results.lowPrice.synced}`);
    
    // Primer results
    console.log('\n🔷 Primer:');
    console.log(`   Found: ${data.results.primer.found}`);
    console.log(`   Missing: ${data.results.primer.missing}`);
    console.log(`   Synced: ${data.results.primer.synced}`);
    
    // Errors
    if (data.results.errors && data.results.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      data.results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.source}: ${error.error}`);
      });
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏱️  Duration: ${data.duration || `${duration}ms`}`);
    console.log(`\n✅ Total synced: ${data.results.stripe.synced + data.results.lowPrice.synced + data.results.primer.synced} purchases\n`);

  } catch (error) {
    console.error('❌ Failed to verify and sync:', error.message);
    console.error('\n💡 Make sure the server is running and accessible.');
    console.error(`   Try: curl -X POST ${ENDPOINT}`);
    process.exit(1);
  }
}

verifyAndSync();
