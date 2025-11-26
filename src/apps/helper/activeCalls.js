/**
 * Database-driven Concurrency Management System
 * Replaces in-memory tracking with MongoDB-based active call management
 */

const { connectToMongo, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');
const { warmupBotWithRetry } = require('../../utils/botWarmup.js');
const CallProviderService = require('../../services/callProviderService');

/**
 * Check client-specific concurrency limits
 * @param {string} clientId - Client ObjectId
 * @returns {Promise<{allowed: boolean, currentCount: number, maxAllowed: number}>}
 */
async function checkClientConcurrency(clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    
    // Get client's max concurrent calls limit
    const clientCollection = database.collection("client");
    const clientData = await clientCollection.findOne(
      { _id: new ObjectId(clientId) },
      { projection: { maxConcurrentCalls: 1 } }
    );
    
    const maxAllowed = clientData?.maxConcurrentCalls || parseInt(process.env.DEFAULT_CLIENT_MAX_CONCURRENT_CALLS) || 10;
    
    // Count current active calls for this client (processed + ringing + ongoing)
    const activeCallsCollection = database.collection("activeCalls");
    const currentCount = await activeCallsCollection.countDocuments({
      clientId: new ObjectId(clientId),
      status: { $in: ['processed', 'ringing', 'ongoing'] }
    });
    
    return {
      allowed: currentCount < maxAllowed,
      currentCount,
      maxAllowed
    };
    
  } catch (error) {
    console.error('❌ Error checking client concurrency:', error);
    // Return conservative result on error
    return {
      allowed: false,
      currentCount: -1,
      maxAllowed: 0,
      error: error.message
    };
  }
}

/**
 * Check global system concurrency limits
 * @returns {Promise<{allowed: boolean, currentCount: number, maxAllowed: number}>}
 */
async function checkGlobalConcurrency() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const maxAllowed = parseInt(process.env.GLOBAL_MAX_CALLS) || parseInt(process.env.GLOBAL_MAX_CONCURRENT_CALLS) || 50;
    
    // Count all active calls across the system (processed + ringing + ongoing)
    const currentCount = await activeCallsCollection.countDocuments({
      status: { $in: ['processed', 'ringing', 'ongoing'] }
    });
    
    return {
      allowed: currentCount < maxAllowed,
      currentCount,
      maxAllowed
    };
    
  } catch (error) {
    console.error('❌ Error checking global concurrency:', error);
    // Return conservative result on error
    return {
      allowed: false,
      currentCount: -1,
      maxAllowed: 0,
      error: error.message
    };
  }
}

/**
 * Wait for available concurrency slot (legacy - short timeout)
 * @param {string} clientId - Client ObjectId
 * @returns {Promise<{success: boolean, waitTime: number, error?: string}>}
 */
async function waitForAvailableSlot(clientId) {
  const startTime = Date.now();
  const maxWaitTime = parseInt(process.env.MAX_CONCURRENT_CALL_WAIT) || 5000;
  const checkInterval = 1000; // Check every second
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Check both client and global limits
      const [clientCheck, globalCheck] = await Promise.all([
        checkClientConcurrency(clientId),
        checkGlobalConcurrency()
      ]);
      
      if (clientCheck.allowed && globalCheck.allowed) {
        return {
          success: true,
          waitTime: Date.now() - startTime,
          clientCount: clientCheck.currentCount,
          globalCount: globalCheck.currentCount
        };
      }
      
      // Log current status
      const reason = !clientCheck.allowed ? 
        `client limit (${clientCheck.currentCount}/${clientCheck.maxAllowed})` :
        `global limit (${globalCheck.currentCount}/${globalCheck.maxAllowed})`;
        
      console.log(`⏳ Waiting for slot - ${reason}`);
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
    } catch (error) {
      console.error('❌ Error while waiting for slot:', error);
      return {
        success: false,
        waitTime: Date.now() - startTime,
        error: error.message
      };
    }
  }
  
  // Timeout reached
  return {
    success: false,
    waitTime: maxWaitTime,
    error: 'Timeout waiting for available slot'
  };
}

/**
 * Wait for concurrency slot - try 1000 times then give up
 */
async function waitForSlot(clientId) {
  const startTime = Date.now();
  
  for (let i = 0; i < 1000; i++) {
    const [clientCheck, globalCheck] = await Promise.all([
      checkClientConcurrency(clientId),
      checkGlobalConcurrency()
    ]);
    
    if (clientCheck.allowed && globalCheck.allowed) {
      return {
        success: true,
        waitTime: Date.now() - startTime
      };
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return {
    success: false,
    waitTime: Date.now() - startTime
  }; // Failed after 1000 attempts
}

/**
 * Track call start in database
 * @param {Object} callData - Call information
 * @returns {Promise<{success: boolean, callId?: string, error?: string}>}
 */
async function trackCallStart(callData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    // Helper function to safely convert to ObjectId
    const toObjectIdSafe = (value) => {
      if (!value) return null;
      try {
        // Check if it's already an ObjectId
        if (value instanceof ObjectId) return value;
        // Check if it's a valid 24-character hex string
        if (typeof value === 'string' && value.match(/^[0-9a-fA-F]{24}$/)) {
          return new ObjectId(value);
        }
        // For non-ObjectId strings like 'testcall', 'incoming', return as string
        return value;
      } catch (error) {
        // If conversion fails, return the original value
        return value;
      }
    };

    const callRecord = {
      callUUID: callData.callUUID || `FAILED_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Unique ID for failed calls
      clientId: new ObjectId(callData.clientId),
      campaignId: toObjectIdSafe(callData.campaignId),
      from: callData.from,
      to: callData.to,
      status: callData.failureReason ? 'failed' : 'processed',  // Set 'failed' for API failures, 'processed' for successful calls
      statusTimestamp: new Date(), // Track when status was set for lazy cleanup
      startTime: new Date(),
      endTime: null,
      duration: null,
      endReason: null,
      failureReason: callData.failureReason || null,
      warmupAttempts: callData.warmupAttempts || null,
      warmupDuration: callData.warmupDuration || null,
      provider: callData.provider || 'plivo', // NEW: Track provider used
      // Enhanced tracking for pause/resume
      contactIndex: callData.contactIndex || null,        // Position in campaign list
      sequenceNumber: callData.sequenceNumber || null,    // Unique sequence in campaign
      // Store FULL contact data including all custom fields
      contactData: callData.contactData || {
        first_name: callData.firstName || '',
        number: callData.to,
        listId: callData.listId
      },
      // NEW: Context flags for memory system
      contextFlags: callData.contextFlags || {
        includeGlobalContext: false,
        includeAgentContext: false
      },
      createdAt: new Date()
    };
    
    try {
      const result = await activeCallsCollection.insertOne(callRecord);
      
      console.log(`📞 Call tracked: ${callData.to} (${callData.clientId})`);
      
      return {
        success: true,
        callId: result.insertedId.toString(),
        activeCallsCount: await activeCallsCollection.countDocuments({ 
          status: { $in: ['processed', 'ringing', 'ongoing'] } 
        })
      };
    } catch (insertError) {
      // Handle duplicate key error (E11000)
      if (insertError.code === 11000 && insertError.keyValue?.callUUID) {
        console.warn(`⚠️ Duplicate callUUID detected: ${insertError.keyValue.callUUID} - call already tracked`);
        
        // Return success since the call is already tracked
        return {
          success: true,
          callId: null, // Can't provide the ID since insert failed
          activeCallsCount: await activeCallsCollection.countDocuments({ 
            status: { $in: ['processed', 'ringing', 'ongoing'] } 
          }),
          warning: 'Call already tracked (duplicate UUID)'
        };
      }
      
      // Re-throw other errors
      throw insertError;
    }
    
  } catch (error) {
    console.error('❌ Error tracking call start:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update call with Plivo CallUUID after successful API call
 * @param {string} callId - Database call ID
 * @param {string} callUUID - Plivo CallUUID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateCallUUID(callId, callUUID) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    await activeCallsCollection.updateOne(
      { _id: new ObjectId(callId) },
      { $set: { callUUID: callUUID, updatedAt: new Date() } }
    );
    
    console.log(`🔄 CallUUID updated: ${callUUID} for call ${callId}`);
    
    return { success: true };
    
  } catch (error) {
    console.error('❌ Error updating CallUUID:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Track call end/completion
 * @param {string} callUUID - Plivo CallUUID
 * @param {Object} endData - Call completion data
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function trackCallEnd(callUUID, endData = {}) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const updateData = {
      status: 'call-ended',  // Using our 5-state system: call ended but bot data not yet received
      statusTimestamp: new Date(), // Track when status was set for lazy cleanup
      endTime: new Date(),
      duration: endData.duration || null,
      endReason: endData.endReason || 'hangup',
      updatedAt: new Date()
    };
    
    const result = await activeCallsCollection.updateOne(
      { callUUID: callUUID },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      console.warn(`⚠️  CallUUID not found for end tracking: ${callUUID}`);
      return {
        success: false,
        error: 'CallUUID not found'
      };
    }
    
    console.log(`📞 Call ended: ${callUUID}`);
    
    return {
      success: true,
      activeCallsCount: await activeCallsCollection.countDocuments({ 
        status: { $in: ['processed', 'ringing', 'ongoing'] } 
      })
    };
    
  } catch (error) {
    console.error('❌ Error tracking call end:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get concurrency statistics
 * @param {string} clientId - Optional client filter
 * @returns {Promise<Object>}
 */
async function getConcurrencyStats(clientId = null) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const globalMax = parseInt(process.env.GLOBAL_MAX_CALLS) || parseInt(process.env.GLOBAL_MAX_CONCURRENT_CALLS) || 50;
    
    // Global stats (processed + ringing + ongoing)
    const globalActive = await activeCallsCollection.countDocuments({ 
      status: { $in: ['processed', 'ringing', 'ongoing'] } 
    });
    
    const stats = {
      global: {
        active: globalActive,
        max: globalMax,
        available: globalMax - globalActive,
        utilization: Math.round((globalActive / globalMax) * 100)
      }
    };
    
    // Client-specific stats if requested
    if (clientId) {
      const clientCollection = database.collection("client");
      const clientData = await clientCollection.findOne(
        { _id: new ObjectId(clientId) },
        { projection: { maxConcurrentCalls: 1 } }
      );
      
      const clientMax = clientData?.maxConcurrentCalls || parseInt(process.env.DEFAULT_CLIENT_MAX_CONCURRENT_CALLS) || 10;
      const clientActive = await activeCallsCollection.countDocuments({
        clientId: new ObjectId(clientId),
        status: { $in: ['processed', 'ringing', 'ongoing'] }
      });
      
      stats.client = {
        active: clientActive,
        max: clientMax,
        available: clientMax - clientActive,
        utilization: Math.round((clientActive / clientMax) * 100)
      };
    }
    
    return stats;
    
  } catch (error) {
    console.error('❌ Error getting concurrency stats:', error);
    return {
      global: { active: -1, max: 0, available: 0, utilization: 0 },
      error: error.message
    };
  }
}

/**
 * Cleanup timed out calls
 * @returns {Promise<{cleaned: number, error?: string}>}
 */
async function cleanupTimeoutCalls() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const timeoutMinutes = parseInt(process.env.CALL_TIMEOUT_MINUTES) || 10;
    const timeoutThreshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    
    const result = await activeCallsCollection.updateMany(
      {
        status: { $in: ['processed', 'ringing', 'ongoing'] },
        startTime: { $lt: timeoutThreshold }
      },
      {
        $set: {
          status: 'timeout',
          endTime: new Date(),
          endReason: 'timeout',
          updatedAt: new Date()
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`🧹 Cleaned up ${result.modifiedCount} timed out calls`);
    }
    
    return {
      cleaned: result.modifiedCount
    };
    
  } catch (error) {
    console.error('❌ Error cleaning up timeout calls:', error);
    return {
      cleaned: 0,
      error: error.message
    };
  }
}

// Legacy compatibility object for existing code
const activeCalls = {
  count: 0,               // Deprecated - use getConcurrencyStats() instead
  MAX_CALLS: parseInt(process.env.GLOBAL_MAX_CALLS) || parseInt(process.env.GLOBAL_MAX_CONCURRENT_CALLS) || 50,
  callTracker: new Map()  // Deprecated - use database tracking instead
};

// Start periodic cleanup process
setInterval(() => {
  cleanupTimeoutCalls().catch(error => {
    console.error('❌ Cleanup process error:', error);
  });
}, parseInt(process.env.CLEANUP_INTERVAL) || 300000); // Default 5 minutes

/**
 * Unified single call processing function
 * Handles concurrency checks, bot warmup, call tracking, and error handling
 * @param {Object} callParams - Call parameters
 * @returns {Promise<{success: boolean, callId?: string, callUUID?: string, error?: string}>}
 */
async function processSingleCall(callParams) {
  const { clientId, campaignId, from, to, wssUrl, firstName, tag, email, listId, dynamicFields } = callParams;
  const startTime = Date.now();

  try {
    console.log(`🚀 Processing call: ${from} -> ${to} (Client: ${clientId})`);
    
    // Step 0: Lazy cleanup of stuck calls
    await lazyCleanupStuckCalls();
    
    // Step 1: Wait for concurrency slot
    const slotResult = await waitForSlot(clientId);
    if (!slotResult.success) {
      return {
        success: false,
        error: 'System overloaded - no slots available',
        shouldPauseCampaign: true,
        waitTime: slotResult.waitTime
      };
    }
    
    console.log('✅ Concurrency slot available');
    
    // Step 2: Bot warmup with retry logic
    let warmupResult = { success: true, attempts: 0, duration: 0 };
    const warmupEnabled = process.env.BOT_WARMUP_ENABLED !== 'false';
    
    if (warmupEnabled && wssUrl) {
      // Extract bot's base URL from WebSocket URL and create warmup endpoint
      let botWarmupUrl;
      try {
        // Convert wss://live.glimpass.com/chat/v2/id → https://live.glimpass.com/warmup
        const wsUrl = new URL(wssUrl);
        const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
        botWarmupUrl = `${protocol}//${wsUrl.host}/warmup`;
        console.log(`🔗 Bot warmup URL extracted from wssUrl: ${botWarmupUrl}`);
      } catch (error) {
        console.error('❌ Failed to extract bot URL from wssUrl:', wssUrl, error.message);
        // Skip warmup if URL extraction fails
        warmupResult = { success: true, attempts: 0, duration: 0 };
      }
      
      if (botWarmupUrl) {
        console.log('🤖 Starting bot warmup...');
        warmupResult = await warmupBotWithRetry(botWarmupUrl);
        
        if (!warmupResult.success) {
          // Track failed call for reporting
          const failedCallData = {
            clientId,
            campaignId,
            from,
            to,
            failureReason: 'bot_not_ready',
            warmupAttempts: warmupResult.attempts,
            warmupDuration: warmupResult.duration
          };
          
          const trackResult = await trackCallStart(failedCallData);
          
          return {
            success: false,
            error: `Bot warmup failed: ${warmupResult.error}`,
            stage: 'bot_warmup',
            warmupAttempts: warmupResult.attempts,
            warmupDuration: warmupResult.duration,
            callId: trackResult.callId
          };
        }
        
        console.log(`✅ Bot warmup successful (${warmupResult.duration}ms, ${warmupResult.attempts} attempts)`);
      }
    }
    
    // Step 3: Make unified provider call to get CallUUID
    let callResult;
    try {
      // Validate call parameters
      const validation = CallProviderService.validateCallParams(callParams);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          stage: 'validation'
        };
      }
      
      // Make call using unified provider service
      callResult = await CallProviderService.makeCall({
        clientId,
        from,
        to,
        wssUrl,
        firstName,
        tag,
        email,
        listId,
        campaignId,
        provider: callParams.provider, // Pass provider parameter for explicit routing
        dynamicFields: dynamicFields || {} // Pass all dynamic CSV fields
      });
      
      if (!callResult.success) {
        // Track failed API call in database so it's counted in campaign completion
        const failedCallData = {
          callUUID: null, // No CallUUID since API call failed
          provider: callResult.provider || 'unknown',
          clientId,
          campaignId,
          from,
          to,
          warmupAttempts: warmupResult.attempts,
          warmupDuration: warmupResult.duration,
          failureReason: 'api_call_failed',
          apiError: callResult.error,
          sequenceNumber: callParams.sequenceNumber,
          firstName: callParams.firstName,
          listId: callParams.listId
        };
        
        const trackResult = await trackCallStart(failedCallData);
        if (trackResult.success) {
          console.log(`❌ Failed API call tracked: ${to} - ${callResult.error}`);
        } else {
          console.error(`❌ Failed to track failed call: ${to} - ${trackResult.error}`);
        }
        
        return {
          success: false,
          error: callResult.error,
          stage: 'provider_api',
          provider: callResult.provider,
          callId: trackResult?.callId || null
        };
      }
      
      console.log(`📞 ${callResult.provider.toUpperCase()} call initiated: ${callResult.callUUID}`);
      
    } catch (providerError) {
      console.error('❌ Provider API call failed:', providerError);
      
      // Track exception-based API failures in database
      const failedCallData = {
        callUUID: null, // No CallUUID since API call failed
        provider: 'unknown',
        clientId,
        campaignId,
        from,
        to,
        warmupAttempts: warmupResult.attempts,
        warmupDuration: warmupResult.duration,
        failureReason: 'api_exception',
        apiError: providerError.message,
        sequenceNumber: callParams.sequenceNumber,
        firstName: callParams.firstName,
        listId: callParams.listId
      };
      
      const trackResult = await trackCallStart(failedCallData);
      if (trackResult.success) {
        console.log(`❌ Failed API exception tracked: ${to} - ${providerError.message}`);
      } else {
        console.error(`❌ Failed to track failed exception: ${to} - ${trackResult.error}`);
      }
      
      return {
        success: false,
        error: `Provider API error: ${providerError.message}`,
        stage: 'provider_api',
        callId: trackResult?.callId || null
      };
    }
    
    // Step 4: Track call start in database with actual CallUUID
    const callData = {
      callUUID: callResult.callUUID, // Now we have the real CallUUID
      provider: callResult.provider, // NEW: Track which provider was used
      clientId,
      campaignId,
      from,
      to,
      warmupAttempts: warmupResult.attempts,
      warmupDuration: warmupResult.duration,
      // Enhanced tracking for pause/resume
      contactIndex: callParams.contactIndex,
      sequenceNumber: callParams.sequenceNumber,
      firstName: callParams.firstName,
      listId: callParams.listId,
      // NEW: Pass full contact data and context flags
      contactData: callParams.contactData || {
        first_name: callParams.firstName || '',
        number: to,
        listId: callParams.listId
      },
      contextFlags: callParams.contextFlags || {
        includeGlobalContext: false,
        includeAgentContext: false
      }
    };
    
    const trackResult = await trackCallStart(callData);
    if (!trackResult.success) {
      console.warn(`⚠️ Call tracking failed but ${callResult.provider} call was initiated: ${callResult.callUUID}`);
      // Don't fail the entire process - the call was successfully initiated
    } else {
      console.log(`📋 Call tracked with ID: ${trackResult.callId} (CallUUID: ${callResult.callUUID})`);
    }
    
    const totalDuration = Date.now() - startTime;
    console.log(`✅ Call processing complete: ${callResult.callUUID} (${totalDuration}ms)`);
    console.log(`🏷️ Provider used: ${callResult.provider.toUpperCase()}`);
    
    return {
        success: true,
        callId: trackResult?.callId || null,
        callUUID: callResult.callUUID,
        provider: callResult.provider, // NEW: Return provider info
        processingTime: totalDuration,
        warmupTime: warmupResult.duration,
        waitTime: slotResult.waitTime
      };
    
  } catch (error) {
    console.error('❌ Error in processSingleCall:', error);
    return {
      success: false,
      error: error.message,
      stage: 'unknown'
    };
  }
}

/**
 * Make Plivo API call with integrated logic
 * @param {Object} params - Plivo call parameters
 * @returns {Promise<{success: boolean, callUUID?: string, error?: string}>}
 */
async function makePlivoCall(params) {
  const { from, to, wssUrl, firstName, tag, email, listId, campaignId, dynamicFields } = params;
  
  try {
    console.log(`📞 Making Plivo API call: ${from} -> ${to}`);
    
    // Prepare the Plivo API call
    const axios = require('axios');
    const accountSid = process.env.PLIVO_ACCOUNT_SID;
    const plivoApiUrl = `https://api.plivo.com/v1/Account/${accountSid}/Call/`;
    
    // Get base URL from environment variable, fallback to default if not set
    const baseUrl = process.env.BASE_URL || 'https://application.glimpass.com';

    // Prepare contact data with ALL CSV fields (flat structure, no nesting)
    const contactData = dynamicFields || {};
    const campIdValue = campaignId || 'direct';

    // Build answer_url with ALL CSV fields as individual query parameters
    const answerUrlParams = new URLSearchParams({
      wss: wssUrl,
      clientId: params.clientId,
      listId: listId || 'direct',
      campId: campIdValue
    });

    // Add ALL CSV fields as individual query parameters (flat structure)
    for (const [key, value] of Object.entries(contactData)) {
      if (!['_id', 'listId'].includes(key) && value !== undefined && value !== null) {
        answerUrlParams.append(key, String(value));
      }
    }

    // Ensure backward compatibility
    if (!contactData.firstName && firstName) answerUrlParams.set('firstName', firstName);
    if (!contactData.first_name && firstName) answerUrlParams.set('first_name', firstName);
    if (!contactData.email && email) answerUrlParams.set('email', email);
    if (!contactData.tag && tag) answerUrlParams.set('tag', tag);

    const payload = {
      from,
      to,
      ring_url: `${baseUrl}/plivo/ring-url`,
      hangup_url: `${baseUrl}/plivo/hangup-url?campId=${campIdValue}&hangupFirstName=${firstName || ''}&tag=${tag || ''}`,
      answer_url: `${baseUrl}/ip/xml-plivo?${answerUrlParams.toString()}`,
      answer_method: 'POST',
    };
    
    // Make the Plivo API call
    const response = await axios.post(plivoApiUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${process.env.PLIVO_ACCOUNT_SID}:${process.env.PLIVO_AUTH_TOKEN}`).toString('base64')}`,
      },
    });
    
    // Check if the response was successful
    if (response.status >= 200 && response.status < 300) {
      const callUUID = response.data?.request_uuid || response.data?.call_uuid;
      
      console.log(`✅ Plivo API call successful: ${callUUID} for ${to}`);
      
      return {
        success: true,
        callUUID: callUUID,
        data: response.data,
        message: 'Call initiated successfully'
      };
    } else {
      console.error(`❌ Plivo API returned non-success status: ${response.status}`);
      return {
        success: false,
        error: `Plivo API returned status ${response.status}`,
        status: response.status
      };
    }
    
  } catch (error) {
    console.error('❌ Error making Plivo API call:', error.message);
    
    // Check if it's a network/timeout error vs API error
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return {
        success: false,
        error: 'Network timeout or connection error',
        code: error.code
      };
    }
    
    // Check if it's an HTTP error with response data
    if (error.response) {
      return {
        success: false,
        error: error.response.data?.error || 'Plivo API error',
        status: error.response.status,
        details: error.response.data
      };
    }
    
    return {
      success: false,
      error: error.message || 'Unknown Plivo API error'
    };
  }
}

/**
 * ONE-TIME CLEANUP: Mark all currently stuck calls as failed
 * Use this once to clean up existing stuck calls in the system
 * @returns {Promise<{success: boolean, cleanedCount: number, details: Object}>}
 */
async function oneTimeCleanupAllStuckCalls() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const now = new Date();
    const processedTimeout = parseInt(process.env.MAX_PROCESSED_TIME) || 300000; // 5 min
    const ringingTimeout = parseInt(process.env.MAX_RINGING_TIME) || 180000;     // 3 min  
    const ongoingTimeout = parseInt(process.env.MAX_ONGOING_TIME) || 3600000;    // 60 min
    
    const thresholds = {
      processed: new Date(now - processedTimeout),
      ringing: new Date(now - ringingTimeout),
      ongoing: new Date(now - ongoingTimeout)
    };
    
    console.log(`🧹 ONE-TIME CLEANUP: Checking all stuck calls...`);
    
    // Find all stuck calls first (for reporting)
    const stuckCalls = await activeCallsCollection.find({
      $or: [
        { status: 'processed', $or: [
          { statusTimestamp: { $lt: thresholds.processed } },
          { statusTimestamp: { $exists: false }, startTime: { $lt: thresholds.processed } } // Handle calls without statusTimestamp
        ]},
        { status: 'ringing', $or: [
          { statusTimestamp: { $lt: thresholds.ringing } },
          { statusTimestamp: { $exists: false }, startTime: { $lt: thresholds.ringing } }
        ]},
        { status: 'ongoing', $or: [
          { statusTimestamp: { $lt: thresholds.ongoing } },
          { statusTimestamp: { $exists: false }, startTime: { $lt: thresholds.ongoing } }
        ]}
      ]
    }).toArray();
    
    console.log(`🔍 Found ${stuckCalls.length} stuck calls:`);
    stuckCalls.forEach(call => {
      const age = Math.round((now - new Date(call.statusTimestamp || call.startTime)) / 60000);
      console.log(`  - ${call.callUUID || 'NO-UUID'}: ${call.status} for ${age}min (Campaign: ${call.campaignId})`);
    });
    
    // Mark all stuck calls as failed
    const updateResult = await activeCallsCollection.updateMany(
      {
        $or: [
          { status: 'processed', $or: [
            { statusTimestamp: { $lt: thresholds.processed } },
            { statusTimestamp: { $exists: false }, startTime: { $lt: thresholds.processed } }
          ]},
          { status: 'ringing', $or: [
            { statusTimestamp: { $lt: thresholds.ringing } },
            { statusTimestamp: { $exists: false }, startTime: { $lt: thresholds.ringing } }
          ]},
          { status: 'ongoing', $or: [
            { statusTimestamp: { $lt: thresholds.ongoing } },
            { statusTimestamp: { $exists: false }, startTime: { $lt: thresholds.ongoing } }
          ]}
        ]
      },
      {
        $set: {
          status: 'failed',
          failureReason: 'one_time_cleanup_timeout',
          failedAt: new Date(),
          statusTimestamp: new Date(),
          updatedAt: new Date()
        }
      }
    );
    
    console.log(`✅ ONE-TIME CLEANUP: Marked ${updateResult.modifiedCount} stuck calls as failed`);
    
    return { 
      success: true, 
      cleanedCount: updateResult.modifiedCount,
      details: {
        processed: stuckCalls.filter(c => c.status === 'processed').length,
        ringing: stuckCalls.filter(c => c.status === 'ringing').length,
        ongoing: stuckCalls.filter(c => c.status === 'ongoing').length,
        stuckCallIds: stuckCalls.map(c => c.callUUID || c._id.toString())
      }
    };
    
  } catch (error) {
    console.error('❌ Error in one-time cleanup:', error);
    return { 
      success: false, 
      cleanedCount: 0,
      error: error.message
    };
  }
}

/**
 * Lazy cleanup of stuck calls - called before each processSingleCall
 * Marks calls as 'failed' if they exceed timeout in early states
 * @returns {Promise<{success: boolean, cleanedCount: number}>}
 */
async function lazyCleanupStuckCalls() {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const now = new Date();
    const processedTimeout = parseInt(process.env.MAX_PROCESSED_TIME) || 300000; // 5 min
    const ringingTimeout = parseInt(process.env.MAX_RINGING_TIME) || 180000;     // 3 min  
    const ongoingTimeout = parseInt(process.env.MAX_ONGOING_TIME) || 3600000;    // 60 min
    
    const thresholds = {
      processed: new Date(now - processedTimeout),
      ringing: new Date(now - ringingTimeout),
      ongoing: new Date(now - ongoingTimeout)
    };
    
    // Find and mark stuck calls as failed
    const updateResult = await activeCallsCollection.updateMany(
      {
        $or: [
          { status: 'processed', statusTimestamp: { $lt: thresholds.processed } },
          { status: 'ringing', statusTimestamp: { $lt: thresholds.ringing } },
          { status: 'ongoing', statusTimestamp: { $lt: thresholds.ongoing } }
        ]
      },
      {
        $set: {
          status: 'failed',
          failureReason: 'webhook_timeout',
          failedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
    
    if (updateResult.modifiedCount > 0) {
      console.log(`🧹 Lazy cleanup: Marked ${updateResult.modifiedCount} stuck calls as failed`);
    }
    
    return { 
      success: true, 
      cleanedCount: updateResult.modifiedCount 
    };
    
  } catch (error) {
    console.error('❌ Error in lazy cleanup:', error);
    return { 
      success: false, 
      cleanedCount: 0 
    };
  }
}

module.exports = {
  // Legacy export for compatibility
  activeCalls,
  
  // New database-driven functions
  checkClientConcurrency,
  checkGlobalConcurrency,
  waitForAvailableSlot,
  waitForSlot,
  trackCallStart,
  updateCallUUID,
  trackCallEnd,
  getConcurrencyStats,
  cleanupTimeoutCalls,
  lazyCleanupStuckCalls,
  oneTimeCleanupAllStuckCalls,
  
  // Unified call processing
  processSingleCall
};
