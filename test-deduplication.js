/**
 * Test script to verify billing deduplication works
 */

const { getBillingHistoryByClientId } = require('./src/apps/exotel/exotel.js');

async function testDeduplication() {
  console.log('🧪 Testing billing history deduplication...\n');
  
  try {
    // Test with the client ID mentioned in the issue
    const clientId = "682868df601f4fbf27aefbb6";
    
    console.log(`📊 Fetching billing history for client: ${clientId}`);
    
    const billingHistory = await getBillingHistoryByClientId(clientId);
    
    console.log(`\n✅ Deduplication completed!`);
    console.log(`📈 Total entries returned: ${billingHistory.length}`);
    
    // Show a few sample entries to verify deduplication
    console.log('\n📋 Sample billing entries:');
    const sampleEntries = billingHistory.slice(0, 5);
    sampleEntries.forEach((entry, index) => {
      if (entry.desc) {
        console.log(`${index + 1}. ${entry.date} - ${entry.desc} - Balance: ${entry.newAvailableBalance}`);
      }
    });
    
    // Check for any remaining duplicates by looking for similar patterns
    console.log('\n🔍 Checking for remaining duplicates...');
    const campaignEntries = billingHistory.filter(entry => 
      entry.desc && entry.desc.includes('Campaign completed:') && entry.desc.includes('msme5kto30k')
    );
    
    console.log(`📊 Found ${campaignEntries.length} 'msme5kto30k' campaign entries`);
    
    // Group by balance to see if duplicates remain
    const balanceGroups = {};
    campaignEntries.forEach(entry => {
      const balance = entry.newAvailableBalance;
      if (!balanceGroups[balance]) {
        balanceGroups[balance] = [];
      }
      balanceGroups[balance].push(entry);
    });
    
    Object.entries(balanceGroups).forEach(([balance, entries]) => {
      if (entries.length > 1) {
        console.log(`⚠️ Still found ${entries.length} entries with balance ${balance}`);
        entries.forEach((entry, i) => {
          console.log(`  ${i + 1}. ${entry.date} - ${entry.desc}`);
        });
      } else {
        console.log(`✅ Unique entry with balance ${balance}`);
      }
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the test
testDeduplication();