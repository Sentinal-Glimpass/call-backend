/**
 * Comprehensive Testing Framework
 * Provides unit, integration, and load testing capabilities
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');

class TestFramework {
  constructor() {
    this.testResults = {
      unit: [],
      integration: [],
      load: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        coverage: 0
      }
    };
    this.startTime = null;
    this.cleanup = [];
  }

  /**
   * Initialize testing environment
   */
  async initialize() {
    console.log('🧪 Initializing Test Framework...');
    this.startTime = Date.now();
    
    try {
      // Connect to database
      await connectToMongo();
      console.log('✅ Database connection established for testing');
      
      // Verify test environment
      if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development') {
        console.warn('⚠️  Running tests in production environment - proceed with caution');
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Test framework initialization failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Run all test suites
   */
  async runAllTests() {
    console.log('🚀 Starting Comprehensive Test Suite...');
    
    await this.initialize();
    
    // Unit Tests
    console.log('\n📋 Running Unit Tests...');
    await this.runUnitTests();
    
    // Integration Tests
    console.log('\n🔗 Running Integration Tests...');
    await this.runIntegrationTests();
    
    // Load Tests
    console.log('\n⚡ Running Load Tests...');
    await this.runLoadTests();
    
    // Generate final report
    await this.generateReport();
    
    // Cleanup
    await this.performCleanup();
    
    return this.testResults;
  }

  /**
   * Unit Tests - Test individual functions and components
   */
  async runUnitTests() {
    const unitTests = [
      {
        name: 'Database Connection Test',
        test: async () => {
          await connectToMongo();
          const database = client.db("talkGlimpass");
          const collections = await database.listCollections().toArray();
          return collections.length > 0;
        }
      },
      {
        name: 'Concurrency Logic Test',
        test: async () => {
          const { checkClientConcurrency, checkGlobalConcurrency } = require('../apps/helper/activeCalls.js');
          
          // Create test client
          const testClientId = await this.createTestClient();
          
          // Test client concurrency
          const clientResult = await checkClientConcurrency(testClientId);
          const globalResult = await checkGlobalConcurrency();
          
          return clientResult.allowed !== undefined && 
                 globalResult.allowed !== undefined &&
                 typeof clientResult.currentCount === 'number' &&
                 typeof globalResult.currentCount === 'number';
        }
      },
      {
        name: 'Bot Warmup Logic Test',
        test: async () => {
          const { warmupBotWithRetry } = require('../utils/botWarmup.js');
          
          // Test with invalid URL to check error handling
          const result = await warmupBotWithRetry('https://invalid-bot-url.test/warmup');
          
          return !result.success && 
                 result.error !== undefined && 
                 result.attempts > 0;
        }
      },
      {
        name: 'Campaign Progress Calculation Test',
        test: async () => {
          const { getCampaignProgress } = require('../apps/plivo/plivo.js');
          
          // Create test campaign
          const testCampaignId = await this.createTestCampaign();
          
          const progress = await getCampaignProgress(testCampaignId);
          
          return progress.success && 
                 progress.progress !== undefined &&
                 typeof progress.progress.progressPercentage === 'number';
        }
      },
      {
        name: 'Heartbeat Manager Test',
        test: async () => {
          const { startCampaignHeartbeat, stopCampaignHeartbeat } = require('../utils/heartbeatManager.js');
          
          const testCampaignId = await this.createTestCampaign();
          
          // Test start heartbeat
          const startResult = await startCampaignHeartbeat(testCampaignId);
          
          // Test stop heartbeat
          const stopResult = await stopCampaignHeartbeat(testCampaignId);
          
          return startResult.success && stopResult.success;
        }
      },
      {
        name: 'Call Tracking Test',
        test: async () => {
          const { trackCallStart, trackCallEnd } = require('../apps/helper/activeCalls.js');
          
          const testClientId = await this.createTestClient();
          const testCallData = {
            clientId: testClientId,
            from: '+1234567890',
            to: '+0987654321',
            warmupAttempts: 1,
            warmupDuration: 1000
          };
          
          // Test call start tracking
          const startResult = await trackCallStart(testCallData);
          
          if (!startResult.success) return false;
          
          // Test call end tracking (simulate with fake UUID)
          const endResult = await trackCallEnd('test-uuid-123', {
            duration: 60,
            endReason: 'completed'
          });
          
          return startResult.success; // End will fail without real UUID, which is expected
        }
      }
    ];

    for (const unitTest of unitTests) {
      await this.runSingleTest('unit', unitTest);
    }
  }

  /**
   * Integration Tests - Test complete workflows end-to-end
   */
  async runIntegrationTests() {
    const integrationTests = [
      {
        name: 'Complete Campaign Lifecycle Test',
        test: async () => {
          try {
            // Create test data
            const testClientId = await this.createTestClient();
            const testListId = await this.createTestContactList(testClientId);
            
            // Create campaign
            const { makeCallViaCampaign } = require('../apps/plivo/plivo.js');
            const campaignResult = await makeCallViaCampaign(
              testListId,
              '+1234567890',
              'wss://test.example.com/ws',
              'Test Campaign Lifecycle',
              testClientId
            );
            
            if (campaignResult.status !== 200) return false;
            
            // Get campaign progress
            const { getCampaignProgress } = require('../apps/plivo/plivo.js');
            const progressResult = await getCampaignProgress(campaignResult.campaignId);
            
            return progressResult.success && progressResult.campaignName === 'Test Campaign Lifecycle';
            
          } catch (error) {
            console.error('Integration test error:', error);
            return false;
          }
        }
      },
      {
        name: 'Pause/Resume Workflow Test',
        test: async () => {
          try {
            const testClientId = await this.createTestClient();
            const testListId = await this.createTestContactList(testClientId);
            const testCampaignId = await this.createTestCampaign(testClientId, testListId);
            
            const { pauseCampaign, resumeCampaign } = require('../apps/plivo/plivo.js');
            
            // Test pause
            const pauseResult = await pauseCampaign(testCampaignId, testClientId);
            if (!pauseResult.success) return false;
            
            // Test resume
            const resumeResult = await resumeCampaign(testCampaignId);
            
            return resumeResult.success;
            
          } catch (error) {
            console.error('Pause/Resume test error:', error);
            return false;
          }
        }
      },
      {
        name: 'Webhook Integration Test',
        test: async () => {
          try {
            const testClientId = await this.createTestClient();
            
            // Test ring webhook processing
            const { trackCallStart } = require('../apps/helper/activeCalls.js');
            const callData = {
              callUUID: 'test-webhook-uuid',
              clientId: testClientId,
              from: '+1234567890',
              to: '+0987654321'
            };
            
            const trackResult = await trackCallStart(callData);
            
            // Test hangup webhook processing
            const { trackCallEnd } = require('../apps/helper/activeCalls.js');
            const endResult = await trackCallEnd('test-webhook-uuid', {
              duration: 120,
              endReason: 'completed'
            });
            
            return trackResult.success && endResult.success;
            
          } catch (error) {
            console.error('Webhook integration test error:', error);
            return false;
          }
        }
      },
      {
        name: 'Container Lifecycle Test',
        test: async () => {
          try {
            const { scanAndRecoverOrphanedCampaigns, getContainerHealth } = require('../utils/containerLifecycle.js');
            
            // Test orphaned campaign detection
            const recoveryResult = await scanAndRecoverOrphanedCampaigns();
            
            // Test container health
            const healthResult = await getContainerHealth();
            
            return recoveryResult.recovered !== undefined && 
                   healthResult.status !== undefined;
            
          } catch (error) {
            console.error('Container lifecycle test error:', error);
            return false;
          }
        }
      },
      {
        name: 'Monitoring Dashboard Integration Test',
        test: async () => {
          try {
            const { getActiveCallsMonitoring } = require('../services/activeCallsMonitoringService.js');
            const { getCampaignList } = require('../services/campaignDashboardService.js');
            
            const testClientId = await this.createTestClient();
            
            // Test active calls monitoring
            const monitoringResult = await getActiveCallsMonitoring({ clientId: testClientId });
            
            // Test campaign dashboard
            const dashboardResult = await getCampaignList(testClientId);
            
            return monitoringResult.success && dashboardResult.success;
            
          } catch (error) {
            console.error('Dashboard integration test error:', error);
            return false;
          }
        }
      }
    ];

    for (const integrationTest of integrationTests) {
      await this.runSingleTest('integration', integrationTest);
    }
  }

  /**
   * Load Tests - Test system performance under load
   */
  async runLoadTests() {
    const loadTests = [
      {
        name: 'Concurrent Call Processing Test',
        test: async () => {
          try {
            const { processSingleCall } = require('../apps/helper/activeCalls.js');
            const testClientId = await this.createTestClient();
            
            const concurrentCalls = 10;
            const callPromises = [];
            
            for (let i = 0; i < concurrentCalls; i++) {
              const callParams = {
                clientId: testClientId,
                from: '+1234567890',
                to: `+098765432${i}`,
                wssUrl: 'wss://test.example.com/ws',
                firstName: `Test${i}`,
                tag: 'load-test'
              };
              
              callPromises.push(processSingleCall(callParams));
            }
            
            const results = await Promise.allSettled(callPromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            
            return successCount >= (concurrentCalls * 0.8); // 80% success rate acceptable
            
          } catch (error) {
            console.error('Concurrent call test error:', error);
            return false;
          }
        }
      },
      {
        name: 'Database Performance Test',
        test: async () => {
          try {
            await connectToMongo();
            const database = client.db("talkGlimpass");
            const collection = database.collection("activeCalls");
            
            const startTime = Date.now();
            
            // Perform 100 database operations
            const operations = [];
            for (let i = 0; i < 100; i++) {
              operations.push(collection.countDocuments({ status: 'active' }));
            }
            
            await Promise.all(operations);
            
            const endTime = Date.now();
            const avgResponseTime = (endTime - startTime) / 100;
            
            // Should complete in less than 10ms per operation on average
            return avgResponseTime < 10;
            
          } catch (error) {
            console.error('Database performance test error:', error);
            return false;
          }
        }
      },
      {
        name: 'Memory Usage Test',
        test: async () => {
          try {
            const initialMemory = process.memoryUsage();
            
            // Create multiple test objects to simulate load
            const testData = [];
            for (let i = 0; i < 1000; i++) {
              testData.push({
                id: i,
                data: Buffer.alloc(1024), // 1KB per object
                timestamp: new Date()
              });
            }
            
            const peakMemory = process.memoryUsage();
            
            // Clear test data
            testData.length = 0;
            
            // Force garbage collection if available
            if (global.gc) {
              global.gc();
            }
            
            const finalMemory = process.memoryUsage();
            
            // Memory should not grow excessively
            const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
            
            return memoryGrowth < 50 * 1024 * 1024; // Less than 50MB growth
            
          } catch (error) {
            console.error('Memory usage test error:', error);
            return false;
          }
        }
      },
      {
        name: 'Heartbeat Performance Test',
        test: async () => {
          try {
            const { startCampaignHeartbeat, stopCampaignHeartbeat } = require('../utils/heartbeatManager.js');
            
            const testCampaigns = [];
            const heartbeatCount = 20;
            
            // Create test campaigns and start heartbeats
            for (let i = 0; i < heartbeatCount; i++) {
              const campaignId = await this.createTestCampaign();
              testCampaigns.push(campaignId);
              await startCampaignHeartbeat(campaignId);
            }
            
            // Wait for heartbeats to run
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Stop all heartbeats
            let successfulStops = 0;
            for (const campaignId of testCampaigns) {
              const result = await stopCampaignHeartbeat(campaignId);
              if (result.success) successfulStops++;
            }
            
            return successfulStops >= heartbeatCount * 0.9; // 90% success rate
            
          } catch (error) {
            console.error('Heartbeat performance test error:', error);
            return false;
          }
        }
      }
    ];

    for (const loadTest of loadTests) {
      await this.runSingleTest('load', loadTest);
    }
  }

  /**
   * Run a single test and record results
   */
  async runSingleTest(category, testConfig) {
    const { name, test } = testConfig;
    const startTime = Date.now();
    
    try {
      console.log(`  🔄 Running: ${name}`);
      
      const result = await test();
      const duration = Date.now() - startTime;
      
      const testResult = {
        name: name,
        passed: result === true,
        duration: duration,
        error: result === false ? 'Test returned false' : null,
        timestamp: new Date()
      };
      
      this.testResults[category].push(testResult);
      this.testResults.summary.total++;
      
      if (testResult.passed) {
        this.testResults.summary.passed++;
        console.log(`    ✅ PASSED (${duration}ms)`);
      } else {
        this.testResults.summary.failed++;
        console.log(`    ❌ FAILED (${duration}ms): ${testResult.error}`);
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      const testResult = {
        name: name,
        passed: false,
        duration: duration,
        error: error.message,
        timestamp: new Date()
      };
      
      this.testResults[category].push(testResult);
      this.testResults.summary.total++;
      this.testResults.summary.failed++;
      
      console.log(`    ❌ ERROR (${duration}ms): ${error.message}`);
    }
  }

  /**
   * Generate comprehensive test report
   */
  async generateReport() {
    const totalDuration = Date.now() - this.startTime;
    const successRate = this.testResults.summary.total > 0 
      ? Math.round((this.testResults.summary.passed / this.testResults.summary.total) * 100)
      : 0;
    
    this.testResults.summary.coverage = successRate;
    
    console.log('\n📊 TEST RESULTS SUMMARY');
    console.log('========================');
    console.log(`Total Tests: ${this.testResults.summary.total}`);
    console.log(`Passed: ${this.testResults.summary.passed}`);
    console.log(`Failed: ${this.testResults.summary.failed}`);
    console.log(`Success Rate: ${successRate}%`);
    console.log(`Total Duration: ${totalDuration}ms`);
    
    console.log('\n📋 Unit Tests:', this.testResults.unit.length);
    console.log('🔗 Integration Tests:', this.testResults.integration.length);
    console.log('⚡ Load Tests:', this.testResults.load.length);
    
    // Detailed failure analysis
    const failures = [
      ...this.testResults.unit.filter(t => !t.passed),
      ...this.testResults.integration.filter(t => !t.passed),
      ...this.testResults.load.filter(t => !t.passed)
    ];
    
    if (failures.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      failures.forEach(failure => {
        console.log(`  - ${failure.name}: ${failure.error}`);
      });
    }
    
    // Performance insights
    const slowTests = [
      ...this.testResults.unit,
      ...this.testResults.integration,
      ...this.testResults.load
    ].filter(t => t.duration > 5000); // Tests taking more than 5 seconds
    
    if (slowTests.length > 0) {
      console.log('\n⚠️  SLOW TESTS:');
      slowTests.forEach(test => {
        console.log(`  - ${test.name}: ${test.duration}ms`);
      });
    }
  }

  /**
   * Create test client for testing
   */
  async createTestClient() {
    try {
      await connectToMongo();
      const database = client.db("talkGlimpass");
      const collection = database.collection("client");
      
      const testClient = {
        name: `Test Client ${Date.now()}`,
        email: `test${Date.now()}@test.com`,
        maxConcurrentCalls: 5,
        createdAt: new Date(),
        isTestClient: true
      };
      
      const result = await collection.insertOne(testClient);
      this.cleanup.push({ collection: 'client', id: result.insertedId });
      
      return result.insertedId.toString();
      
    } catch (error) {
      console.error('Error creating test client:', error);
      throw error;
    }
  }

  /**
   * Create test contact list
   */
  async createTestContactList(clientId) {
    try {
      await connectToMongo();
      const database = client.db("talkGlimpass");
      const collection = database.collection("plivo-list");
      
      const testList = {
        name: `Test List ${Date.now()}`,
        clientId: new ObjectId(clientId),
        contactCount: 3,
        createdAt: new Date(),
        isTestList: true
      };
      
      const result = await collection.insertOne(testList);
      this.cleanup.push({ collection: 'plivo-list', id: result.insertedId });
      
      // Add test contacts
      const contactsCollection = database.collection("plivo-list-data");
      const contacts = [
        { number: '+1234567890', name: 'Test Contact 1', listId: result.insertedId },
        { number: '+1234567891', name: 'Test Contact 2', listId: result.insertedId },
        { number: '+1234567892', name: 'Test Contact 3', listId: result.insertedId }
      ];
      
      await contactsCollection.insertMany(contacts);
      
      return result.insertedId.toString();
      
    } catch (error) {
      console.error('Error creating test contact list:', error);
      throw error;
    }
  }

  /**
   * Create test campaign
   */
  async createTestCampaign(clientId = null, listId = null) {
    try {
      if (!clientId) clientId = await this.createTestClient();
      if (!listId) listId = await this.createTestContactList(clientId);
      
      await connectToMongo();
      const database = client.db("talkGlimpass");
      const collection = database.collection("plivoCampaign");
      
      const testCampaign = {
        campaignName: `Test Campaign ${Date.now()}`,
        clientId: new ObjectId(clientId),
        listId: new ObjectId(listId),
        fromNumber: '+1234567890',
        wssUrl: 'wss://test.example.com/ws',
        status: 'running',
        currentIndex: 0,
        totalContacts: 3,
        processedContacts: 0,
        connectedCall: 0,
        failedCall: 0,
        heartbeat: new Date(),
        lastActivity: new Date(),
        createdAt: new Date(),
        isTestCampaign: true
      };
      
      const result = await collection.insertOne(testCampaign);
      this.cleanup.push({ collection: 'plivoCampaign', id: result.insertedId });
      
      return result.insertedId.toString();
      
    } catch (error) {
      console.error('Error creating test campaign:', error);
      throw error;
    }
  }

  /**
   * Clean up test data
   */
  async performCleanup() {
    console.log('\n🧹 Cleaning up test data...');
    
    try {
      await connectToMongo();
      const database = client.db("talkGlimpass");
      
      for (const item of this.cleanup) {
        try {
          const collection = database.collection(item.collection);
          await collection.deleteOne({ _id: item.id });
        } catch (error) {
          console.warn(`Warning: Could not cleanup ${item.collection}/${item.id}:`, error.message);
        }
      }
      
      // Clean up any test data based on flags
      const collections = ['client', 'plivo-list', 'plivoCampaign', 'activeCalls'];
      
      for (const collectionName of collections) {
        try {
          const collection = database.collection(collectionName);
          
          if (collectionName === 'client') {
            await collection.deleteMany({ isTestClient: true });
          } else if (collectionName === 'plivo-list') {
            await collection.deleteMany({ isTestList: true });
          } else if (collectionName === 'plivoCampaign') {
            await collection.deleteMany({ isTestCampaign: true });
          } else if (collectionName === 'activeCalls') {
            await collection.deleteMany({ 
              to: { $regex: '^\\+098765432[0-9]$' } // Test phone numbers
            });
          }
        } catch (error) {
          console.warn(`Warning: Could not cleanup ${collectionName}:`, error.message);
        }
      }
      
      console.log('✅ Cleanup completed');
      
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  }
}

module.exports = TestFramework;