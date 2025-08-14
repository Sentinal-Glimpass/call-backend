/**
 * Database Optimization and Performance Validation Service
 * Validates database indexes and provides performance optimization recommendations
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');

/**
 * Validate all database indexes and performance
 * @returns {Promise<Object>} Validation results with performance metrics
 */
async function validateDatabasePerformance() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    console.log('🔍 Starting comprehensive database performance validation...');
    
    const validationResults = {
      timestamp: new Date(),
      collections: {},
      indexes: {},
      performance: {},
      recommendations: [],
      overall: {
        status: 'healthy',
        score: 100
      }
    };
    
    // Define critical collections and their expected indexes
    const criticalCollections = {
      plivoCampaign: {
        expectedIndexes: [
          { fields: { status: 1, heartbeat: 1 }, purpose: 'Orphaned campaign detection' },
          { fields: { clientId: 1, status: 1 }, purpose: 'Client campaign queries' },
          { fields: { status: 1, createdAt: -1 }, purpose: 'Campaign listing by status' },
          { fields: { containerId: 1, status: 1 }, purpose: 'Container-specific queries' }
        ],
        criticalQueries: [
          { query: { status: "running" }, description: "Active campaigns" },
          { query: { status: "running", heartbeat: { $lt: new Date(Date.now() - 120000) } }, description: "Stale campaigns" }
        ]
      },
      activeCalls: {
        expectedIndexes: [
          { fields: { status: 1, clientId: 1 }, purpose: 'Client concurrency checks' },
          { fields: { status: 1 }, purpose: 'Global concurrency queries' },
          { fields: { callUUID: 1 }, purpose: 'Webhook UUID lookups' },
          { fields: { startTime: 1, status: 1 }, purpose: 'Timeout cleanup' },
          { fields: { clientId: 1, startTime: -1 }, purpose: 'Client call history' }
        ],
        criticalQueries: [
          { query: { status: { $in: ['processed', 'ringing', 'ongoing'] } }, description: "Active calls count" },
          { query: { status: { $in: ['processed', 'ringing', 'ongoing'] }, clientId: new ObjectId() }, description: "Client active calls" }
        ]
      },
      client: {
        expectedIndexes: [
          { fields: { _id: 1 }, purpose: 'Primary key (built-in)' },
          { fields: { email: 1 }, purpose: 'User lookup' },
          { fields: { apiKey: 1 }, purpose: 'API authentication' }
        ],
        criticalQueries: [
          { query: { _id: new ObjectId() }, description: "Client lookup by ID" }
        ]
      },
      'plivo-list': {
        expectedIndexes: [
          { fields: { clientId: 1, createdAt: -1 }, purpose: 'Client list queries' },
          { fields: { name: 1, clientId: 1 }, purpose: 'List name uniqueness' }
        ],
        criticalQueries: [
          { query: { clientId: new ObjectId() }, description: "Client lists" }
        ]
      },
      'plivo-list-data': {
        expectedIndexes: [
          { fields: { listId: 1 }, purpose: 'List contact queries' },
          { fields: { number: 1, listId: 1 }, purpose: 'Contact lookup' }
        ],
        criticalQueries: [
          { query: { listId: new ObjectId() }, description: "List contacts" }
        ]
      }
    };
    
    // Validate each collection
    for (const [collectionName, config] of Object.entries(criticalCollections)) {
      console.log(`  📊 Validating collection: ${collectionName}`);
      
      const collectionResult = await validateCollection(database, collectionName, config);
      validationResults.collections[collectionName] = collectionResult;
      
      // Update overall score based on collection health
      if (collectionResult.status === 'warning') {
        validationResults.overall.score -= 10;
        if (validationResults.overall.status === 'healthy') {
          validationResults.overall.status = 'warning';
        }
      } else if (collectionResult.status === 'critical') {
        validationResults.overall.score -= 25;
        validationResults.overall.status = 'critical';
      }
    }
    
    // Comprehensive performance testing
    console.log('  ⚡ Running performance benchmarks...');
    validationResults.performance = await runPerformanceBenchmarks(database);
    
    // Generate optimization recommendations
    validationResults.recommendations = generateOptimizationRecommendations(validationResults);
    
    console.log('✅ Database validation completed');
    
    return {
      success: true,
      data: validationResults
    };
    
  } catch (error) {
    console.error('❌ Error validating database performance:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Validate a specific collection
 */
async function validateCollection(database, collectionName, config) {
  try {
    const collection = database.collection(collectionName);
    
    // Check if collection exists
    const collections = await database.listCollections({ name: collectionName }).toArray();
    if (collections.length === 0) {
      return {
        status: 'critical',
        exists: false,
        error: 'Collection does not exist'
      };
    }
    
    // Get collection stats
    let stats;
    try {
      stats = await database.runCommand({ collStats: collectionName });
    } catch (error) {
      stats = { count: 0, size: 0, avgObjSize: 0 };
    }
    
    // Check indexes
    const existingIndexes = await collection.listIndexes().toArray();
    const indexValidation = validateIndexes(existingIndexes, config.expectedIndexes);
    
    // Performance test critical queries
    const queryPerformance = await testQueryPerformance(collection, config.criticalQueries);
    
    // Determine collection status
    let status = 'healthy';
    const issues = [];
    
    if (indexValidation.missingIndexes.length > 0) {
      status = 'warning';
      issues.push(`Missing ${indexValidation.missingIndexes.length} recommended indexes`);
    }
    
    if (queryPerformance.slowQueries > 0) {
      status = 'warning';
      issues.push(`${queryPerformance.slowQueries} slow queries detected`);
    }
    
    if (queryPerformance.averageResponseTime > 100) { // > 100ms
      if (status !== 'critical') status = 'warning';
      issues.push('High average query response time');
    }
    
    return {
      status,
      exists: true,
      issues,
      stats: {
        count: stats.count || 0,
        size: stats.size || 0,
        avgObjSize: stats.avgObjSize || 0,
        indexCount: existingIndexes.length
      },
      indexes: indexValidation,
      performance: queryPerformance
    };
    
  } catch (error) {
    return {
      status: 'critical',
      exists: false,
      error: error.message
    };
  }
}

/**
 * Validate indexes against expected configuration
 */
function validateIndexes(existingIndexes, expectedIndexes) {
  const existingIndexMap = new Map();
  
  existingIndexes.forEach(index => {
    const keyString = JSON.stringify(index.key);
    existingIndexMap.set(keyString, index);
  });
  
  const missingIndexes = [];
  const presentIndexes = [];
  
  expectedIndexes.forEach(expectedIndex => {
    const keyString = JSON.stringify(expectedIndex.fields);
    if (existingIndexMap.has(keyString)) {
      presentIndexes.push({
        fields: expectedIndex.fields,
        purpose: expectedIndex.purpose,
        exists: true
      });
    } else {
      missingIndexes.push({
        fields: expectedIndex.fields,
        purpose: expectedIndex.purpose,
        exists: false
      });
    }
  });
  
  return {
    total: expectedIndexes.length,
    present: presentIndexes.length,
    missing: missingIndexes.length,
    presentIndexes,
    missingIndexes
  };
}

/**
 * Test query performance
 */
async function testQueryPerformance(collection, queries) {
  const results = [];
  let totalTime = 0;
  let slowQueries = 0;
  
  for (const queryConfig of queries) {
    try {
      const startTime = Date.now();
      
      // Execute query with explain to get performance data
      const explainResult = await collection.find(queryConfig.query).explain('executionStats');
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      totalTime += responseTime;
      
      if (responseTime > 50) { // > 50ms considered slow
        slowQueries++;
      }
      
      results.push({
        query: queryConfig.query,
        description: queryConfig.description,
        responseTime,
        executionStats: {
          totalExamined: explainResult.executionStats?.totalDocsExamined || 0,
          totalReturned: explainResult.executionStats?.totalDocsReturned || 0,
          indexUsed: explainResult.executionStats?.executionStages?.indexName ? true : false
        }
      });
      
    } catch (error) {
      results.push({
        query: queryConfig.query,
        description: queryConfig.description,
        error: error.message
      });
    }
  }
  
  return {
    totalQueries: queries.length,
    averageResponseTime: queries.length > 0 ? Math.round(totalTime / queries.length) : 0,
    slowQueries,
    results
  };
}

/**
 * Run comprehensive performance benchmarks
 */
async function runPerformanceBenchmarks(database) {
  const benchmarks = {};
  
  try {
    // Test concurrent read operations
    const concurrentReadStart = Date.now();
    const readPromises = [];
    
    for (let i = 0; i < 10; i++) {
      readPromises.push(
        database.collection('plivoCampaign').countDocuments({ status: 'running' })
      );
    }
    
    await Promise.all(readPromises);
    benchmarks.concurrentReads = Date.now() - concurrentReadStart;
    
    // Test write performance
    const writeStart = Date.now();
    const testCollection = database.collection('performanceTest');
    
    const writePromises = [];
    for (let i = 0; i < 5; i++) {
      writePromises.push(
        testCollection.insertOne({
          testData: `benchmark-${i}`,
          timestamp: new Date(),
          index: i
        })
      );
    }
    
    await Promise.all(writePromises);
    benchmarks.concurrentWrites = Date.now() - writeStart;
    
    // Cleanup test data
    await testCollection.deleteMany({ testData: { $regex: '^benchmark-' } });
    
    // Test aggregation performance
    const aggregationStart = Date.now();
    await database.collection('plivoCampaign').aggregate([
      { $match: { status: { $in: ['running', 'paused', 'completed'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    benchmarks.aggregation = Date.now() - aggregationStart;
    
    // Overall performance rating
    let performanceRating = 'excellent';
    if (benchmarks.concurrentReads > 200 || benchmarks.concurrentWrites > 500) {
      performanceRating = 'good';
    }
    if (benchmarks.concurrentReads > 500 || benchmarks.concurrentWrites > 1000) {
      performanceRating = 'poor';
    }
    
    benchmarks.overall = performanceRating;
    
  } catch (error) {
    benchmarks.error = error.message;
    benchmarks.overall = 'error';
  }
  
  return benchmarks;
}

/**
 * Generate optimization recommendations
 */
function generateOptimizationRecommendations(validationResults) {
  const recommendations = [];
  
  // Check for missing indexes
  Object.entries(validationResults.collections).forEach(([collectionName, result]) => {
    if (result.indexes && result.indexes.missingIndexes.length > 0) {
      result.indexes.missingIndexes.forEach(missingIndex => {
        recommendations.push({
          type: 'missing_index',
          priority: 'high',
          collection: collectionName,
          recommendation: `Create index on ${JSON.stringify(missingIndex.fields)}`,
          purpose: missingIndex.purpose,
          command: `db.${collectionName}.createIndex(${JSON.stringify(missingIndex.fields)})`
        });
      });
    }
    
    // Check for performance issues
    if (result.performance && result.performance.slowQueries > 0) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        collection: collectionName,
        recommendation: `Review and optimize ${result.performance.slowQueries} slow queries`,
        details: result.performance.results.filter(r => r.responseTime > 50)
      });
    }
    
    // Check collection size
    if (result.stats && result.stats.count > 100000) {
      recommendations.push({
        type: 'maintenance',
        priority: 'low',
        collection: collectionName,
        recommendation: 'Consider implementing data archiving strategy for large collection',
        details: `Collection has ${result.stats.count} documents`
      });
    }
  });
  
  // Check overall performance
  if (validationResults.performance.overall === 'poor') {
    recommendations.push({
      type: 'infrastructure',
      priority: 'high',
      recommendation: 'Database performance is poor - consider scaling database resources',
      details: validationResults.performance
    });
  }
  
  return recommendations;
}

/**
 * Apply database optimizations
 */
async function applyOptimizations(optimizations = []) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    console.log('🔧 Applying database optimizations...');
    
    const results = {
      applied: [],
      failed: [],
      total: optimizations.length
    };
    
    for (const optimization of optimizations) {
      try {
        if (optimization.type === 'missing_index') {
          console.log(`  🔨 Creating index on ${optimization.collection}...`);
          
          const collection = database.collection(optimization.collection);
          await collection.createIndex(JSON.parse(optimization.command.match(/createIndex\((.*)\)/)[1]));
          
          results.applied.push({
            type: optimization.type,
            collection: optimization.collection,
            action: 'Index created successfully'
          });
        }
        
      } catch (error) {
        console.error(`  ❌ Failed to apply optimization: ${error.message}`);
        results.failed.push({
          type: optimization.type,
          collection: optimization.collection,
          error: error.message
        });
      }
    }
    
    console.log(`✅ Optimizations completed: ${results.applied.length} applied, ${results.failed.length} failed`);
    
    return {
      success: true,
      results
    };
    
  } catch (error) {
    console.error('❌ Error applying optimizations:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get database health summary
 */
async function getDatabaseHealthSummary() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // Get database stats
    const dbStats = await database.stats();
    
    // Get collection counts
    const collections = ['plivoCampaign', 'activeCalls', 'client', 'plivo-list', 'plivo-list-data'];
    const collectionStats = {};
    
    for (const collectionName of collections) {
      try {
        const count = await database.collection(collectionName).countDocuments();
        collectionStats[collectionName] = count;
      } catch (error) {
        collectionStats[collectionName] = 0;
      }
    }
    
    // Calculate health score
    let healthScore = 100;
    let status = 'healthy';
    
    // Check for reasonable collection sizes
    if (collectionStats.activeCalls > 10000) {
      healthScore -= 10;
      status = 'warning';
    }
    
    if (collectionStats.plivoCampaign > 50000) {
      healthScore -= 15;
      if (status !== 'critical') status = 'warning';
    }
    
    return {
      success: true,
      health: {
        status,
        score: Math.max(0, healthScore),
        database: {
          size: dbStats.dataSize,
          collections: dbStats.collections,
          indexes: dbStats.indexes
        },
        collections: collectionStats,
        timestamp: new Date()
      }
    };
    
  } catch (error) {
    console.error('❌ Error getting database health:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  validateDatabasePerformance,
  applyOptimizations,
  getDatabaseHealthSummary
};