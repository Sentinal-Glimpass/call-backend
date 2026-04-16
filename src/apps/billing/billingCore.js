const { connectToMongo, client } = require('../../../models/mongodb.js');
const { ObjectId } = require('mongodb');

// Environment configurations
const INCOMING_AGGREGATION_TIME = parseInt(process.env.INCOMING_AGGREGATION_TIME) || 3600000; // 1 hour default

/**
 * Save detailed call billing information to callBillingDetails collection
 * @param {Object} callData - Call billing data
 * @returns {Object} Result with success status and recordId
 */
async function saveCallBillingDetail(callData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("callBillingDetails");

    const {
      clientId,
      callUuid,
      duration,
      type,
      from,
      to,
      campaignId = null,
      campaignName = null,
      credits = 0,
      aiCredits = 0,
      telephonyCredits = 0
    } = callData;

    // IDEMPOTENCY CHECK: Prevent duplicate call billing details for webhook retries
    const existingRecord = await collection.findOne({ callUuid: callUuid });
    if (existingRecord) {
      console.log(`⚠️ Call billing detail already exists for ${callUuid} - skipping duplicate`);
      return {
        success: true,
        recordId: existingRecord._id.toString(),
        billingDetail: existingRecord,
        duplicate: true
      };
    }

    // Calculate total credits if not provided
    const totalCredits = credits || (aiCredits + telephonyCredits);

    const billingDetail = {
      clientId: clientId.toString(),
      callUuid,
      timestamp: new Date(),
      type, // campaign, incoming, testcall, api-call
      duration: parseInt(duration) || 0,
      from,
      to,
      credits: totalCredits,
      aiCredits: aiCredits || 0,
      telephonyCredits: telephonyCredits || totalCredits, // Default to total if not split
      campaignId: campaignId ? campaignId.toString() : null,
      campaignName: campaignName || null
    };

    const result = await collection.insertOne(billingDetail);

    console.log(`✅ Call billing detail saved: ${result.insertedId} (${type} - ${totalCredits} credits)`);
    
    return {
      success: true,
      recordId: result.insertedId.toString(),
      billingDetail
    };
    
  } catch (error) {
    console.error('❌ Error saving call billing detail:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update client balance and lastIncomingAggregationTime if needed
 * @param {string} clientId - Client ID
 * @param {number} creditChange - Credit change (negative for deductions)
 * @param {string} callType - Type of call (for aggregation timing)
 * @returns {Object} Result with success status and new balance
 */
async function updateClientBalance(clientId, creditChange, callType = null) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("client");
    
    const filter = { _id: new ObjectId(clientId) };
    
    // Get current client data
    const currentClient = await collection.findOne(filter);
    if (!currentClient) {
      return {
        success: false,
        error: 'Client not found'
      };
    }
    
    const newBalance = (currentClient.availableBalance || 0) + creditChange;
    
    // Update object
    const updateData = {
      availableBalance: newBalance,
      lastBalanceUpdate: new Date()
    };
    
    // If this is an incoming call and we're updating aggregation time
    if (callType === 'incoming') {
      updateData.lastIncomingAggregationTime = new Date();
    }
    
    const result = await collection.updateOne(filter, { $set: updateData });
    
    if (result.modifiedCount > 0) {
      console.log(`✅ Client balance updated: ${clientId} (${creditChange >= 0 ? '+' : ''}${creditChange} credits, new balance: ${newBalance})`);
      return {
        success: true,
        newBalance,
        previousBalance: currentClient.availableBalance || 0
      };
    } else {
      return {
        success: false,
        error: 'Failed to update client balance'
      };
    }
    
  } catch (error) {
    console.error('❌ Error updating client balance:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get call details with cursor-based pagination
 * @param {string} clientId - Client ID
 * @param {string} cursor - Cursor for pagination (optional)
 * @param {number} limit - Number of records to return (default 100)
 * @returns {Object} Paginated call details
 */
async function getCallDetails(clientId, cursor = null, limit = 100) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("callBillingDetails");
    
    // Build query
    const query = { clientId: clientId.toString() };
    
    // Add cursor condition for pagination
    if (cursor) {
      try {
        const cursorDoc = await collection.findOne({ _id: new ObjectId(cursor) });
        if (cursorDoc) {
          query.timestamp = { $lt: cursorDoc.timestamp };
        }
      } catch (err) {
        console.warn('Invalid cursor provided:', cursor);
      }
    }
    
    // Fetch records with limit + 1 to check if there are more
    const records = await collection
      .find(query)
      .sort({ timestamp: -1 }) // Most recent first
      .limit(limit + 1)
      .toArray();
    
    // Check if there are more records
    const hasMore = records.length > limit;
    const calls = hasMore ? records.slice(0, limit) : records;
    
    // Generate next cursor
    let nextCursor = null;
    if (hasMore && calls.length > 0) {
      nextCursor = calls[calls.length - 1]._id.toString();
    }
    
    console.log(`📋 Retrieved ${calls.length} call details for client ${clientId}`);
    
    return {
      success: true,
      calls: calls.map(call => ({
        id: call._id.toString(),
        callUuid: call.callUuid,
        timestamp: call.timestamp,
        type: call.type,
        duration: call.duration,
        from: call.from,
        to: call.to,
        credits: call.credits,
        aiCredits: call.aiCredits,
        telephonyCredits: call.telephonyCredits,
        campaignId: call.campaignId,
        campaignName: call.campaignName
      })),
      nextCursor,
      hasMore,
      totalReturned: calls.length
    };
    
  } catch (error) {
    console.error('❌ Error getting call details:', error);
    return {
      success: false,
      error: error.message,
      calls: [],
      nextCursor: null,
      hasMore: false
    };
  }
}

/**
 * Check if incoming call aggregation is needed for a client
 * @param {string} clientId - Client ID
 * @returns {Object} Aggregation check result
 */
async function needsIncomingAggregation(clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const clientCollection = database.collection("client");
    
    const clientData = await clientCollection.findOne(
      { _id: new ObjectId(clientId) },
      { projection: { lastIncomingAggregationTime: 1 } }
    );
    
    if (!clientData) {
      return { needed: false, error: 'Client not found' };
    }
    
    const lastAggregationTime = clientData.lastIncomingAggregationTime || new Date(0);
    const timeSinceLastAggregation = Date.now() - lastAggregationTime.getTime();
    const needed = timeSinceLastAggregation >= INCOMING_AGGREGATION_TIME;
    
    console.log(`🔍 Incoming aggregation check for ${clientId}: ${needed ? 'NEEDED' : 'NOT NEEDED'} (${Math.round(timeSinceLastAggregation / 60000)} minutes since last)`);
    
    return {
      needed,
      lastAggregationTime,
      timeSinceLastAggregation,
      thresholdTime: INCOMING_AGGREGATION_TIME
    };
    
  } catch (error) {
    console.error('❌ Error checking aggregation need:', error);
    return {
      needed: false,
      error: error.message
    };
  }
}

/**
 * Aggregate incoming calls since last aggregation
 * @param {string} clientId - Client ID
 * @param {Date} sinceTimestamp - Aggregate calls since this timestamp
 * @returns {Object} Aggregation result
 */
async function aggregateIncomingCallsSince(clientId, sinceTimestamp) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("callBillingDetails");
    
    const pipeline = [
      {
        $match: {
          clientId: clientId.toString(),
          type: 'incoming',
          timestamp: { $gt: sinceTimestamp }
        }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalCredits: { $sum: '$credits' },
          totalAiCredits: { $sum: '$aiCredits' },
          totalTelephonyCredits: { $sum: '$telephonyCredits' },
          totalDuration: { $sum: '$duration' },
          startTime: { $min: '$timestamp' },
          endTime: { $max: '$timestamp' }
        }
      }
    ];
    
    const result = await collection.aggregate(pipeline).toArray();
    
    if (result.length === 0) {
      return {
        success: true,
        totalCalls: 0,
        totalCredits: 0,
        totalAiCredits: 0,
        totalTelephonyCredits: 0,
        totalDuration: 0,
        startTime: sinceTimestamp,
        endTime: sinceTimestamp
      };
    }
    
    const aggregation = result[0];
    console.log(`📊 Aggregated ${aggregation.totalCalls} incoming calls (${aggregation.totalCredits} credits)`);
    
    return {
      success: true,
      totalCalls: aggregation.totalCalls,
      totalCredits: aggregation.totalCredits,
      totalAiCredits: aggregation.totalAiCredits,
      totalTelephonyCredits: aggregation.totalTelephonyCredits,
      totalDuration: aggregation.totalDuration,
      startTime: aggregation.startTime,
      endTime: aggregation.endTime
    };
    
  } catch (error) {
    console.error('❌ Error aggregating incoming calls:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Save aggregation to billing history
 * @param {Object} aggregationData - Aggregation data to save
 * @returns {Object} Save result
 */
async function saveAggregationToBillingHistory(aggregationData) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("billingHistory");
    const clientCollection = database.collection("client");
    
    const {
      clientId,
      type,
      title,
      totalCalls,
      totalCredits,
      totalDuration,
      startTime,
      endTime
    } = aggregationData;
    
    // Get current client balance
    const clientData = await clientCollection.findOne(
      { _id: new ObjectId(clientId) },
      { projection: { availableBalance: 1 } }
    );
    
    const billingEntry = {
      clientId: clientId.toString(),
      camp_name: title,
      campaignId: '',
      balanceCount: -totalCredits, // Negative for deductions
      date: new Date(),
      desc: `${type} calls aggregation: ${totalCalls} calls, ${Math.round(totalDuration/60)} minutes`,
      transactionType: 'Dr',
      newAvailableBalance: clientData ? clientData.availableBalance : 0,
      aggregationType: type,
      aggregationPeriod: {
        startTime,
        endTime,
        totalCalls,
        totalDuration
      }
    };
    
    const result = await collection.insertOne(billingEntry);
    
    // Update client's lastIncomingAggregationTime
    await clientCollection.updateOne(
      { _id: new ObjectId(clientId) },
      { $set: { lastIncomingAggregationTime: new Date() } }
    );
    
    console.log(`✅ Aggregation saved to billing history: ${result.insertedId}`);
    
    return {
      success: true,
      aggregationId: result.insertedId.toString(),
      billingEntry
    };
    
  } catch (error) {
    console.error('❌ Error saving aggregation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update AI credits for an existing call record
 * @param {string} callUuid - Call UUID
 * @param {number} aiCredits - AI credits to add
 * @returns {Object} Update result
 */
async function updateCallAICredits(callUuid, aiCredits) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const collection = database.collection("callBillingDetails");
    
    const result = await collection.updateOne(
      { callUuid },
      { 
        $set: { 
          aiCredits,
          lastAIUpdate: new Date()
        },
        $inc: {
          credits: aiCredits // Add to total credits
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`✅ AI credits updated for call ${callUuid}: +${aiCredits} credits`);
      return { success: true };
    } else {
      console.warn(`⚠️ Call not found for AI credit update: ${callUuid}`);
      return { success: false, error: 'Call record not found' };
    }
    
  } catch (error) {
    console.error('❌ Error updating AI credits:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Self-healing campaign aggregation
 * Finds campaigns in final states (completed/cancelled/failed) that haven't been billed to billingHistory,
 * atomically claims each one via isBalanceUpdated flag, aggregates from callBillingDetails,
 * and writes a single billingHistory entry per campaign.
 *
 * Idempotent and concurrent-safe: the atomic findOneAndUpdate on isBalanceUpdated is the lock.
 *
 * @param {string} clientId - Client ID to reconcile
 * @returns {Object} Result with number of campaigns reconciled
 */
async function reconcileFinishedCampaigns(clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const campaignCollection = database.collection("plivoCampaign");
    const callBillingCollection = database.collection("callBillingDetails");
    const billingHistoryCollection = database.collection("billingHistory");
    const clientCollection = database.collection("client");

    // Find candidate campaigns: final state AND not yet billed to history
    const candidates = await campaignCollection.find({
      clientId: clientId.toString(),
      status: { $in: ['completed', 'cancelled', 'failed'] },
      isBalanceUpdated: { $ne: true }
    }).toArray();

    if (candidates.length === 0) {
      return { success: true, reconciledCount: 0, entries: [] };
    }

    console.log(`🔄 Reconciling ${candidates.length} finalized campaign(s) for client ${clientId}`);

    const reconciled = [];

    for (const campaign of candidates) {
      const campaignIdStr = campaign._id.toString();

      // Atomic claim — only one concurrent caller wins
      const claim = await campaignCollection.findOneAndUpdate(
        { _id: campaign._id, isBalanceUpdated: { $ne: true } },
        {
          $set: {
            isBalanceUpdated: true,
            billingProcessedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );

      if (!claim) {
        console.log(`ℹ️ Campaign ${campaignIdStr} already claimed by another request - skipping`);
        continue;
      }

      // Aggregate from callBillingDetails (authoritative per-call ground truth)
      const aggPipeline = [
        {
          $match: {
            clientId: clientId.toString(),
            campaignId: campaignIdStr,
            type: 'campaign'
          }
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            totalCredits: { $sum: '$credits' },
            totalDuration: { $sum: '$duration' },
            startTime: { $min: '$timestamp' },
            endTime: { $max: '$timestamp' }
          }
        }
      ];

      const [agg] = await callBillingCollection.aggregate(aggPipeline).toArray();
      const totalCalls = agg ? agg.totalCalls : 0;
      const totalCredits = agg ? Math.round(agg.totalCredits || 0) : 0;
      const totalDuration = agg ? (agg.totalDuration || 0) : 0;

      // Fetch current client balance for the entry's snapshot (balance was already deducted per-call)
      const clientDoc = await clientCollection.findOne(
        { _id: new ObjectId(clientId) },
        { projection: { availableBalance: 1 } }
      );
      const currentBalance = clientDoc ? (clientDoc.availableBalance || 0) : 0;

      const statusLabel = campaign.status === 'completed'
        ? 'completed'
        : campaign.status === 'cancelled'
          ? 'cancelled'
          : 'failed';

      const desc = `Campaign ${statusLabel}: ${campaign.campaignName} - ${totalCalls} calls, ${totalDuration} seconds total`;

      const billingEntry = {
        clientId: clientId.toString(),
        camp_name: campaign.campaignName,
        campaignId: campaignIdStr,
        balanceCount: -totalCredits,
        date: campaign.completedAt || campaign.pausedAt || new Date(),
        desc,
        transactionType: 'Dr',
        newAvailableBalance: currentBalance,
        callUUID: null,
        callDuration: totalDuration,
        callType: 'campaign_aggregate',
        from: null,
        to: null,
        aggregationPeriod: agg ? {
          startTime: agg.startTime,
          endTime: agg.endTime,
          totalCalls,
          totalDuration
        } : null
      };

      const insertResult = await billingHistoryCollection.insertOne(billingEntry);

      // Store the billingEntryId back on the campaign for future traceability
      await campaignCollection.updateOne(
        { _id: campaign._id },
        { $set: { billingEntryId: insertResult.insertedId } }
      );

      console.log(`✅ Reconciled campaign ${campaignIdStr} (${statusLabel}): ${totalCalls} calls, ${totalCredits} credits → billingHistory ${insertResult.insertedId}`);

      reconciled.push({
        campaignId: campaignIdStr,
        campaignName: campaign.campaignName,
        status: campaign.status,
        totalCalls,
        totalCredits,
        totalDuration,
        billingEntryId: insertResult.insertedId.toString()
      });
    }

    return { success: true, reconciledCount: reconciled.length, entries: reconciled };

  } catch (error) {
    console.error('❌ Error reconciling finished campaigns:', error);
    return { success: false, error: error.message, reconciledCount: 0, entries: [] };
  }
}

/**
 * Compute virtual "live" rows for campaigns still in progress.
 * These are NOT persisted — they're computed at read time from callBillingDetails
 * and merged into the response so users can see credits-spent-so-far in Transaction History.
 *
 * When the campaign transitions to a final state, reconcileFinishedCampaigns picks it up
 * and writes a persistent entry; the status filter here then excludes it → no duplicate rows.
 *
 * @param {string} clientId - Client ID
 * @returns {Array} Array of virtual billingHistory-shaped entries (with isLive: true flag)
 */
async function computeRunningCampaignRows(clientId) {
  try {
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const campaignCollection = database.collection("plivoCampaign");
    const callBillingCollection = database.collection("callBillingDetails");
    const clientCollection = database.collection("client");

    // Campaigns currently in progress (not yet eligible for reconciliation)
    const runningCampaigns = await campaignCollection.find({
      clientId: clientId.toString(),
      status: { $in: ['running', 'paused', 'scheduled'] }
    }).toArray();

    if (runningCampaigns.length === 0) return [];

    // Fetch current client balance once — used as an anchor value on the most recent live row.
    // (The Bills UI reads newAvailableBalance for the "Balance" column; null would display as 0.)
    const clientDoc = await clientCollection.findOne(
      { _id: new ObjectId(clientId) },
      { projection: { availableBalance: 1 } }
    );
    const currentBalance = clientDoc ? (clientDoc.availableBalance || 0) : 0;

    const rows = [];

    for (const campaign of runningCampaigns) {
      const campaignIdStr = campaign._id.toString();

      const aggPipeline = [
        {
          $match: {
            clientId: clientId.toString(),
            campaignId: campaignIdStr,
            type: 'campaign'
          }
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            totalCredits: { $sum: '$credits' },
            totalDuration: { $sum: '$duration' },
            lastCallAt: { $max: '$timestamp' }
          }
        }
      ];

      const [agg] = await callBillingCollection.aggregate(aggPipeline).toArray();
      const totalCalls = agg ? agg.totalCalls : 0;
      const totalCredits = agg ? Math.round(agg.totalCredits || 0) : 0;
      const totalDuration = agg ? (agg.totalDuration || 0) : 0;
      const lastCallAt = agg ? agg.lastCallAt : null;

      // Skip campaigns with zero completed calls so far — nothing to show
      if (totalCalls === 0) continue;

      const pauseSuffix = campaign.status === 'paused' && campaign.pauseReason === 'insufficient_balance'
        ? ' (paused: insufficient balance)'
        : '';

      const desc = `Campaign ${campaign.status}: ${campaign.campaignName} - ${totalCalls} calls so far, ${totalDuration} seconds${pauseSuffix}`;

      rows.push({
        _id: `live-${campaignIdStr}`,          // synthetic id; prefixed so React keys & backend lookups can't collide
        clientId: clientId.toString(),
        camp_name: campaign.campaignName,
        campaignId: campaignIdStr,
        balanceCount: -totalCredits,
        date: lastCallAt || campaign.lastActivity || campaign.createdAt || new Date(),
        desc,
        transactionType: 'Dr',
        newAvailableBalance: currentBalance,   // anchor with current live balance (SSE updates it in real-time)
        callUUID: null,
        callDuration: totalDuration,
        callType: 'campaign_live',
        from: null,
        to: null,
        isLive: true,                           // flag for any UI that wants to style live rows distinctly
        campaignStatus: campaign.status
      });
    }

    // Sort newest-first so the freshest running campaign is at the top when prepended
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));

    return rows;

  } catch (error) {
    console.error('❌ Error computing running campaign rows:', error);
    return [];
  }
}

module.exports = {
  saveCallBillingDetail,
  updateClientBalance,
  getCallDetails,
  needsIncomingAggregation,
  aggregateIncomingCallsSince,
  saveAggregationToBillingHistory,
  updateCallAICredits,
  reconcileFinishedCampaigns,
  computeRunningCampaignRows
};