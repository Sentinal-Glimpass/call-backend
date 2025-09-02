/**
 * Container Lifecycle Management for Cloud Run
 * Handles startup recovery, graceful shutdown, and container coordination
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');

// Generate unique container ID for this instance
const CONTAINER_ID = `container_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const ORPHAN_DETECTION_THRESHOLD = parseInt(process.env.ORPHAN_DETECTION_THRESHOLD) || 120000;
const CONTAINER_SHUTDOWN_GRACE = parseInt(process.env.CONTAINER_SHUTDOWN_GRACE) || 10000;

let shutdownInProgress = false;
let activeShutdownPromises = [];

/**
 * Initialize container lifecycle management
 * Should be called on server startup
 */
async function initializeContainer() {
  try {
    console.log(`🚀 Initializing Cloud Run container: ${CONTAINER_ID}`);
    
    // Register signal handlers for graceful shutdown
    registerShutdownHandlers();
    
    // Scan for and recover orphaned campaigns immediately
    await scanAndRecoverOrphanedCampaigns();
    
    console.log(`✅ Container initialization complete: ${CONTAINER_ID}`);
    
  } catch (error) {
    console.error('❌ Error initializing container:', error);
    // Don't throw - allow server to continue starting
  }
}

/**
 * Scan database for orphaned campaigns and recover them
 * Called on container startup
 */
async function scanAndRecoverOrphanedCampaigns() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    const staleThreshold = new Date(Date.now() - ORPHAN_DETECTION_THRESHOLD);
    
    // Find campaigns that are "running" but have stale heartbeats
    const orphanedCampaigns = await collection.find({
      status: "running",
      $or: [
        { heartbeat: { $lt: staleThreshold } },
        { heartbeat: { $exists: false } },
        { heartbeat: null }
      ]
    }).toArray();
    
    console.log(`🔍 Found ${orphanedCampaigns.length} potentially orphaned campaigns`);
    
    if (orphanedCampaigns.length === 0) {
      return { recovered: 0, failed: 0 };
    }
    
    let recovered = 0;
    let failed = 0;
    
    // Process each orphaned campaign
    for (const campaign of orphanedCampaigns) {
      try {
        console.log(`🔄 Attempting to recover campaign: ${campaign.campaignName} (${campaign._id})`);
        
        // Update campaign with new container ID and reset heartbeat
        const updateResult = await collection.updateOne(
          { 
            _id: campaign._id,
            status: "running" // Double-check it's still running
          },
          {
            $set: {
              heartbeat: new Date(),
              lastActivity: new Date(),
              containerId: CONTAINER_ID,
              recoveredAt: new Date(),
              recoveredBy: CONTAINER_ID
            }
          }
        );
        
        if (updateResult.matchedCount === 0) {
          console.log(`⚠️  Campaign status changed during recovery: ${campaign._id}`);
          continue;
        }
        
        // Resume campaign processing from saved position
        const { processEnhancedCampaign, getlistDataById } = require('../apps/plivo/plivo.js');
        
        // Get campaign contact list
        const listData = await getlistDataById(campaign.listId);
        
        if (!listData || listData.length === 0) {
          console.error(`❌ No contact list found for campaign: ${campaign._id}`);
          failed++;
          continue;
        }
        
        console.log(`▶️  Resuming campaign from index ${campaign.currentIndex || 0}: ${campaign.campaignName}`);
        
        // Start enhanced campaign processing in background
        process.nextTick(() => {
          processEnhancedCampaign(
            campaign._id.toString(),
            listData,
            campaign.fromNumber,
            campaign.wssUrl,
            campaign.clientId,
            campaign.listId
          ).catch(error => {
            console.error(`❌ Error in recovered campaign processing: ${campaign._id}`, error);
          });
        });
        
        recovered++;
        console.log(`✅ Campaign recovery initiated: ${campaign.campaignName}`);
        
      } catch (error) {
        console.error(`❌ Error recovering campaign ${campaign._id}:`, error);
        failed++;
      }
    }
    
    console.log(`🏁 Orphaned campaign recovery complete: ${recovered} recovered, ${failed} failed`);
    
    return { recovered, failed, total: orphanedCampaigns.length };
    
  } catch (error) {
    console.error('❌ Error in orphaned campaign scanner:', error);
    return { recovered: 0, failed: 0, error: error.message };
  }
}

/**
 * Register signal handlers for graceful shutdown
 */
function registerShutdownHandlers() {
  // Handle SIGTERM (Cloud Run shutdown signal)
  process.on('SIGTERM', () => {
    console.log('📡 SIGTERM received - initiating graceful shutdown...');
    handleGracefulShutdown('SIGTERM');
  });
  
  // Handle SIGINT (Ctrl+C during development)
  process.on('SIGINT', () => {
    console.log('📡 SIGINT received - initiating graceful shutdown...');
    handleGracefulShutdown('SIGINT');
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught exception:', error);
    handleGracefulShutdown('UNCAUGHT_EXCEPTION');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
    handleGracefulShutdown('UNHANDLED_REJECTION');
  });
}

/**
 * Handle graceful shutdown process
 * @param {string} signal - The signal that triggered shutdown
 */
async function handleGracefulShutdown(signal) {
  if (shutdownInProgress) {
    console.log('⚠️  Shutdown already in progress, ignoring duplicate signal');
    return;
  }
  
  shutdownInProgress = true;
  console.log(`🛑 Starting graceful shutdown process (signal: ${signal})`);
  
  const shutdownTimeout = setTimeout(() => {
    console.error('⏰ Graceful shutdown timeout exceeded - forcing exit');
    process.exit(1);
  }, CONTAINER_SHUTDOWN_GRACE);
  
  try {
    // Prepare all running campaigns for auto-recovery (keep running, clear heartbeat)
    const prepareResult = await pauseContainerCampaigns();
    console.log(`🔄 Prepared ${prepareResult.prepared} campaigns for auto-recovery during shutdown`);
    
    // Wait for active shutdown promises to complete
    if (activeShutdownPromises.length > 0) {
      console.log(`⏳ Waiting for ${activeShutdownPromises.length} cleanup operations...`);
      await Promise.allSettled(activeShutdownPromises);
    }
    
    console.log('✅ Graceful shutdown complete');
    clearTimeout(shutdownTimeout);
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

/**
 * Prepare campaigns for auto-recovery by clearing heartbeat (keeps them running for orphan detection)
 * @returns {Promise<{prepared: number, errors: number}>}
 */
async function pauseContainerCampaigns() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    // Find all running campaigns managed by this container
    const containerCampaigns = await collection.find({
      status: "running",
      containerId: CONTAINER_ID
    }).toArray();
    
    console.log(`🔍 Found ${containerCampaigns.length} campaigns to prepare for auto-recovery during shutdown`);
    
    if (containerCampaigns.length === 0) {
      return { prepared: 0, errors: 0 };
    }
    
    // Keep campaigns RUNNING but clear heartbeat so they become orphaned and auto-recover
    const result = await collection.updateMany(
      {
        status: "running",
        containerId: CONTAINER_ID
      },
      {
        $set: {
          // Keep status as "running" for auto-recovery
          lastActivity: new Date(),
          shutdownAt: new Date(),
          shutdownBy: `container_shutdown_${CONTAINER_ID}`,
          heartbeat: null // Clear heartbeat to trigger orphan detection
        }
      }
    );
    
    console.log(`🔄 Prepared ${result.modifiedCount} campaigns for auto-recovery (kept running, cleared heartbeat)`);
    
    return { prepared: result.modifiedCount, errors: 0 };
    
  } catch (error) {
    console.error('❌ Error preparing container campaigns for auto-recovery:', error);
    return { prepared: 0, errors: 1, error: error.message };
  }
}

/**
 * Get current container information
 * @returns {Object} Container details
 */
function getContainerInfo() {
  return {
    containerId: CONTAINER_ID,
    startTime: process.uptime() * 1000, // Convert seconds to milliseconds
    shutdownInProgress: shutdownInProgress,
    environment: {
      nodeEnv: process.env.NODE_ENV,
      port: process.env.PORT,
      heartbeatInterval: process.env.HEARTBEAT_INTERVAL,
      orphanDetectionThreshold: ORPHAN_DETECTION_THRESHOLD,
      shutdownGrace: CONTAINER_SHUTDOWN_GRACE
    }
  };
}

/**
 * Health check for container status
 * @returns {Promise<Object>} Health status
 */
async function getContainerHealth() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    // Count campaigns managed by this container
    const managedCampaigns = await collection.countDocuments({
      containerId: CONTAINER_ID,
      status: { $in: ["running", "paused"] }
    });
    
    return {
      status: shutdownInProgress ? 'shutting_down' : 'healthy',
      containerId: CONTAINER_ID,
      uptime: Math.round(process.uptime() * 1000), // milliseconds
      managedCampaigns: managedCampaigns,
      memoryUsage: process.memoryUsage(),
      timestamp: new Date()
    };
    
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      containerId: CONTAINER_ID,
      timestamp: new Date()
    };
  }
}

/**
 * Add a promise to be tracked during shutdown
 * @param {Promise} promise - Promise to track
 */
function trackShutdownPromise(promise) {
  activeShutdownPromises.push(promise);
  
  // Remove from tracking when complete
  promise.finally(() => {
    const index = activeShutdownPromises.indexOf(promise);
    if (index > -1) {
      activeShutdownPromises.splice(index, 1);
    }
  });
}

module.exports = {
  // Container lifecycle
  initializeContainer,
  getContainerInfo,
  getContainerHealth,
  
  // Orphaned campaign recovery
  scanAndRecoverOrphanedCampaigns,
  
  // Graceful shutdown
  handleGracefulShutdown,
  pauseContainerCampaigns,
  trackShutdownPromise,
  
  // Container identification
  CONTAINER_ID
};