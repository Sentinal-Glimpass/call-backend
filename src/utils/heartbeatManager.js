/**
 * Heartbeat Manager for Campaign Health Monitoring
 * Manages campaign heartbeats for Cloud Run container coordination
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const { CONTAINER_ID } = require('./containerLifecycle.js');

// Global heartbeat timer registry
const activeHeartbeats = new Map();
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL) || 30000; // 30 seconds

/**
 * Start heartbeat for a campaign
 * @param {string} campaignId - Campaign ObjectId string
 * @returns {Promise<{success: boolean, timerId?: number, error?: string}>}
 */
async function startCampaignHeartbeat(campaignId) {
  try {
    // Stop existing heartbeat if already running
    if (activeHeartbeats.has(campaignId)) {
      await stopCampaignHeartbeat(campaignId);
    }
    
    // Create heartbeat update function
    const updateHeartbeat = async () => {
      try {
        await connectToMongo();
        const database = client.db("talkGlimpass");
        const collection = database.collection("plivoCampaign");
        
        const result = await collection.updateOne(
          { _id: new ObjectId(campaignId) },
          { 
            $set: { 
              heartbeat: new Date(),
              containerId: CONTAINER_ID
            } 
          }
        );
        
        if (result.matchedCount === 0) {
          console.warn(`⚠️  Campaign not found for heartbeat update: ${campaignId}`);
          // Stop heartbeat if campaign doesn't exist
          await stopCampaignHeartbeat(campaignId);
        }
        
      } catch (error) {
        console.error(`❌ Error updating heartbeat: ${campaignId}`, error);
        // Don't stop heartbeat on transient errors - allow retry
      }
    };
    
    // Initial heartbeat update
    await updateHeartbeat();
    
    // Set up periodic heartbeat updates
    const timerId = setInterval(updateHeartbeat, HEARTBEAT_INTERVAL);
    
    // Store heartbeat info
    activeHeartbeats.set(campaignId, {
      timerId: timerId,
      startTime: new Date(),
      interval: HEARTBEAT_INTERVAL,
      containerId: CONTAINER_ID
    });
    
    console.log(`📜 Heartbeat started for campaign: ${campaignId} (${HEARTBEAT_INTERVAL}ms interval)`);
    
    return {
      success: true,
      timerId: timerId,
      interval: HEARTBEAT_INTERVAL
    };
    
  } catch (error) {
    console.error(`❌ Error starting heartbeat: ${campaignId}`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Stop heartbeat for a campaign
 * @param {string} campaignId - Campaign ObjectId string
 * @returns {Promise<{success: boolean, stopped: boolean}>}
 */
async function stopCampaignHeartbeat(campaignId) {
  try {
    const heartbeatInfo = activeHeartbeats.get(campaignId);
    
    if (!heartbeatInfo) {
      return { success: true, stopped: false, reason: 'not_running' };
    }
    
    // Clear the interval timer
    clearInterval(heartbeatInfo.timerId);
    
    // Remove from active heartbeats
    activeHeartbeats.delete(campaignId);
    
    // Update database to clear heartbeat
    try {
      await connectToMongo();
      const database = client.db("talkGlimpass");
      const collection = database.collection("plivoCampaign");
      
      await collection.updateOne(
        { _id: new ObjectId(campaignId) },
        { $set: { heartbeat: null } }
      );
    } catch (dbError) {
      console.warn(`⚠️  Could not clear heartbeat in database: ${campaignId}`, dbError.message);
      // Continue anyway - timer is stopped
    }
    
    console.log(`📜 Heartbeat stopped for campaign: ${campaignId}`);
    
    return {
      success: true,
      stopped: true,
      duration: Date.now() - heartbeatInfo.startTime.getTime()
    };
    
  } catch (error) {
    console.error(`❌ Error stopping heartbeat: ${campaignId}`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Stop all active heartbeats (used during shutdown)
 * @returns {Promise<{stopped: number, errors: number}>}
 */
async function stopAllHeartbeats() {
  const campaignIds = Array.from(activeHeartbeats.keys());
  
  if (campaignIds.length === 0) {
    return { stopped: 0, errors: 0 };
  }
  
  console.log(`🛑 Stopping ${campaignIds.length} active heartbeats...`);
  
  let stopped = 0;
  let errors = 0;
  
  // Stop all heartbeats concurrently
  const stopPromises = campaignIds.map(async (campaignId) => {
    try {
      const result = await stopCampaignHeartbeat(campaignId);
      if (result.success && result.stopped) {
        stopped++;
      }
    } catch (error) {
      console.error(`❌ Error stopping heartbeat during shutdown: ${campaignId}`, error);
      errors++;
    }
  });
  
  await Promise.allSettled(stopPromises);
  
  console.log(`📜 Heartbeat shutdown complete: ${stopped} stopped, ${errors} errors`);
  
  return { stopped, errors };
}

/**
 * Get heartbeat status for a campaign
 * @param {string} campaignId - Campaign ObjectId string
 * @returns {Object} Heartbeat status information
 */
function getHeartbeatStatus(campaignId) {
  const heartbeatInfo = activeHeartbeats.get(campaignId);
  
  if (!heartbeatInfo) {
    return {
      active: false,
      reason: 'not_running'
    };
  }
  
  return {
    active: true,
    startTime: heartbeatInfo.startTime,
    interval: heartbeatInfo.interval,
    containerId: heartbeatInfo.containerId,
    runTime: Date.now() - heartbeatInfo.startTime.getTime()
  };
}

/**
 * Get all active heartbeat statuses
 * @returns {Object} All heartbeat statuses indexed by campaign ID
 */
function getAllHeartbeatStatuses() {
  const statuses = {};
  
  for (const [campaignId, heartbeatInfo] of activeHeartbeats.entries()) {
    statuses[campaignId] = {
      active: true,
      startTime: heartbeatInfo.startTime,
      interval: heartbeatInfo.interval,
      containerId: heartbeatInfo.containerId,
      runTime: Date.now() - heartbeatInfo.startTime.getTime()
    };
  }
  
  return {
    totalActive: activeHeartbeats.size,
    containerId: CONTAINER_ID,
    heartbeats: statuses
  };
}

/**
 * Detect campaigns with stale heartbeats
 * @param {number} staleThresholdMs - Milliseconds after which heartbeat is considered stale
 * @returns {Promise<Array>} List of campaigns with stale heartbeats
 */
async function detectStaleHeartbeats(staleThresholdMs = null) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    const threshold = staleThresholdMs || parseInt(process.env.ORPHAN_DETECTION_THRESHOLD) || 120000;
    const staleTime = new Date(Date.now() - threshold);
    
    const staleCampaigns = await collection.find({
      status: "running",
      $or: [
        { heartbeat: { $lt: staleTime } },
        { heartbeat: { $exists: false } },
        { heartbeat: null }
      ]
    }).toArray();
    
    return staleCampaigns.map(campaign => ({
      campaignId: campaign._id.toString(),
      campaignName: campaign.campaignName,
      lastHeartbeat: campaign.heartbeat,
      containerId: campaign.containerId,
      staleFor: campaign.heartbeat ? Date.now() - new Date(campaign.heartbeat).getTime() : null
    }));
    
  } catch (error) {
    console.error('❌ Error detecting stale heartbeats:', error);
    return [];
  }
}

/**
 * Update campaign heartbeat manually (one-time update)
 * @param {string} campaignId - Campaign ObjectId string
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateCampaignHeartbeat(campaignId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    const result = await collection.updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          heartbeat: new Date(),
          containerId: CONTAINER_ID
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      return {
        success: false,
        error: 'Campaign not found'
      };
    }
    
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Error updating campaign heartbeat: ${campaignId}`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Register cleanup on process exit
process.on('exit', () => {
  // Clear all intervals synchronously
  for (const [campaignId, heartbeatInfo] of activeHeartbeats.entries()) {
    clearInterval(heartbeatInfo.timerId);
  }
  activeHeartbeats.clear();
});

module.exports = {
  // Heartbeat management
  startCampaignHeartbeat,
  stopCampaignHeartbeat,
  stopAllHeartbeats,
  
  // Heartbeat monitoring
  getHeartbeatStatus,
  getAllHeartbeatStatuses,
  detectStaleHeartbeats,
  updateCampaignHeartbeat,
  
  // Configuration
  HEARTBEAT_INTERVAL
};