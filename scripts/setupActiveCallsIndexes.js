/**
 * ActiveCalls Collection Index Setup Script
 * 
 * This script creates performance-optimized indexes for the activeCalls collection
 * and ensures proper schema structure for concurrency management.
 * 
 * Run with: node scripts/setupActiveCallsIndexes.js
 */

const { connectToMongo, client } = require('../models/mongodb');
const { ObjectId } = require('mongodb');

class ActiveCallsIndexManager {
  constructor() {
    this.database = null;
    this.indexResults = {
      created: [],
      existing: [],
      errors: []
    };
  }

  async initialize() {
    try {
      await connectToMongo();
      this.database = client.db("talkGlimpass");
      console.log('✅ Connected to MongoDB database: talkGlimpass');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async validateActiveCallsSchema() {
    console.log('\n🔍 Validating activeCalls collection schema...');
    
    const activeCallsCollection = this.database.collection('activeCalls');
    
    try {
      const documentCount = await activeCallsCollection.countDocuments({});
      console.log(`📊 Current activeCalls documents: ${documentCount}`);

      if (documentCount > 0) {
        const sampleDoc = await activeCallsCollection.findOne({});
        console.log('\n📋 Current schema fields:');
        console.log(`  - ${Object.keys(sampleDoc).join(', ')}`);

        // Validate expected schema fields
        const requiredFields = [
          'callUUID', 'clientId', 'campaignId', 'from', 'to', 'status', 
          'startTime', 'endTime', 'duration', 'endReason', 'failureReason', 
          'warmupAttempts', 'warmupDuration'
        ];

        const missingFields = requiredFields.filter(field => !sampleDoc.hasOwnProperty(field));
        
        if (missingFields.length > 0) {
          console.log(`⚠️  Missing expected fields: ${missingFields.join(', ')}`);
        } else {
          console.log('✅ All expected fields present in schema');
        }
      }
    } catch (error) {
      console.log('ℹ️  activeCalls collection does not exist yet - will be created on first use');
    }
  }

  async createPerformanceIndexes() {
    console.log('\n🚀 Creating performance indexes for activeCalls collection...');
    
    const activeCallsCollection = this.database.collection('activeCalls');
    
    // Define required indexes for optimal performance
    const requiredIndexes = [
      {
        name: 'idx_status_clientId',
        key: { status: 1, clientId: 1 },
        options: { background: true },
        purpose: 'Concurrency checks per client (most frequent query)'
      },
      {
        name: 'idx_status_global', 
        key: { status: 1 },
        options: { background: true },
        purpose: 'Global concurrency checks across all clients'
      },
      {
        name: 'idx_startTime_cleanup',
        key: { startTime: 1 },
        options: { background: true },
        purpose: 'Timeout cleanup process (finds stale calls)'
      },
      {
        name: 'idx_callUUID_unique',
        key: { callUUID: 1 },
        options: { background: true, unique: true, sparse: true },
        purpose: 'Webhook call lookup and prevent duplicates'
      },
      {
        name: 'idx_campaignId',
        key: { campaignId: 1 },
        options: { background: true, sparse: true },
        purpose: 'Campaign-specific call tracking'
      },
      {
        name: 'idx_clientId_startTime',
        key: { clientId: 1, startTime: -1 },
        options: { background: true },
        purpose: 'Client call history and recent calls lookup'
      }
    ];

    // Get existing indexes
    const existingIndexes = await activeCallsCollection.indexes();
    const existingIndexNames = existingIndexes.map(idx => idx.name);

    for (const indexDef of requiredIndexes) {
      try {
        if (existingIndexNames.includes(indexDef.name)) {
          console.log(`  ✅ ${indexDef.name}: Already exists`);
          this.indexResults.existing.push(indexDef.name);
        } else {
          await activeCallsCollection.createIndex(
            indexDef.key,
            { ...indexDef.options, name: indexDef.name }
          );
          console.log(`  🆕 ${indexDef.name}: Created successfully`);
          console.log(`     └─ Purpose: ${indexDef.purpose}`);
          this.indexResults.created.push(indexDef.name);
        }
      } catch (error) {
        console.log(`  ❌ ${indexDef.name}: Failed - ${error.message}`);
        this.indexResults.errors.push({
          index: indexDef.name,
          error: error.message
        });
      }
    }
  }

  async createCampaignIndexes() {
    console.log('\n🚀 Creating additional campaign indexes for heartbeat management...');
    
    const campaignCollection = this.database.collection('plivoCampaign');
    
    const campaignIndexes = [
      {
        name: 'idx_status_heartbeat',
        key: { status: 1, heartbeat: 1 },
        options: { background: true },
        purpose: 'Orphan detection (find stale running campaigns)'
      },
      {
        name: 'idx_clientId_status',
        key: { clientId: 1, status: 1 },
        options: { background: true },
        purpose: 'Client campaign queries by status'
      },
      {
        name: 'idx_status_only',
        key: { status: 1 },
        options: { background: true },
        purpose: 'Active campaign filtering'
      }
    ];

    // Get existing indexes
    const existingIndexes = await campaignCollection.indexes();
    const existingIndexNames = existingIndexes.map(idx => idx.name);

    for (const indexDef of campaignIndexes) {
      try {
        if (existingIndexNames.includes(indexDef.name)) {
          console.log(`  ✅ plivoCampaign.${indexDef.name}: Already exists`);
          this.indexResults.existing.push(`plivoCampaign.${indexDef.name}`);
        } else {
          await campaignCollection.createIndex(
            indexDef.key,
            { ...indexDef.options, name: indexDef.name }
          );
          console.log(`  🆕 plivoCampaign.${indexDef.name}: Created successfully`);
          console.log(`     └─ Purpose: ${indexDef.purpose}`);
          this.indexResults.created.push(`plivoCampaign.${indexDef.name}`);
        }
      } catch (error) {
        console.log(`  ❌ plivoCampaign.${indexDef.name}: Failed - ${error.message}`);
        this.indexResults.errors.push({
          index: `plivoCampaign.${indexDef.name}`,
          error: error.message
        });
      }
    }
  }

  async createRemainingIndexes() {
    console.log('\n🚀 Creating remaining required indexes...');
    
    // plivo-list-data index (was missing in validation)
    const listDataCollection = this.database.collection('plivo-list-data');
    
    try {
      const existingIndexes = await listDataCollection.indexes();
      const existingIndexNames = existingIndexes.map(idx => idx.name);
      
      if (!existingIndexNames.includes('idx_listId')) {
        await listDataCollection.createIndex(
          { listId: 1 },
          { background: true, name: 'idx_listId' }
        );
        console.log('  🆕 plivo-list-data.idx_listId: Created successfully');
        console.log('     └─ Purpose: Contact list queries');
        this.indexResults.created.push('plivo-list-data.idx_listId');
      } else {
        console.log('  ✅ plivo-list-data.idx_listId: Already exists');
        this.indexResults.existing.push('plivo-list-data.idx_listId');
      }
    } catch (error) {
      console.log(`  ❌ plivo-list-data.idx_listId: Failed - ${error.message}`);
      this.indexResults.errors.push({
        index: 'plivo-list-data.idx_listId',
        error: error.message
      });
    }
  }

  async testActiveCallsPerformance() {
    console.log('\n🧪 Testing activeCalls performance with new indexes...');
    
    const activeCallsCollection = this.database.collection('activeCalls');
    
    // Test various query patterns
    const testQueries = [
      {
        name: 'Global active calls count',
        query: { status: 'active' },
        expectedIndex: 'idx_status_global'
      },
      {
        name: 'Client-specific active calls',
        query: { status: 'active', clientId: new ObjectId() },
        expectedIndex: 'idx_status_clientId'
      },
      {
        name: 'CallUUID lookup',
        query: { callUUID: 'test-uuid' },
        expectedIndex: 'idx_callUUID_unique'
      },
      {
        name: 'Cleanup query (timeout detection)',
        query: { startTime: { $lt: new Date(Date.now() - 600000) } },
        expectedIndex: 'idx_startTime_cleanup'
      }
    ];

    for (const test of testQueries) {
      try {
        const startTime = Date.now();
        const result = await activeCallsCollection.find(test.query).explain('executionStats');
        const executionTime = Date.now() - startTime;
        
        const indexUsed = result.executionStats.executionStages.indexName || 'Collection scan';
        
        console.log(`  📊 ${test.name}:`);
        console.log(`     └─ Execution time: ${executionTime}ms`);
        console.log(`     └─ Index used: ${indexUsed}`);
        
        if (indexUsed === test.expectedIndex) {
          console.log(`     └─ ✅ Optimal index used`);
        } else if (indexUsed === 'Collection scan') {
          console.log(`     └─ ⚠️  No index used (collection scan)`);
        } else {
          console.log(`     └─ ⚠️  Different index used than expected`);
        }
        
      } catch (error) {
        console.log(`  ❌ ${test.name}: Query test failed - ${error.message}`);
      }
    }
  }

  generateReport() {
    console.log('\n📋 ACTIVECALLS INDEX SETUP REPORT');
    console.log('=' .repeat(50));
    
    if (this.indexResults.created.length > 0) {
      console.log(`🆕 Indexes created (${this.indexResults.created.length}):`);
      this.indexResults.created.forEach(index => {
        console.log(`  - ${index}`);
      });
    }
    
    if (this.indexResults.existing.length > 0) {
      console.log(`\n✅ Indexes already existing (${this.indexResults.existing.length}):`);
      this.indexResults.existing.forEach(index => {
        console.log(`  - ${index}`);
      });
    }
    
    if (this.indexResults.errors.length > 0) {
      console.log(`\n❌ Index creation errors (${this.indexResults.errors.length}):`);
      this.indexResults.errors.forEach(error => {
        console.log(`  - ${error.index}: ${error.error}`);
      });
    }

    const totalIndexes = this.indexResults.created.length + this.indexResults.existing.length;
    console.log(`\n📊 Summary: ${totalIndexes} total performance indexes ready for telephony operations`);
    
    if (this.indexResults.errors.length === 0) {
      console.log('✅ All indexes successfully configured');
    } else {
      console.log('⚠️  Some index creation failed - review errors above');
    }

    return this.indexResults;
  }

  async run() {
    try {
      await this.initialize();
      await this.validateActiveCallsSchema();
      await this.createPerformanceIndexes();
      await this.createCampaignIndexes();
      await this.createRemainingIndexes();
      await this.testActiveCallsPerformance();
      
      return this.generateReport();
    } catch (error) {
      console.error('❌ Index setup failed:', error);
      throw error;
    } finally {
      if (client) {
        await client.close();
        console.log('\n🔒 Database connection closed');
      }
    }
  }
}

// Run the index setup if this script is called directly
if (require.main === module) {
  const indexManager = new ActiveCallsIndexManager();
  indexManager.run()
    .then((results) => {
      console.log('\n🎯 ActiveCalls index setup completed');
      if (results.errors.length === 0) {
        process.exit(0);
      } else {
        console.log('⚠️  Completed with some errors');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Index setup failed:', error);
      process.exit(1);
    });
}

module.exports = { ActiveCallsIndexManager };