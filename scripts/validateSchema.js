/**
 * Database Schema Validation Script
 * 
 * This script validates the current MongoDB database schema and identifies
 * required changes for the enhanced telephony system implementation.
 * 
 * Run with: node scripts/validateSchema.js
 */

const { connectToMongo, client } = require('../models/mongodb');
const { ObjectId } = require('mongodb');

class SchemaValidator {
  constructor() {
    this.database = null;
    this.validationResults = {
      existingCollections: {},
      requiredChanges: [],
      missingCollections: [],
      requiredIndexes: [],
      schemaGaps: []
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

  async validateExistingCollections() {
    console.log('\n🔍 Validating existing collections...');

    const collectionsToCheck = [
      'client',
      'plivoCampaign', 
      'plivo-list',
      'plivo-list-data',
      'plivoHangupData',
      'logData'
    ];

    for (const collectionName of collectionsToCheck) {
      try {
        const collection = this.database.collection(collectionName);
        const documentCount = await collection.countDocuments({});
        const sampleDoc = await collection.findOne({});
        const indexes = await collection.indexes();

        this.validationResults.existingCollections[collectionName] = {
          exists: true,
          documentCount: documentCount,
          sampleDocument: sampleDoc,
          indexes: indexes.map(idx => ({ name: idx.name, key: idx.key }))
        };

        console.log(`  ✅ ${collectionName}: ${documentCount} documents`);

      } catch (error) {
        this.validationResults.existingCollections[collectionName] = {
          exists: false,
          error: error.message
        };
        console.log(`  ❌ ${collectionName}: Not found or error - ${error.message}`);
      }
    }
  }

  async validateClientSchema() {
    console.log('\n🔍 Validating client collection schema...');
    
    const clientCollection = this.database.collection('client');
    const sampleClients = await clientCollection.find({}).limit(5).toArray();

    if (sampleClients.length === 0) {
      this.validationResults.schemaGaps.push({
        collection: 'client',
        issue: 'No sample documents found',
        severity: 'warning'
      });
      return;
    }

    // Check for maxConcurrentCalls field (required for Step 1.3)
    const clientsWithMaxConcurrent = await clientCollection.countDocuments({ 
      maxConcurrentCalls: { $exists: true } 
    });
    
    const totalClients = await clientCollection.countDocuments({});

    console.log(`  📊 Total clients: ${totalClients}`);
    console.log(`  📊 Clients with maxConcurrentCalls: ${clientsWithMaxConcurrent}`);

    if (clientsWithMaxConcurrent < totalClients) {
      this.validationResults.requiredChanges.push({
        collection: 'client',
        action: 'Add maxConcurrentCalls field',
        description: `${totalClients - clientsWithMaxConcurrent} clients missing maxConcurrentCalls field`,
        migrationRequired: true,
        defaultValue: 10
      });
    }

    // Analyze existing schema structure
    const commonFields = this.analyzeDocumentStructure(sampleClients, 'client');
    console.log(`  📋 Common fields found: ${commonFields.join(', ')}`);
  }

  async validateCampaignSchema() {
    console.log('\n🔍 Validating plivoCampaign collection schema...');
    
    const campaignCollection = this.database.collection('plivoCampaign');
    const sampleCampaigns = await campaignCollection.find({}).limit(5).toArray();
    const totalCampaigns = await campaignCollection.countDocuments({});

    console.log(`  📊 Total campaigns: ${totalCampaigns}`);

    if (sampleCampaigns.length === 0) {
      this.validationResults.schemaGaps.push({
        collection: 'plivoCampaign',
        issue: 'No sample documents found',
        severity: 'warning'
      });
      return;
    }

    // Check for new required fields for pause/resume functionality
    const requiredNewFields = [
      { field: 'status', defaultValue: 'completed' },
      { field: 'currentIndex', defaultValue: 0 },
      { field: 'totalContacts', defaultValue: null },
      { field: 'processedContacts', defaultValue: 0 },
      { field: 'heartbeat', defaultValue: null },
      { field: 'lastActivity', defaultValue: null },
      { field: 'containerId', defaultValue: null }
    ];

    for (const { field, defaultValue } of requiredNewFields) {
      const campaignsWithField = await campaignCollection.countDocuments({ 
        [field]: { $exists: true } 
      });

      console.log(`  📊 Campaigns with ${field}: ${campaignsWithField}`);

      if (campaignsWithField < totalCampaigns) {
        this.validationResults.requiredChanges.push({
          collection: 'plivoCampaign',
          action: `Add ${field} field`,
          description: `${totalCampaigns - campaignsWithField} campaigns missing ${field} field`,
          migrationRequired: true,
          defaultValue: defaultValue
        });
      }
    }

    // Analyze existing schema structure
    const commonFields = this.analyzeDocumentStructure(sampleCampaigns, 'plivoCampaign');
    console.log(`  📋 Common fields found: ${commonFields.join(', ')}`);
  }

  async validateActiveCallsCollection() {
    console.log('\n🔍 Validating activeCalls collection (new collection)...');
    
    try {
      const activeCallsCollection = this.database.collection('activeCalls');
      const documentCount = await activeCallsCollection.countDocuments({});
      
      console.log(`  ⚠️  activeCalls collection already exists with ${documentCount} documents`);
      this.validationResults.existingCollections['activeCalls'] = {
        exists: true,
        documentCount: documentCount
      };
    } catch (error) {
      console.log(`  ✅ activeCalls collection does not exist - ready for creation`);
      this.validationResults.missingCollections.push({
        name: 'activeCalls',
        purpose: 'Real-time call tracking for concurrency management',
        requiredSchema: {
          callUUID: 'String (Plivo identifier or generated for failed calls)',
          clientId: 'ObjectId (reference to client)',
          campaignId: 'ObjectId or null (reference to campaign, null for single calls)',
          from: 'String (calling number)',
          to: 'String (destination number)',
          status: 'String (active|completed|timeout|failed)',
          startTime: 'Date (when call was initiated)',
          endTime: 'Date or null (when call ended)',
          duration: 'Number or null (call duration in seconds)',
          endReason: 'String or null (hangup reason from Plivo)',
          failureReason: 'String or null (bot_not_ready|plivo_api_error|timeout)',
          warmupAttempts: 'Number or null (number of bot warmup attempts)',
          warmupDuration: 'Number or null (total warmup time in ms)'
        },
        requiredIndexes: [
          { key: { status: 1, clientId: 1 }, name: 'idx_status_clientId' },
          { key: { status: 1 }, name: 'idx_status_global' },
          { key: { startTime: 1 }, name: 'idx_startTime_cleanup' },
          { key: { callUUID: 1 }, name: 'idx_callUUID_unique' }
        ]
      });
    }
  }

  async validateRequiredIndexes() {
    console.log('\n🔍 Analyzing required indexes for performance...');

    // Define required indexes for each collection
    const requiredIndexes = {
      'client': [
        { key: { apiKey: 1 }, name: 'idx_client_apiKey', purpose: 'API authentication lookup' },
        { key: { email: 1 }, name: 'idx_client_email', purpose: 'Client login lookup' }
      ],
      'plivoCampaign': [
        { key: { status: 1, heartbeat: 1 }, name: 'idx_status_heartbeat', purpose: 'Orphan detection' },
        { key: { clientId: 1, status: 1 }, name: 'idx_clientId_status', purpose: 'Client campaign queries' },
        { key: { status: 1 }, name: 'idx_status', purpose: 'Active campaign filtering' }
      ],
      'activeCalls': [
        { key: { status: 1, clientId: 1 }, name: 'idx_status_clientId', purpose: 'Concurrency checks per client' },
        { key: { status: 1 }, name: 'idx_status_global', purpose: 'Global concurrency checks' },
        { key: { startTime: 1 }, name: 'idx_startTime_cleanup', purpose: 'Timeout cleanup process' },
        { key: { callUUID: 1 }, name: 'idx_callUUID', purpose: 'Webhook call lookup' }
      ],
      'plivo-list': [
        { key: { clientId: 1 }, name: 'idx_clientId', purpose: 'Client list queries' }
      ],
      'plivo-list-data': [
        { key: { listId: 1 }, name: 'idx_listId', purpose: 'Contact list queries' }
      ],
      'plivoHangupData': [
        { key: { campId: 1 }, name: 'idx_campId', purpose: 'Campaign report queries' }
      ],
      'logData': [
        { key: { campId: 1 }, name: 'idx_logdata_campId', purpose: 'Campaign log queries' }
      ]
    };

    for (const [collectionName, indexes] of Object.entries(requiredIndexes)) {
      if (!this.validationResults.existingCollections[collectionName]?.exists) {
        continue;
      }

      const collection = this.database.collection(collectionName);
      const existingIndexes = await collection.indexes();
      const existingIndexNames = existingIndexes.map(idx => idx.name);

      for (const requiredIndex of indexes) {
        if (!existingIndexNames.includes(requiredIndex.name)) {
          this.validationResults.requiredIndexes.push({
            collection: collectionName,
            index: requiredIndex,
            status: 'missing'
          });
        } else {
          console.log(`  ✅ ${collectionName}.${requiredIndex.name} - exists`);
        }
      }
    }
  }

  async testActiveCallsCreation() {
    console.log('\n🧪 Testing activeCalls collection creation...');

    try {
      const activeCallsCollection = this.database.collection('activeCalls');
      
      // Test document structure
      const testDoc = {
        callUUID: 'test-uuid-' + Date.now(),
        clientId: new ObjectId(),
        campaignId: new ObjectId(),
        from: '+1234567890',
        to: '+0987654321',
        status: 'active',
        startTime: new Date(),
        endTime: null,
        duration: null,
        endReason: null,
        failureReason: null,
        warmupAttempts: null,
        warmupDuration: null
      };

      // Insert test document
      const result = await activeCallsCollection.insertOne(testDoc);
      console.log(`  ✅ Test document inserted with ID: ${result.insertedId}`);

      // Test query performance
      const startTime = Date.now();
      await activeCallsCollection.findOne({ callUUID: testDoc.callUUID });
      const queryTime = Date.now() - startTime;
      console.log(`  ⏱️  Query time: ${queryTime}ms`);

      // Clean up test document
      await activeCallsCollection.deleteOne({ _id: result.insertedId });
      console.log(`  🧹 Test document cleaned up`);

    } catch (error) {
      console.error(`  ❌ Error testing activeCalls creation: ${error.message}`);
      this.validationResults.schemaGaps.push({
        collection: 'activeCalls',
        issue: 'Failed creation test',
        severity: 'error',
        error: error.message
      });
    }
  }

  analyzeDocumentStructure(documents, collectionName) {
    if (!documents || documents.length === 0) return [];

    const fieldCounts = {};
    const totalDocs = documents.length;

    documents.forEach(doc => {
      Object.keys(doc).forEach(field => {
        fieldCounts[field] = (fieldCounts[field] || 0) + 1;
      });
    });

    // Return fields present in at least 80% of documents
    return Object.keys(fieldCounts).filter(field => 
      fieldCounts[field] / totalDocs >= 0.8
    );
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  generateReport() {
    console.log('\n📋 SCHEMA VALIDATION REPORT');
    console.log('=' .repeat(50));

    // Existing Collections Summary
    console.log('\n📁 EXISTING COLLECTIONS:');
    Object.entries(this.validationResults.existingCollections).forEach(([name, info]) => {
      if (info.exists) {
        console.log(`  ✅ ${name}: ${info.documentCount} docs`);
      } else {
        console.log(`  ❌ ${name}: ${info.error}`);
      }
    });

    // Missing Collections
    if (this.validationResults.missingCollections.length > 0) {
      console.log('\n🆕 MISSING COLLECTIONS:');
      this.validationResults.missingCollections.forEach(col => {
        console.log(`  📋 ${col.name}: ${col.purpose}`);
      });
    }

    // Required Changes
    if (this.validationResults.requiredChanges.length > 0) {
      console.log('\n🔄 REQUIRED SCHEMA CHANGES:');
      this.validationResults.requiredChanges.forEach((change, index) => {
        console.log(`  ${index + 1}. ${change.collection}: ${change.action}`);
        console.log(`     └─ ${change.description}`);
        if (change.defaultValue !== undefined) {
          console.log(`     └─ Default value: ${change.defaultValue}`);
        }
      });
    }

    // Required Indexes
    if (this.validationResults.requiredIndexes.length > 0) {
      console.log('\n📊 MISSING INDEXES:');
      this.validationResults.requiredIndexes.forEach((idx, index) => {
        console.log(`  ${index + 1}. ${idx.collection}.${idx.index.name}`);
        console.log(`     └─ Purpose: ${idx.index.purpose}`);
      });
    }

    // Schema Gaps
    if (this.validationResults.schemaGaps.length > 0) {
      console.log('\n⚠️  SCHEMA GAPS:');
      this.validationResults.schemaGaps.forEach((gap, index) => {
        console.log(`  ${index + 1}. ${gap.collection}: ${gap.issue} (${gap.severity})`);
      });
    }

    console.log('\n✅ SCHEMA VALIDATION COMPLETE');
    return this.validationResults;
  }

  async run() {
    try {
      await this.initialize();
      await this.validateExistingCollections();
      await this.validateClientSchema();
      await this.validateCampaignSchema();
      await this.validateActiveCallsCollection();
      await this.testActiveCallsCreation();
      await this.validateRequiredIndexes();
      
      return this.generateReport();
    } catch (error) {
      console.error('❌ Schema validation failed:', error);
      throw error;
    } finally {
      if (client) {
        await client.close();
        console.log('\n🔒 Database connection closed');
      }
    }
  }
}

// Run the validation if this script is called directly
if (require.main === module) {
  const validator = new SchemaValidator();
  validator.run()
    .then((results) => {
      console.log('\n🎯 Validation results available for further processing');
    })
    .catch((error) => {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    });
}

module.exports = { SchemaValidator };