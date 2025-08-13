/**
 * Campaign Management Dashboard Service
 * Provides comprehensive campaign monitoring and management capabilities
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const { getConcurrencyStats } = require('../apps/helper/activeCalls.js');
const { getAllHeartbeatStatuses, detectStaleHeartbeats } = require('../utils/heartbeatManager.js');

/**
 * Get comprehensive campaign list for a client
 * @param {string} clientId - Client ObjectId
 * @param {Object} filters - Optional filters (status, dateRange)
 * @returns {Promise<Object>} Campaign list with statistics
 */
async function getCampaignList(clientId, filters = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const campaignCollection = database.collection("plivoCampaign");
    
    // Build query
    const query = { clientId: new ObjectId(clientId) };
    
    if (filters.status && Array.isArray(filters.status)) {
      query.status = { $in: filters.status };
    }
    
    if (filters.dateRange) {
      const { startDate, endDate } = filters.dateRange;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
    }
    
    // Get campaigns with pagination
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100); // Max 100 campaigns per page
    const skip = (page - 1) * limit;
    
    const campaigns = await campaignCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
      
    const totalCount = await campaignCollection.countDocuments(query);
    
    // Enhance each campaign with progress and health data
    const enhancedCampaigns = campaigns.map(campaign => {
      const progressPercentage = campaign.totalContacts > 0 
        ? Math.round((campaign.processedContacts / campaign.totalContacts) * 100)
        : 0;
        
      const heartbeatStatus = getHeartbeatStatus(campaign.heartbeat);
      
      return {
        _id: campaign._id,
        campaignName: campaign.campaignName,
        status: campaign.status,
        createdAt: campaign.createdAt,
        progress: {
          currentIndex: campaign.currentIndex || 0,
          totalContacts: campaign.totalContacts || 0,
          processedContacts: campaign.processedContacts || 0,
          progressPercentage: progressPercentage
        },
        statistics: {
          connectedCalls: campaign.connectedCall || 0,
          failedCalls: campaign.failedCall || 0
        },
        health: {
          heartbeat: campaign.heartbeat,
          heartbeatStatus: heartbeatStatus,
          containerId: campaign.containerId,
          lastActivity: campaign.lastActivity
        },
        timing: {
          pausedAt: campaign.pausedAt,
          resumedAt: campaign.resumedAt,
          lastActivity: campaign.lastActivity
        }
      };
    });
    
    return {
      success: true,
      campaigns: enhancedCampaigns,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount: totalCount,
        hasNext: page * limit < totalCount,
        hasPrevious: page > 1
      }
    };
    
  } catch (error) {
    console.error('❌ Error getting campaign list:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get system-wide campaign statistics
 * @param {string} clientId - Optional client filter
 * @returns {Promise<Object>} System statistics
 */
async function getSystemStats(clientId = null) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const campaignCollection = database.collection("plivoCampaign");
    
    const baseQuery = clientId ? { clientId: new ObjectId(clientId) } : {};
    
    // Get campaign statistics
    const campaignStats = await campaignCollection.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalContacts: { $sum: "$totalContacts" },
          processedContacts: { $sum: "$processedContacts" },
          connectedCalls: { $sum: "$connectedCall" },
          failedCalls: { $sum: "$failedCall" }
        }
      }
    ]).toArray();
    
    // Get concurrency statistics
    const concurrencyStats = await getConcurrencyStats(clientId);
    
    // Get heartbeat health information
    const heartbeatStatuses = getAllHeartbeatStatuses();
    
    // Get stale heartbeats
    const staleHeartbeats = await detectStaleHeartbeats();
    
    // Process campaign statistics
    const processedStats = {
      running: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
      failed: 0
    };
    
    let totalContactsAcrossAll = 0;
    let totalProcessedAcrossAll = 0;
    let totalConnectedCalls = 0;
    let totalFailedCalls = 0;
    
    campaignStats.forEach(stat => {
      processedStats[stat._id] = stat.count;
      totalContactsAcrossAll += stat.totalContacts || 0;
      totalProcessedAcrossAll += stat.processedContacts || 0;
      totalConnectedCalls += stat.connectedCalls || 0;
      totalFailedCalls += stat.failedCalls || 0;
    });
    
    const overallProgressPercentage = totalContactsAcrossAll > 0 
      ? Math.round((totalProcessedAcrossAll / totalContactsAcrossAll) * 100)
      : 0;
      
    const failedCallRate = totalProcessedAcrossAll > 0
      ? Math.round((totalFailedCalls / totalProcessedAcrossAll) * 100)
      : 0;
    
    return {
      success: true,
      statistics: {
        campaigns: processedStats,
        totalCampaigns: Object.values(processedStats).reduce((a, b) => a + b, 0),
        progress: {
          totalContacts: totalContactsAcrossAll,
          processedContacts: totalProcessedAcrossAll,
          overallProgress: overallProgressPercentage
        },
        calls: {
          connected: totalConnectedCalls,
          failed: totalFailedCalls,
          failureRate: failedCallRate,
          successRate: Math.max(0, 100 - failedCallRate)
        }
      },
      concurrency: concurrencyStats,
      health: {
        activeHeartbeats: heartbeatStatuses.totalActive,
        staleHeartbeats: staleHeartbeats.length,
        containerHealth: heartbeatStatuses.containerId
      },
      timestamp: new Date()
    };
    
  } catch (error) {
    console.error('❌ Error getting system stats:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get failed call analysis for campaigns
 * @param {string} clientId - Client ObjectId
 * @param {Object} filters - Optional filters
 * @returns {Promise<Object>} Failed call analysis
 */
async function getFailedCallAnalysis(clientId, filters = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const query = {
      clientId: new ObjectId(clientId),
      status: { $in: ['failed', 'timeout'] }
    };
    
    if (filters.campaignId) {
      query.campaignId = new ObjectId(filters.campaignId);
    }
    
    if (filters.dateRange) {
      const { startDate, endDate } = filters.dateRange;
      if (startDate || endDate) {
        query.startTime = {};
        if (startDate) query.startTime.$gte = new Date(startDate);
        if (endDate) query.startTime.$lte = new Date(endDate);
      }
    }
    
    // Get failure statistics by reason
    const failuresByReason = await activeCallsCollection.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$failureReason",
          count: { $sum: 1 },
          avgWarmupAttempts: { $avg: "$warmupAttempts" },
          avgWarmupDuration: { $avg: "$warmupDuration" }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();
    
    // Get recent failed calls for detailed analysis
    const recentFailures = await activeCallsCollection
      .find(query)
      .sort({ startTime: -1 })
      .limit(50)
      .toArray();
    
    // Calculate retry recommendations
    const retryRecommendations = [];
    
    failuresByReason.forEach(failure => {
      if (failure._id === 'bot_not_ready' && failure.avgWarmupAttempts < 3) {
        retryRecommendations.push({
          reason: failure._id,
          recommendation: 'Increase bot warmup retry attempts',
          affectedCalls: failure.count,
          priority: 'high'
        });
      }
      
      if (failure._id === 'timeout' && failure.count > 10) {
        retryRecommendations.push({
          reason: failure._id,
          recommendation: 'Review call timeout settings or network connectivity',
          affectedCalls: failure.count,
          priority: 'medium'
        });
      }
    });
    
    return {
      success: true,
      analysis: {
        totalFailures: recentFailures.length,
        failuresByReason: failuresByReason,
        retryRecommendations: retryRecommendations,
        recentFailures: recentFailures.slice(0, 10) // Latest 10 for UI display
      }
    };
    
  } catch (error) {
    console.error('❌ Error getting failed call analysis:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Perform bulk campaign operations
 * @param {string} clientId - Client ObjectId
 * @param {Array} campaignIds - Array of campaign IDs
 * @param {string} operation - Operation to perform (pause, resume, cancel)
 * @param {string} operatorId - ID of user performing operation
 * @returns {Promise<Object>} Bulk operation results
 */
async function bulkCampaignOperation(clientId, campaignIds, operation, operatorId = null) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("plivoCampaign");
    
    const results = {
      successful: [],
      failed: [],
      total: campaignIds.length
    };
    
    for (const campaignId of campaignIds) {
      try {
        let updateResult;
        
        switch (operation) {
          case 'pause':
            updateResult = await collection.updateOne(
              { 
                _id: new ObjectId(campaignId),
                clientId: new ObjectId(clientId),
                status: "running"
              },
              {
                $set: {
                  status: "paused",
                  pausedAt: new Date(),
                  pausedBy: operatorId,
                  lastActivity: new Date(),
                  heartbeat: null
                }
              }
            );
            break;
            
          case 'resume':
            const campaign = await collection.findOne({
              _id: new ObjectId(campaignId),
              clientId: new ObjectId(clientId),
              status: "paused"
            });
            
            if (campaign) {
              updateResult = await collection.updateOne(
                { _id: new ObjectId(campaignId) },
                {
                  $set: {
                    status: "running",
                    resumedAt: new Date(),
                    lastActivity: new Date(),
                    heartbeat: new Date()
                  }
                }
              );
              
              // Start processing (would need campaign processing logic here)
            }
            break;
            
          case 'cancel':
            updateResult = await collection.updateOne(
              { 
                _id: new ObjectId(campaignId),
                clientId: new ObjectId(clientId),
                status: { $in: ["running", "paused"] }
              },
              {
                $set: {
                  status: "cancelled",
                  cancelledAt: new Date(),
                  cancelledBy: operatorId,
                  lastActivity: new Date(),
                  heartbeat: null
                }
              }
            );
            break;
            
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        
        if (updateResult && updateResult.modifiedCount > 0) {
          results.successful.push(campaignId);
        } else {
          results.failed.push({
            campaignId,
            error: `No matching campaign found or invalid state for ${operation}`
          });
        }
        
      } catch (error) {
        results.failed.push({
          campaignId,
          error: error.message
        });
      }
    }
    
    console.log(`📊 Bulk ${operation} operation completed: ${results.successful.length} successful, ${results.failed.length} failed`);
    
    return {
      success: true,
      results: results
    };
    
  } catch (error) {
    console.error('❌ Error in bulk campaign operation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Helper function to determine heartbeat status
 * @param {Date} heartbeat - Heartbeat timestamp
 * @returns {string} Status: healthy, stale, inactive
 */
function getHeartbeatStatus(heartbeat) {
  if (!heartbeat) return 'inactive';
  
  const threshold = parseInt(process.env.ORPHAN_DETECTION_THRESHOLD) || 120000;
  const timeSince = Date.now() - new Date(heartbeat).getTime();
  
  if (timeSince < 60000) return 'healthy'; // Less than 1 minute
  if (timeSince < threshold) return 'stale'; // Less than 2 minutes
  return 'inactive'; // More than 2 minutes
}

module.exports = {
  getCampaignList,
  getSystemStats,
  getFailedCallAnalysis,
  bulkCampaignOperation
};