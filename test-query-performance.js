/**
 * Test script to verify query performance optimization
 * Tests the campaign report query that was timing out
 */

const { connectToMongo, client } = require('./models/mongodb.js');
const { getReportByCampId } = require('./src/apps/plivo/plivo.js');

async function testQueryPerformance() {
  console.log('🧪 Testing optimized query performance...\n');
  
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // Test with the campaign ID that was causing timeouts
    const campaignId = "68b6e45dbc612ef310272215";
    const cursor = null;
    const limit = 25;
    const isDownload = false;
    const filters = { customFilters: [] };
    
    console.log(`📊 Testing campaign report for: ${campaignId}`);
    console.log(`📄 Parameters: cursor=${cursor}, limit=${limit}, download=${isDownload}\n`);
    
    // Check if campaign exists
    const campaignCollection = database.collection("plivoCampaign");
    const campaign = await campaignCollection.findOne({ _id: campaignId });
    
    if (!campaign) {
      console.log(`⚠️  Campaign ${campaignId} not found, testing with available campaigns...\n`);
      
      // Find the largest campaign to test with
      const largeCampaigns = await campaignCollection
        .find({})
        .sort({ totalContacts: -1 })
        .limit(3)
        .toArray();
        
      if (largeCampaigns.length > 0) {
        console.log('📋 Available large campaigns for testing:');
        largeCampaigns.forEach((camp, i) => {
          console.log(`  ${i+1}. ${camp._id} (${camp.campaignName}) - ${camp.totalContacts || 'N/A'} contacts`);
        });
        
        // Test with the first large campaign
        const testCampaignId = largeCampaigns[0]._id.toString();
        console.log(`\n🎯 Testing with campaign: ${testCampaignId}`);
        await runPerformanceTest(testCampaignId, cursor, limit, isDownload, filters);
      } else {
        console.log('❌ No campaigns found to test with');
      }
    } else {
      console.log(`✅ Campaign found: ${campaign.campaignName} (${campaign.totalContacts || 'N/A'} contacts)\n`);
      await runPerformanceTest(campaignId, cursor, limit, isDownload, filters);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

async function runPerformanceTest(campaignId, cursor, limit, isDownload, filters) {
  const startTime = Date.now();
  
  try {
    console.log(`⏱️  Starting query at ${new Date().toISOString()}`);
    
    const result = await getReportByCampId(campaignId, cursor, limit, isDownload, filters);
    
    const duration = Date.now() - startTime;
    
    console.log(`\n✅ Query completed successfully!`);
    console.log(`⏱️  Duration: ${duration}ms (${(duration/1000).toFixed(2)}s)`);
    console.log(`📊 Status: ${result.status}`);
    console.log(`📝 Message: ${result.message}`);
    console.log(`📈 Data records: ${result.data?.length || 0}`);
    console.log(`⏰ Total duration: ${result.totalDuration || 0}s`);
    console.log(`🔢 Total count: ${result.totalCount || 'N/A'}`);
    console.log(`📞 Completed calls: ${result.completedCalls || 0}`);
    console.log(`📊 Campaign status: ${result.campaignStatus || 'unknown'}`);
    
    if (duration > 30000) {
      console.log('\n⚠️  Query still took longer than 30 seconds - further optimization may be needed');
    } else if (duration > 10000) {
      console.log('\n⚡ Query performance is acceptable but could be further improved');
    } else {
      console.log('\n🚀 Excellent query performance!');
    }
    
    // Test pagination if there are more pages
    if (result.hasNextPage && result.nextCursor) {
      console.log('\n🔄 Testing pagination with next cursor...');
      const paginationStart = Date.now();
      
      const paginatedResult = await getReportByCampId(campaignId, result.nextCursor, limit, isDownload, filters);
      const paginationDuration = Date.now() - paginationStart;
      
      console.log(`✅ Pagination query: ${paginationDuration}ms (${(paginationDuration/1000).toFixed(2)}s)`);
      console.log(`📈 Page 2 records: ${paginatedResult.data?.length || 0}`);
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`\n❌ Query failed after ${duration}ms`);
    console.error('Error:', error.message);
    
    if (duration >= 30000) {
      console.log('💡 Query timed out - the optimization may not be sufficient for this dataset size');
    }
  }
}

// Run the test
testQueryPerformance();