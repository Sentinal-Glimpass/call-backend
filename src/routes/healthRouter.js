/**
 * Health Check Router
 * Provides monitoring endpoints for production deployments
 */

const express = require('express');
const router = express.Router();
const { connectToMongo, client } = require('../../models/mongodb');
const os = require('os');
const fs = require('fs');

// Cloud Run specific imports
const { getContainerHealth, getContainerInfo } = require('../utils/containerLifecycle');
const { getAllHeartbeatStatuses, detectStaleHeartbeats } = require('../utils/heartbeatManager');
const { getConcurrencyStats } = require('../apps/helper/activeCalls');

// Enhanced monitoring services
const { getSystemUtilization } = require('../services/activeCallsMonitoringService');
const { getDatabaseHealthSummary, validateDatabasePerformance } = require('../services/databaseOptimizationService');

/**
 * @swagger
 * tags:
 *   name: Health
 *   description: Health check and monitoring endpoints
 */

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Basic health check
 *     description: Returns server status and basic metrics
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Process uptime in seconds
 *                 environment:
 *                   type: string
 *                   example: "production"
 *       503:
 *         description: Server is unhealthy
 */
router.get('/', async (req, res) => {
  try {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    };

    res.status(200).json(healthData);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * @swagger
 * /health/detailed:
 *   get:
 *     tags: [Health]
 *     summary: Detailed health check
 *     description: Returns comprehensive server health information including database connectivity
 *     responses:
 *       200:
 *         description: Detailed health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 services:
 *                   type: object
 *                 system:
 *                   type: object
 *       503:
 *         description: One or more services are unhealthy
 */
router.get('/detailed', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {},
    system: {}
  };

  let overallStatus = 'healthy';

  try {
    // Check MongoDB connectivity
    try {
      await connectToMongo();
      const admin = client.db().admin();
      await admin.ping();
      healthCheck.services.mongodb = {
        status: 'healthy',
        responseTime: Date.now()
      };
    } catch (mongoError) {
      healthCheck.services.mongodb = {
        status: 'unhealthy',
        error: mongoError.message
      };
      overallStatus = 'degraded';
    }

    // Check ArangoDB connectivity (basic check - not connecting due to DNS issues)
    healthCheck.services.arangodb = {
      status: process.env.ARANGO_PASSWORD ? 'configured' : 'not_configured',
      note: 'Configuration check only - connection not tested'
    };

    // System metrics
    healthCheck.system = {
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external,
        rss: process.memoryUsage().rss
      },
      cpu: {
        usage: process.cpuUsage(),
        loadAverage: os.loadavg()
      },
      uptime: {
        process: process.uptime(),
        system: os.uptime()
      },
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version
    };

    // Check disk space for upload directories
    try {
      const uploadDirs = ['uploads', 'list-uploads', 'logs'];
      healthCheck.system.diskSpace = {};
      
      for (const dir of uploadDirs) {
        if (fs.existsSync(dir)) {
          const stats = fs.statSync(dir);
          healthCheck.system.diskSpace[dir] = {
            exists: true,
            isDirectory: stats.isDirectory(),
            size: getDirectorySize(dir)
          };
        } else {
          healthCheck.system.diskSpace[dir] = {
            exists: false
          };
        }
      }
    } catch (diskError) {
      healthCheck.system.diskSpace = {
        error: diskError.message
      };
    }

    healthCheck.status = overallStatus;
    
    const statusCode = overallStatus === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthCheck);

  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      services: healthCheck.services,
      system: healthCheck.system
    });
  }
});

/**
 * @swagger
 * /health/readiness:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: Kubernetes-style readiness probe - checks if app is ready to receive traffic
 *     responses:
 *       200:
 *         description: Application is ready
 *       503:
 *         description: Application is not ready
 */
router.get('/readiness', async (req, res) => {
  try {
    // Check critical dependencies
    await connectToMongo();
    const admin = client.db().admin();
    await admin.ping();

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * @swagger
 * /health/liveness:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Kubernetes-style liveness probe - checks if app is running
 *     responses:
 *       200:
 *         description: Application is alive
 *       503:
 *         description: Application should be restarted
 */
router.get('/liveness', (req, res) => {
  // Simple liveness check - if we can respond, we're alive
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * @swagger
 * /health/container:
 *   get:
 *     tags: [Health]
 *     summary: Cloud Run container health
 *     description: Returns container-specific health information for Cloud Run deployment
 *     responses:
 *       200:
 *         description: Container health information
 *       503:
 *         description: Container is unhealthy
 */
router.get('/container', async (req, res) => {
  try {
    const containerHealth = await getContainerHealth();
    const containerInfo = getContainerInfo();
    
    const status = containerHealth.status === 'healthy' ? 200 : 503;
    
    res.status(status).json({
      ...containerHealth,
      info: containerInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /health/heartbeats:
 *   get:
 *     tags: [Health]
 *     summary: Campaign heartbeat status
 *     description: Returns status of all active campaign heartbeats for monitoring
 *     responses:
 *       200:
 *         description: Heartbeat status information
 */
router.get('/heartbeats', async (req, res) => {
  try {
    const heartbeatStatuses = getAllHeartbeatStatuses();
    const staleHeartbeats = await detectStaleHeartbeats();
    
    res.status(200).json({
      status: 'healthy',
      active: heartbeatStatuses,
      stale: staleHeartbeats,
      summary: {
        totalActive: heartbeatStatuses.totalActive,
        totalStale: staleHeartbeats.length,
        containerId: heartbeatStatuses.containerId
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /health/concurrency:
 *   get:
 *     tags: [Health]
 *     summary: Call concurrency status
 *     description: Returns current call concurrency utilization for monitoring
 *     responses:
 *       200:
 *         description: Concurrency status information
 */
router.get('/concurrency', async (req, res) => {
  try {
    const concurrencyStats = await getConcurrencyStats();
    
    // Consider high utilization as warning status
    const isHighUtilization = concurrencyStats.global?.utilization > 80;
    const status = isHighUtilization ? 'warning' : 'healthy';
    
    res.status(200).json({
      status: status,
      concurrency: concurrencyStats,
      thresholds: {
        warningUtilization: 80,
        criticalUtilization: 95
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /health/cloud-run:
 *   get:
 *     tags: [Health]
 *     summary: Comprehensive Cloud Run health check
 *     description: Returns comprehensive health status for Cloud Run deployment including container, heartbeats, and concurrency
 *     responses:
 *       200:
 *         description: Comprehensive health information
 *       503:
 *         description: One or more components are unhealthy
 */
router.get('/cloud-run', async (req, res) => {
  try {
    const containerHealth = await getContainerHealth();
    const heartbeatStatuses = getAllHeartbeatStatuses();
    const staleHeartbeats = await detectStaleHeartbeats();
    const concurrencyStats = await getConcurrencyStats();
    const containerInfo = getContainerInfo();
    
    // Determine overall health status
    let overallStatus = 'healthy';
    const warnings = [];
    
    if (containerHealth.status !== 'healthy') {
      overallStatus = 'degraded';
      warnings.push(`Container status: ${containerHealth.status}`);
    }
    
    if (staleHeartbeats.length > 0) {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      warnings.push(`${staleHeartbeats.length} stale heartbeats detected`);
    }
    
    if (concurrencyStats.global?.utilization > 95) {
      overallStatus = 'critical';
      warnings.push(`Critical concurrency utilization: ${concurrencyStats.global.utilization}%`);
    } else if (concurrencyStats.global?.utilization > 80) {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      warnings.push(`High concurrency utilization: ${concurrencyStats.global.utilization}%`);
    }
    
    const healthData = {
      status: overallStatus,
      warnings: warnings,
      container: {
        ...containerHealth,
        info: containerInfo
      },
      campaigns: {
        activeHeartbeats: heartbeatStatuses.totalActive,
        staleHeartbeats: staleHeartbeats.length,
        managedCampaigns: containerHealth.managedCampaigns || 0
      },
      concurrency: concurrencyStats,
      timestamp: new Date().toISOString()
    };
    
    const statusCode = overallStatus === 'critical' ? 503 : 200;
    res.status(statusCode).json(healthData);
    
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to calculate directory size
function getDirectorySize(dirPath) {
  let totalSize = 0;
  
  try {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const filePath = `${dirPath}/${file}`;
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        totalSize += getDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (error) {
    // If we can't read the directory, return 0
    return 0;
  }
  
  return totalSize;
}

/**
 * @swagger
 * /health/comprehensive:
 *   get:
 *     tags: [Health]
 *     summary: Comprehensive system health check
 *     description: Returns complete system health including database, performance, and integration status
 *     responses:
 *       200:
 *         description: Comprehensive health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, warning, critical]
 *                 score:
 *                   type: number
 *                   description: Overall health score (0-100)
 *                 components:
 *                   type: object
 *                 database:
 *                   type: object
 *                 performance:
 *                   type: object
 *                 recommendations:
 *                   type: array
 *       503:
 *         description: System is unhealthy
 */
router.get('/comprehensive', async (req, res) => {
  try {
    console.log('🏥 Running comprehensive system health check...');
    
    const healthCheck = {
      status: 'healthy',
      score: 100,
      timestamp: new Date().toISOString(),
      components: {},
      database: {},
      performance: {},
      recommendations: [],
      warnings: []
    };
    
    // Basic connectivity checks
    try {
      await connectToMongo();
      const admin = client.db().admin();
      await admin.ping();
      healthCheck.components.mongodb = { status: 'healthy' };
    } catch (error) {
      healthCheck.components.mongodb = { 
        status: 'critical', 
        error: error.message 
      };
      healthCheck.score -= 30;
      healthCheck.status = 'critical';
      healthCheck.warnings.push('MongoDB connectivity failed');
    }
    
    // Container health (Cloud Run specific)
    try {
      const containerHealth = await getContainerHealth();
      healthCheck.components.container = containerHealth;
      
      if (containerHealth.status !== 'healthy') {
        healthCheck.score -= 15;
        if (healthCheck.status !== 'critical') healthCheck.status = 'warning';
        healthCheck.warnings.push(`Container status: ${containerHealth.status}`);
      }
    } catch (error) {
      healthCheck.components.container = { 
        status: 'error', 
        error: error.message 
      };
      healthCheck.score -= 10;
    }
    
    // System utilization
    try {
      const utilization = await getSystemUtilization();
      if (utilization.success) {
        healthCheck.performance.utilization = utilization.utilization;
        
        const concurrencyUtil = utilization.utilization.concurrency.percentage;
        if (concurrencyUtil > 95) {
          healthCheck.score -= 25;
          healthCheck.status = 'critical';
          healthCheck.warnings.push(`Critical concurrency: ${concurrencyUtil}%`);
        } else if (concurrencyUtil > 80) {
          healthCheck.score -= 10;
          if (healthCheck.status === 'healthy') healthCheck.status = 'warning';
          healthCheck.warnings.push(`High concurrency: ${concurrencyUtil}%`);
        }
      }
    } catch (error) {
      healthCheck.warnings.push('Could not retrieve system utilization');
      healthCheck.score -= 5;
    }
    
    // Database health
    try {
      const dbHealth = await getDatabaseHealthSummary();
      if (dbHealth.success) {
        healthCheck.database = dbHealth.health;
        
        if (dbHealth.health.status === 'warning') {
          healthCheck.score -= 10;
          if (healthCheck.status === 'healthy') healthCheck.status = 'warning';
          healthCheck.warnings.push('Database performance issues detected');
        } else if (dbHealth.health.status === 'critical') {
          healthCheck.score -= 20;
          healthCheck.status = 'critical';
          healthCheck.warnings.push('Critical database issues detected');
        }
      }
    } catch (error) {
      healthCheck.warnings.push('Could not assess database health');
      healthCheck.score -= 5;
    }
    
    // Heartbeat status
    try {
      const heartbeatStatuses = getAllHeartbeatStatuses();
      const staleHeartbeats = await detectStaleHeartbeats();
      
      healthCheck.components.campaigns = {
        status: staleHeartbeats.length === 0 ? 'healthy' : 'warning',
        activeHeartbeats: heartbeatStatuses.totalActive,
        staleHeartbeats: staleHeartbeats.length
      };
      
      if (staleHeartbeats.length > 0) {
        healthCheck.score -= (staleHeartbeats.length * 5);
        if (healthCheck.status === 'healthy') healthCheck.status = 'warning';
        healthCheck.warnings.push(`${staleHeartbeats.length} campaigns have stale heartbeats`);
      }
    } catch (error) {
      healthCheck.components.campaigns = { 
        status: 'error', 
        error: error.message 
      };
      healthCheck.score -= 5;
    }
    
    // System resources
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    
    healthCheck.components.system = {
      status: memoryUsageMB > 512 ? 'warning' : 'healthy',
      memory: {
        heapUsed: memoryUsageMB,
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024)
      },
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version
    };
    
    if (memoryUsageMB > 512) {
      healthCheck.score -= 5;
      if (healthCheck.status === 'healthy') healthCheck.status = 'warning';
      healthCheck.warnings.push(`High memory usage: ${memoryUsageMB}MB`);
    }
    
    // Generate recommendations
    if (healthCheck.warnings.length > 0) {
      healthCheck.recommendations = [
        ...healthCheck.warnings.map(warning => ({
          type: 'warning',
          message: warning,
          priority: warning.includes('Critical') ? 'high' : 'medium'
        }))
      ];
    }
    
    // Add performance recommendations
    if (healthCheck.performance.utilization) {
      const util = healthCheck.performance.utilization;
      
      if (util.concurrency.percentage > 80) {
        healthCheck.recommendations.push({
          type: 'performance',
          message: 'Consider increasing global concurrency limits or adding more containers',
          priority: 'high'
        });
      }
      
      if (util.callRate.ratePerMinute > 50) {
        healthCheck.recommendations.push({
          type: 'scaling',
          message: 'High call rate detected - monitor for potential scaling needs',
          priority: 'medium'
        });
      }
    }
    
    healthCheck.score = Math.max(0, healthCheck.score);
    
    const statusCode = healthCheck.status === 'critical' ? 503 : 200;
    res.status(statusCode).json(healthCheck);
    
  } catch (error) {
    console.error('❌ Error in comprehensive health check:', error);
    res.status(503).json({
      status: 'critical',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /health/database:
 *   get:
 *     tags: [Health]
 *     summary: Database performance health check
 *     description: Returns database health including performance metrics and optimization status
 *     responses:
 *       200:
 *         description: Database health information
 *       503:
 *         description: Database is unhealthy
 */
router.get('/database', async (req, res) => {
  try {
    const dbHealth = await getDatabaseHealthSummary();
    
    if (!dbHealth.success) {
      return res.status(503).json({
        status: 'critical',
        error: dbHealth.error,
        timestamp: new Date().toISOString()
      });
    }
    
    const statusCode = dbHealth.health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json({
      status: dbHealth.health.status,
      health: dbHealth.health,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /health/database/validate:
 *   get:
 *     tags: [Health]
 *     summary: Comprehensive database validation
 *     description: Runs full database performance validation including index analysis and query optimization
 *     responses:
 *       200:
 *         description: Database validation results
 *       503:
 *         description: Database validation failed
 */
router.get('/database/validate', async (req, res) => {
  try {
    console.log('🔍 Running comprehensive database validation...');
    
    const validation = await validateDatabasePerformance();
    
    if (!validation.success) {
      return res.status(503).json({
        status: 'error',
        error: validation.error,
        timestamp: new Date().toISOString()
      });
    }
    
    const statusCode = validation.data.overall.status === 'healthy' ? 200 : 
                      validation.data.overall.status === 'warning' ? 200 : 503;
    
    res.status(statusCode).json({
      status: validation.data.overall.status,
      validation: validation.data,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in database validation:', error);
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /health/performance:
 *   get:
 *     tags: [Health]
 *     summary: System performance metrics
 *     description: Returns current system performance metrics including utilization and throughput
 *     responses:
 *       200:
 *         description: Performance metrics
 */
router.get('/performance', async (req, res) => {
  try {
    const utilization = await getSystemUtilization();
    
    if (!utilization.success) {
      return res.status(503).json({
        status: 'error',
        error: utilization.error,
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(200).json({
      status: utilization.utilization.systemStatus,
      performance: utilization.utilization,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /health/integration-test:
 *   get:
 *     tags: [Health]
 *     summary: Run integration test suite
 *     description: Executes lightweight integration tests to validate system functionality
 *     parameters:
 *       - in: query
 *         name: suite
 *         schema:
 *           type: string
 *           enum: [basic, full]
 *           default: basic
 *         description: Test suite to run
 *     responses:
 *       200:
 *         description: Integration tests completed
 *       503:
 *         description: Integration tests failed
 */
router.get('/integration-test', async (req, res) => {
  try {
    const suiteType = req.query.suite || 'basic';
    
    console.log(`🧪 Running ${suiteType} integration tests...`);
    
    const testResults = {
      status: 'passed',
      suite: suiteType,
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0
      },
      timestamp: new Date().toISOString()
    };
    
    // Basic connectivity tests
    const basicTests = [
      {
        name: 'Database Connectivity',
        test: async () => {
          await connectToMongo();
          const admin = client.db().admin();
          await admin.ping();
          return true;
        }
      },
      {
        name: 'Container Health',
        test: async () => {
          const health = await getContainerHealth();
          return health.status === 'healthy';
        }
      },
      {
        name: 'Concurrency System',
        test: async () => {
          const stats = await getConcurrencyStats();
          return stats.global && typeof stats.global.active === 'number';
        }
      }
    ];
    
    // Full test suite includes more comprehensive checks
    const fullTests = [
      ...basicTests,
      {
        name: 'Database Performance',
        test: async () => {
          const health = await getDatabaseHealthSummary();
          return health.success && health.health.score > 70;
        }
      },
      {
        name: 'System Utilization',
        test: async () => {
          const util = await getSystemUtilization();
          return util.success && util.utilization.systemStatus !== 'critical';
        }
      },
      {
        name: 'Heartbeat System',
        test: async () => {
          const stale = await detectStaleHeartbeats();
          return stale.length < 10; // Allow up to 10 stale heartbeats
        }
      }
    ];
    
    const testsToRun = suiteType === 'full' ? fullTests : basicTests;
    
    // Execute tests
    for (const testConfig of testsToRun) {
      const testResult = {
        name: testConfig.name,
        passed: false,
        error: null,
        duration: 0
      };
      
      const startTime = Date.now();
      
      try {
        const result = await testConfig.test();
        testResult.passed = result === true;
        testResult.duration = Date.now() - startTime;
        
        if (testResult.passed) {
          testResults.summary.passed++;
        } else {
          testResults.summary.failed++;
          testResults.status = 'failed';
        }
        
      } catch (error) {
        testResult.passed = false;
        testResult.error = error.message;
        testResult.duration = Date.now() - startTime;
        testResults.summary.failed++;
        testResults.status = 'failed';
      }
      
      testResults.tests.push(testResult);
      testResults.summary.total++;
    }
    
    const statusCode = testResults.status === 'passed' ? 200 : 503;
    res.status(statusCode).json(testResults);
    
  } catch (error) {
    console.error('❌ Error running integration tests:', error);
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;