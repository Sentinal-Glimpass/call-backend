/**
 * Active Calls Monitoring Service
 * Provides comprehensive real-time monitoring of active calls and system health
 */

const { connectToMongo, client } = require('../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const { getConcurrencyStats } = require('../apps/helper/activeCalls.js');
const { getAllHeartbeatStatuses, detectStaleHeartbeats } = require('../utils/heartbeatManager.js');
const { getContainerHealth } = require('../utils/containerLifecycle.js');

/**
 * Get comprehensive active calls monitoring dashboard data
 * @param {Object} filters - Optional filters
 * @returns {Promise<Object>} Complete monitoring dashboard data
 */
async function getActiveCallsMonitoring(filters = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    // Get concurrency statistics
    const concurrencyStats = await getConcurrencyStats(filters.clientId);
    
    // Get heartbeat information
    const heartbeatStatuses = getAllHeartbeatStatuses();
    const staleHeartbeats = await detectStaleHeartbeats();
    
    // Get container health
    const containerHealth = await getContainerHealth();
    
    // Build query for active calls
    const query = { status: 'active' };
    if (filters.clientId) {
      query.clientId = new ObjectId(filters.clientId);
    }
    
    // Get active calls with details
    const activeCalls = await activeCallsCollection
      .find(query)
      .sort({ startTime: -1 })
      .limit(filters.includeCalls ? (filters.limit || 100) : 0)
      .toArray();
    
    // Get call distribution by client
    const callsByClient = await activeCallsCollection.aggregate([
      { $match: { status: 'active' } },
      {
        $group: {
          _id: "$clientId",
          activeCount: { $sum: 1 },
          avgDuration: { $avg: { $subtract: [new Date(), "$startTime"] } }
        }
      },
      {
        $lookup: {
          from: "client",
          localField: "_id",
          foreignField: "_id",
          as: "clientInfo"
        }
      },
      {
        $project: {
          clientId: "$_id",
          activeCount: 1,
          avgDurationMinutes: { $round: [{ $divide: ["$avgDuration", 60000] }, 1] },
          clientName: { $arrayElemAt: ["$clientInfo.name", 0] },
          maxConcurrent: { $arrayElemAt: ["$clientInfo.maxConcurrentCalls", 0] }
        }
      }
    ]).toArray();
    
    // Get recent call history (last 24 hours)
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCallsStats = await activeCallsCollection.aggregate([
      { $match: { startTime: { $gte: last24Hours } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          avgDuration: { $avg: "$duration" }
        }
      }
    ]).toArray();
    
    // Calculate system health metrics
    const healthMetrics = calculateHealthMetrics(concurrencyStats, staleHeartbeats.length, containerHealth);
    
    // Format response
    const monitoringData = {
      timestamp: new Date(),
      overview: {
        globalConcurrency: concurrencyStats.global,
        clientConcurrency: concurrencyStats.client || null,
        systemHealth: healthMetrics,
        containerHealth: {
          status: containerHealth.status,
          uptime: containerHealth.uptime,
          memoryUsage: containerHealth.memoryUsage,
          managedCampaigns: containerHealth.managedCampaigns
        }
      },
      activeCalls: {
        total: activeCalls.length,
        byClient: callsByClient,
        calls: filters.includeCalls ? formatCallDetails(activeCalls) : []
      },
      heartbeats: {
        active: heartbeatStatuses.totalActive,
        stale: staleHeartbeats.length,
        staleDetails: staleHeartbeats.map(hb => ({
          campaignId: hb.campaignId,
          campaignName: hb.campaignName,
          staleFor: hb.staleFor,
          containerId: hb.containerId
        }))
      },
      recentActivity: {
        last24Hours: recentCallsStats,
        trends: await calculateCallTrends()
      }
    };
    
    return {
      success: true,
      data: monitoringData
    };
    
  } catch (error) {
    console.error('❌ Error getting active calls monitoring:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get real-time system utilization metrics
 * @returns {Promise<Object>} System utilization data
 */
async function getSystemUtilization() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // Get concurrency stats
    const concurrencyStats = await getConcurrencyStats();
    
    // Get campaign processing load
    const campaignCollection = database.collection("plivoCampaign");
    const runningCampaigns = await campaignCollection.countDocuments({ status: "running" });
    const pausedCampaigns = await campaignCollection.countDocuments({ status: "paused" });
    
    // Get active calls distribution
    const activeCallsCollection = database.collection("activeCalls");
    const callsInLast5Min = await activeCallsCollection.countDocuments({
      startTime: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
    });
    
    // Calculate utilization percentages
    const globalUtilization = concurrencyStats.global.utilization;
    const campaignLoad = runningCampaigns;
    const recentCallRate = callsInLast5Min; // calls in last 5 minutes
    
    // Determine system status
    let systemStatus = 'healthy';
    if (globalUtilization > 90) systemStatus = 'critical';
    else if (globalUtilization > 80) systemStatus = 'high';
    else if (globalUtilization > 60) systemStatus = 'moderate';
    
    return {
      success: true,
      utilization: {
        concurrency: {
          percentage: globalUtilization,
          active: concurrencyStats.global.active,
          available: concurrencyStats.global.available,
          max: concurrencyStats.global.max
        },
        campaigns: {
          running: runningCampaigns,
          paused: pausedCampaigns,
          load: campaignLoad
        },
        callRate: {
          last5Minutes: callsInLast5Min,
          ratePerMinute: Math.round(callsInLast5Min / 5)
        },
        systemStatus: systemStatus
      },
      timestamp: new Date()
    };
    
  } catch (error) {
    console.error('❌ Error getting system utilization:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get detailed call analytics
 * @param {Object} filters - Time range and filtering options
 * @returns {Promise<Object>} Call analytics data
 */
async function getCallAnalytics(filters = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    // Default to last 24 hours if no time range specified
    const timeRange = filters.timeRange || {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date()
    };
    
    const query = {
      startTime: {
        $gte: new Date(timeRange.start),
        $lte: new Date(timeRange.end)
      }
    };
    
    if (filters.clientId) {
      query.clientId = new ObjectId(filters.clientId);
    }
    
    // Get call statistics
    const callStats = await activeCallsCollection.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            status: "$status",
            hour: { $hour: "$startTime" }
          },
          count: { $sum: 1 },
          avgDuration: { $avg: "$duration" },
          totalDuration: { $sum: "$duration" }
        }
      },
      { $sort: { "_id.hour": 1 } }
    ]).toArray();
    
    // Get failure analysis
    const failureAnalysis = await activeCallsCollection.aggregate([
      { 
        $match: { 
          ...query, 
          status: { $in: ['failed', 'timeout'] }
        } 
      },
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
    
    // Get top performing clients
    const topClients = await activeCallsCollection.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$clientId",
          totalCalls: { $sum: 1 },
          successful: { 
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } 
          },
          failed: { 
            $sum: { $cond: [{ $in: ["$status", ["failed", "timeout"]] }, 1, 0] } 
          },
          avgDuration: { $avg: "$duration" }
        }
      },
      {
        $project: {
          clientId: "$_id",
          totalCalls: 1,
          successful: 1,
          failed: 1,
          successRate: { 
            $round: [
              { $multiply: [{ $divide: ["$successful", "$totalCalls"] }, 100] }, 
              1
            ] 
          },
          avgDurationMinutes: { $round: [{ $divide: ["$avgDuration", 60] }, 1] }
        }
      },
      { $sort: { totalCalls: -1 } },
      { $limit: 10 }
    ]).toArray();
    
    return {
      success: true,
      analytics: {
        timeRange: timeRange,
        callDistribution: callStats,
        failureAnalysis: failureAnalysis,
        topClients: topClients,
        summary: calculateAnalyticsSummary(callStats, failureAnalysis)
      }
    };
    
  } catch (error) {
    console.error('❌ Error getting call analytics:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Calculate system health metrics
 * @param {Object} concurrencyStats - Concurrency statistics
 * @param {number} staleHeartbeats - Number of stale heartbeats
 * @param {Object} containerHealth - Container health data
 * @returns {Object} Health metrics
 */
function calculateHealthMetrics(concurrencyStats, staleHeartbeats, containerHealth) {
  const globalUtilization = concurrencyStats.global.utilization;
  
  let healthScore = 100;
  let status = 'healthy';
  const issues = [];
  
  // Check concurrency utilization
  if (globalUtilization > 95) {
    healthScore -= 30;
    status = 'critical';
    issues.push('Critical: System concurrency at maximum capacity');
  } else if (globalUtilization > 85) {
    healthScore -= 15;
    status = 'warning';
    issues.push('Warning: High system concurrency utilization');
  }
  
  // Check stale heartbeats
  if (staleHeartbeats > 0) {
    healthScore -= (staleHeartbeats * 10);
    if (status !== 'critical') status = 'warning';
    issues.push(`Warning: ${staleHeartbeats} campaigns have stale heartbeats`);
  }
  
  // Check container health
  if (containerHealth.status === 'error' || containerHealth.status === 'shutting_down') {
    healthScore -= 25;
    status = 'critical';
    issues.push('Critical: Container health issues detected');
  }
  
  // Check memory usage
  if (containerHealth.memoryUsage && containerHealth.memoryUsage.heapUsed > 500 * 1024 * 1024) { // > 500MB
    healthScore -= 10;
    if (status === 'healthy') status = 'warning';
    issues.push('Warning: High memory usage detected');
  }
  
  healthScore = Math.max(0, healthScore);
  
  return {
    score: healthScore,
    status: status,
    issues: issues,
    lastCheck: new Date()
  };
}

/**
 * Format call details for monitoring display
 * @param {Array} activeCalls - Array of active call records
 * @returns {Array} Formatted call details
 */
function formatCallDetails(activeCalls) {
  return activeCalls.map(call => ({
    callUUID: call.callUUID,
    from: call.from,
    to: call.to,
    startTime: call.startTime,
    duration: Math.round((Date.now() - new Date(call.startTime).getTime()) / 1000),
    clientId: call.clientId,
    campaignId: call.campaignId,
    status: call.status,
    warmupInfo: call.warmupAttempts ? {
      attempts: call.warmupAttempts,
      duration: call.warmupDuration
    } : null
  }));
}

/**
 * Calculate call trends for recent activity
 * @returns {Promise<Object>} Call trend data
 */
async function calculateCallTrends() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Get hourly call trends
    const hourlyTrends = await activeCallsCollection.aggregate([
      { $match: { startTime: { $gte: last24Hours } } },
      {
        $group: {
          _id: { 
            hour: { $hour: "$startTime" },
            status: "$status"
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.hour": 1 } }
    ]).toArray();
    
    return {
      hourlyDistribution: hourlyTrends,
      trend: 'stable' // Could be calculated based on patterns
    };
    
  } catch (error) {
    console.error('❌ Error calculating call trends:', error);
    return { hourlyDistribution: [], trend: 'unknown' };
  }
}

/**
 * Calculate analytics summary
 * @param {Array} callStats - Call statistics
 * @param {Array} failureAnalysis - Failure analysis data
 * @returns {Object} Analytics summary
 */
function calculateAnalyticsSummary(callStats, failureAnalysis) {
  let totalCalls = 0;
  let completedCalls = 0;
  let failedCalls = 0;
  let totalDuration = 0;
  
  callStats.forEach(stat => {
    totalCalls += stat.count;
    if (stat._id.status === 'completed') {
      completedCalls += stat.count;
      totalDuration += stat.totalDuration || 0;
    } else if (['failed', 'timeout'].includes(stat._id.status)) {
      failedCalls += stat.count;
    }
  });
  
  const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;
  const failureRate = totalCalls > 0 ? Math.round((failedCalls / totalCalls) * 100) : 0;
  const avgDuration = completedCalls > 0 ? Math.round(totalDuration / completedCalls) : 0;
  
  return {
    totalCalls: totalCalls,
    completedCalls: completedCalls,
    failedCalls: failedCalls,
    successRate: successRate,
    failureRate: failureRate,
    avgCallDuration: avgDuration,
    topFailureReason: failureAnalysis.length > 0 ? failureAnalysis[0]._id : null
  };
}

module.exports = {
  getActiveCallsMonitoring,
  getSystemUtilization,
  getCallAnalytics
};