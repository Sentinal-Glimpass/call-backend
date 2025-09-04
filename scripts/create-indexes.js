/**
 * Database Index Creation Script
 * Run this once to create performance indexes for MongoDB collections
 */

const { connectToMongo, client } = require('../models/mongodb');

async function createPerformanceIndexes() {
  console.log('🔍 Creating database indexes for performance optimization...');
  
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // 1. Index for plivo-list collection (getListByClientId)
    console.log('Creating index on plivo-list.clientId...');
    await database.collection("plivo-list").createIndex(
      { clientId: 1 },
      { background: true, name: "idx_clientId" }
    );
    
    console.log('Creating compound index on plivo-list for sorting...');
    await database.collection("plivo-list").createIndex(
      { clientId: 1, createdAt: -1 },
      { background: true, name: "idx_clientId_createdAt" }
    );
    
    // 2. Index for plivo-list-content collection (contact queries)
    console.log('Creating index on plivo-list-content.listId...');
    await database.collection("plivo-list-content").createIndex(
      { listId: 1 },
      { background: true, name: "idx_listId" }
    );
    
    // 3. Index for plivoHangupData collection (campaign reports)
    console.log('Creating index on plivoHangupData.campId...');
    await database.collection("plivoHangupData").createIndex(
      { campId: 1 },
      { background: true, name: "idx_campId" }
    );
    
    console.log('Creating index on plivoHangupData.To (phone numbers)...');
    await database.collection("plivoHangupData").createIndex(
      { To: 1 },
      { background: true, name: "idx_to_number" }
    );
    
    // 4. Index for logData collection (conversation logs)
    console.log('Creating index on logData.campId...');
    await database.collection("logData").createIndex(
      { campId: 1 },
      { background: true, name: "idx_logdata_campId" }
    );
    
    // 5. Critical indexes for getMergedLogData performance (fixes timeout issues)
    console.log('Creating index on logData.callUUID...');
    await database.collection("logData").createIndex(
      { callUUID: 1 },
      { background: true, name: "idx_logdata_callUUID" }
    );
    
    console.log('Creating index on plivoRecordData.CallUUID...');
    await database.collection("plivoRecordData").createIndex(
      { CallUUID: 1 },
      { background: true, name: "idx_recorddata_callUUID" }
    );
    
    // Compound index for campaign report pagination (critical for large campaigns)
    console.log('Creating compound index on plivoHangupData for pagination...');
    await database.collection("plivoHangupData").createIndex(
      { campId: 1, _id: -1 },
      { background: true, name: "idx_campId_id_desc" }
    );
    
    // 6. Index for client collection (authentication) - skip unique constraints if duplicates exist
    try {
      console.log('Creating index on client.email...');
      await database.collection("client").createIndex(
        { email: 1 },
        { background: true, name: "idx_client_email" } // Removed unique constraint due to existing duplicates
      );
    } catch (error) {
      console.log('⚠️  Skipping client.email index:', error.message);
    }
    
    try {
      console.log('Creating index on client.apiKey...');
      await database.collection("client").createIndex(
        { apiKey: 1 },
        { background: true, name: "idx_client_apiKey" } // Removed unique constraint
      );
    } catch (error) {
      console.log('⚠️  Skipping client.apiKey index:', error.message);
    }
    
    // 6. Index for campaign collection
    console.log('Creating index on campaign.clientId...');
    await database.collection("campaign").createIndex(
      { clientId: 1 },
      { background: true, name: "idx_campaign_clientId" }
    );
    
    console.log('Creating compound index on campaign for listing...');
    await database.collection("campaign").createIndex(
      { clientId: 1, createdAt: -1 },
      { background: true, name: "idx_campaign_clientId_createdAt" }
    );
    
    console.log('✅ All indexes created successfully!');
    
    // List all indexes for verification
    console.log('\n📋 Created indexes:');
    const collections = ['plivo-list', 'plivo-list-content', 'plivoHangupData', 'logData', 'plivoRecordData', 'client', 'campaign'];
    
    for (const collectionName of collections) {
      try {
        const indexes = await database.collection(collectionName).indexes();
        console.log(`\n${collectionName}:`);
        indexes.forEach(index => {
          console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
        });
      } catch (error) {
        console.log(`  ⚠️  Collection ${collectionName} not found or error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
createPerformanceIndexes();