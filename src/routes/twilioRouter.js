/**
 * Twilio Router
 * Handles Twilio-specific webhooks and TwiML responses
 */

const express = require('express');
const router = express.Router();
const TwilioAdapter = require('../adapters/twilioAdapter');
const { connectToMongo, client } = require('../../models/mongodb.js');

/**
 * @swagger
 * tags:
 *   name: Twilio
 *   description: Twilio webhook endpoints and TwiML responses
 */

/**
 * @swagger
 * /twilio/twiml:
 *   post:
 *     tags: [Twilio]
 *     summary: Generate TwiML response for Twilio calls
 *     description: Returns TwiML XML to control Twilio call flow
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               CallSid:
 *                 type: string
 *               From:
 *                 type: string  
 *               To:
 *                 type: string
 *     responses:
 *       200:
 *         description: TwiML XML response
 *         content:
 *           application/xml:
 *             schema:
 *               type: string
 */
router.post('/twiml', (req, res) => {
  try {
    const { wss, clientId, campId, listId, preUUID } = req.query;
    const { CallSid, From, To } = req.body;

    console.log(`🔵 Twilio TwiML request:`);
    console.log(`   Call SID: ${CallSid}`);
    console.log(`   From: ${From}`);
    console.log(`   To: ${To}`);
    console.log(`   WSS URL: ${wss}`);
    console.log(`   Client ID: ${clientId}`);

    if (!wss) {
      console.error('❌ Missing WebSocket URL in TwiML request');
      const errorTwiML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Sorry, there was a configuration error. Please try again later.</Say>
    <Hangup/>
</Response>`;
      return res.type('application/xml').send(errorTwiML);
    }

    // Generate TwiML response
    const twiml = TwilioAdapter.generateTwiML({
      wssUrl: wss,
      callSid: preUUID || CallSid,
      clientId: clientId,
      campaignId: campId,
      listId: listId,
      from: From,
      to: To
    });

    console.log(`✅ Generated TwiML for call ${CallSid}`);
    res.type('application/xml').send(twiml);

  } catch (error) {
    console.error('❌ Error generating TwiML:', error);
    const errorTwiML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Sorry, there was an error. Please try again later.</Say>
    <Hangup/>
</Response>`;
    res.type('application/xml').send(errorTwiML);
  }
});

/**
 * @swagger
 * /twilio/status-callback:
 *   post:
 *     tags: [Twilio]
 *     summary: Handle Twilio call status callbacks
 *     description: Receives call status updates from Twilio
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               CallSid:
 *                 type: string
 *               CallStatus:
 *                 type: string
 *               Duration:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status callback processed
 */
router.post('/status-callback', async (req, res) => {
  try {
    const { CallSid, CallStatus, Duration, From, To } = req.body;
    
    console.log(`🔵 Twilio status callback:`);
    console.log(`   Call SID: ${CallSid}`);
    console.log(`   Status: ${CallStatus}`);
    console.log(`   Duration: ${Duration}`);
    
    if (!CallSid) {
      return res.status(400).json({ error: 'Missing CallSid' });
    }
    
    // Map Twilio status to internal status
    const internalStatus = TwilioAdapter.mapCallStatus(CallStatus);
    
    // Update call record in database
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const updateData = {
      status: internalStatus,
      statusTimestamp: new Date(),
      updatedAt: new Date() // Match Plivo behavior
    };
    
    // Add ringTime for ringing status (match Plivo behavior)
    if (CallStatus === 'ringing') {
      updateData.ringTime = new Date();
    }
    
    // Handle equivalent of Plivo's StartStream event
    if (CallStatus === 'in-progress') {
      updateData.streamStartTime = new Date(); // Equivalent to Plivo's StartStream timestamp
      console.log(`🎙️ Twilio call conversation started (equivalent to StartStream): ${CallSid}`);
    }
    
    // Add duration and end time for completed calls
    if (CallStatus === 'completed' && Duration) {
      updateData.duration = parseInt(Duration);
      updateData.endTime = new Date();
      
      // CRITICAL: Look up call record by Twilio CallSid to get our pre-generated UUID and client info
      const callRecord = await activeCallsCollection.findOne(
        { twilioCallSid: CallSid },
        { projection: { callUUID: 1, clientId: 1, campaignId: 1 } }
      );
      
      if (!callRecord) {
        console.error(`❌ No call record found for Twilio CallSid: ${CallSid}`);
        return res.status(200).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }
      
      const ourCallUUID = callRecord.callUUID; // Use our pre-generated UUID, not Twilio's CallSid
      
      // Determine campaign type for use in both hangup data and billing
      const campId = callRecord?.campaignId === 'testcall' ? 'testcall' : (callRecord?.campaignId?.toString() || 'incoming');
      
      // Map Twilio data to exact Plivo format for frontend compatibility
      // Track if this is a retry (call already processed)
      let isRetry = false;

      try {
        const hangupCollection = database.collection("plivoHangupData");
        const { mapTwilioHangupToPlivoFormat } = require('../adapters/twilioToPlivoMapper.js');

        // CRITICAL IDEMPOTENCY CHECK: Check if this call was already processed
        const existingHangup = await hangupCollection.findOne({ CallUUID: ourCallUUID });
        if (existingHangup) {
          console.log(`⚠️ Twilio call ${ourCallUUID} already processed - skipping to prevent double billing`);
          isRetry = true;
        } else {
          // Debug: Check if RecordingUrl is in the status callback
          if (req.body.RecordingUrl) {
            console.log(`🎬 Recording URL found in status callback: ${req.body.RecordingUrl}`);
          }

          console.log(`🔍 DEBUG - Raw Twilio data:`, JSON.stringify({
            CallSid: req.body.CallSid,
            RecordingUrl: req.body.RecordingUrl,
            Duration: req.body.Duration,
            CallDuration: req.body.CallDuration
          }, null, 2));

          // Transform Twilio data to Plivo format
          const hangupData = mapTwilioHangupToPlivoFormat(req.body, {
            ...callRecord,
            tag: callRecord.tag || '',
            firstName: callRecord.firstName || ''
          });

          console.log(`🔍 DEBUG - Mapped hangup data RecordUrl:`, hangupData.RecordUrl);

          await hangupCollection.insertOne(hangupData);

          // Fetch and log what was actually saved
          const savedRecord = await hangupCollection.findOne({ CallUUID: ourCallUUID }, { RecordUrl: 1, Duration: 1, BillDuration: 1 });
          console.log(`🔍 DEBUG - Saved record:`, JSON.stringify(savedRecord, null, 2));

          console.log(`✅ Twilio hangup data saved in Plivo format for call ${ourCallUUID} -> Twilio SID ${CallSid}`);
          console.log(`   Client: ${hangupData.clientId}, Campaign: ${hangupData.campId}, Duration: ${hangupData.Duration}s`);
          console.log(`   Recording URL: ${hangupData.RecordUrl || 'STILL NULL!'}`);
          console.log(`   BillDuration: ${hangupData.BillDuration}s`);
        } // End of else block (not a retry)
      } catch (hangupError) {
        console.error('❌ Error saving Twilio hangup data:', hangupError);
      }
      
      // Track call end using our UUID (for compatibility with Plivo tracking)
      const { trackCallEnd } = require('../apps/helper/activeCalls.js');
      try {
        const endResult = await trackCallEnd(ourCallUUID);
        if (!endResult.success) {
          console.warn(`⚠️ Failed to track Twilio call end: ${endResult.error}`);
        } else {
          console.log(`✅ Tracked Twilio call end: ${ourCallUUID}`);
        }
      } catch (trackError) {
        console.error(`❌ Error tracking Twilio call end:`, trackError);
      }
      
      // CRITICAL: Add missing billing operations that Plivo hangup handler does
      // Skip billing if this is a retry (call already processed)
      if (callRecord?.clientId && !isRetry) {
        try {

          const { CallDuration } = req.body;
          const billingDuration = parseInt(CallDuration) || parseInt(Duration) || 0;
          console.log(`💰 Processing Twilio billing for call: ${CallSid}, Type: ${campId}, Duration: ${billingDuration}s (CallDuration: ${CallDuration}, Duration: ${Duration})`);
          
          const { 
            saveCallBillingDetail, 
            updateClientBalance: updateClientBalanceNew
          } = require('../apps/billing/billingCore');
          const { getClientByClientId } = require('../apps/interLogue/client');
          const billingRouter = require('./billingRouter');
          
          // Determine call type
          let callType;
          if (campId === 'incoming') {
            callType = 'incoming';
          } else if (campId === 'testcall') {
            callType = 'testcall';
          } else if (campId === 'api-call') {
            callType = 'api-call'; // API-initiated calls via API key - treated like testcall for billing
          } else {
            callType = 'campaign';
          }
          
          const clientId = callRecord.clientId.toString();
          
          // Get client data
          const existingClient = await getClientByClientId(clientId);
          if (!existingClient) {
            console.error('❌ Client not found for Twilio billing:', clientId);
            throw new Error(`Client not found: ${clientId}`);
          }
          
          const creditsToDeduct = billingDuration; // 1 second = 1 credit (use CallDuration)
          const currentBalance = existingClient.availableBalance || 0;
          const newBalance = currentBalance - creditsToDeduct;
          
          console.log(`💰 Twilio Billing: ${callType} call - ${creditsToDeduct} credits (duration: ${billingDuration}s)`);
          console.log(`💰 Current Balance: ${currentBalance} -> ${newBalance}`);
          
          // Update client balance immediately for ALL calls
          const clientCollection = database.collection("client");
          const { ObjectId } = require('mongodb');
          
          await clientCollection.updateOne(
            { _id: new ObjectId(clientId) },
            { $set: { availableBalance: newBalance } }
          );
          
          // Broadcast balance update via SSE
          if (billingRouter.broadcastBalanceUpdate) {
            try {
              console.log(`📡 Broadcasting Twilio balance update: ${clientId} -> ${newBalance} credits (Call Type: ${callType})`);
              billingRouter.broadcastBalanceUpdate(clientId, newBalance, 'call_end');
            } catch (error) {
              console.warn('Failed to broadcast Twilio balance update:', error.message);
            }
          }
          
          // BILLING HISTORY: Only for non-campaign calls (incoming, test calls, api calls)
          if (callType !== 'campaign') {
            const billingHistoryCollection = database.collection("billingHistory");

            // IDEMPOTENCY CHECK: Prevent duplicate billing entries for webhook retries
            const existingBillingEntry = await billingHistoryCollection.findOne({
              callUUID: CallSid,
              callType: callType
            });

            if (existingBillingEntry) {
              console.log(`⚠️ Twilio billing entry already exists for ${callType} call ${CallSid} - skipping duplicate`);
            } else {
              let billingDescription, campName;
              if (callType === 'testcall') {
                billingDescription = `Test call to ${To} for ${billingDuration} seconds`;
                campName = 'Test Call';
              } else if (callType === 'api-call') {
                billingDescription = `API call to ${To} for ${billingDuration} seconds`;
                campName = 'API Call';
              } else {
                billingDescription = `Incoming call from ${From} for ${billingDuration} seconds`;
                campName = 'Incoming Call';
              }

              const billingEntry = {
                clientId: clientId,
                camp_name: campName,
                campaignId: '',
                balanceCount: -creditsToDeduct,
                date: new Date(),
                desc: billingDescription,
                transactionType: 'Dr',
                newAvailableBalance: newBalance,
                callUUID: CallSid,
                callDuration: billingDuration,
                callType: callType,
                from: From,
                to: To
              };

              await billingHistoryCollection.insertOne(billingEntry);
              console.log(`✅ Twilio billingHistory entry created for ${callType}`);
            }
          } else {
            console.log(`📋 Twilio campaign call - balance updated but billing history deferred until campaign completion`);
          }
          
          // Save detailed call record
          await saveCallBillingDetail({
            clientId: clientId,
            callUuid: CallSid,
            duration: billingDuration,
            type: callType,
            from: From,
            to: To,
            credits: creditsToDeduct,
            aiCredits: 0,
            telephonyCredits: creditsToDeduct,
            campaignId: callType === 'campaign' ? campId : null,
            campaignName: callType === 'campaign' ? `Campaign ${campId}` : null
          });
          
          console.log(`✅ Twilio call billing processed: ${creditsToDeduct} credits deducted, balance updated to ${newBalance} (Call Type: ${callType})`);
          
        } catch (billingError) {
          console.error(`❌ Twilio billing failed:`, billingError);
          // Don't fail the entire hangup process if billing fails
        }
      }
      
      // This is now handled above with our UUID-based tracking system
    }
    
    // NEW APPROACH: Search by twilioCallSid field (our UUID system)
    let result = await activeCallsCollection.updateOne(
      { twilioCallSid: CallSid, provider: 'twilio' },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      console.warn(`⚠️ No call record found for Twilio CallSid: ${CallSid} - trying fallback strategies...`);
      
      // Fallback 1: Search by twilioCallSid without provider requirement
      result = await activeCallsCollection.updateOne(
        { twilioCallSid: CallSid },
        { $set: { ...updateData, provider: 'twilio' } }
      );
      
      if (result.matchedCount > 0) {
        console.log(`✅ Found and updated call record by twilioCallSid: ${CallSid}`);
      } else {
        // Fallback 2: Legacy search by callUUID (for backwards compatibility)
        result = await activeCallsCollection.updateOne(
          { callUUID: CallSid },
          { $set: { ...updateData, provider: 'twilio' } }
        );
        
        if (result.matchedCount > 0) {
          console.log(`✅ Found call record using legacy callUUID search: ${CallSid}`);
        } else {
          console.error(`❌ No call record found for CallSid: ${CallSid}`);
          
          // Debug: Show recent records
          const allRecords = await activeCallsCollection
            .find({}, { 
              projection: { 
                callUUID: 1, 
                twilioCallSid: 1, 
                provider: 1, 
                from: 1, 
                to: 1, 
                status: 1 
              } 
            })
            .limit(5)
            .toArray();
          console.log(`🔍 Recent call records:`, allRecords);
        }
      }
    } else {
      console.log(`✅ Updated Twilio call ${CallSid} status to ${internalStatus}`);
    }
    
    res.status(200).json({ message: 'Status callback processed' });
    
  } catch (error) {
    console.error('❌ Error processing Twilio status callback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /twilio/record-callback:
 *   post:
 *     tags: [Twilio]
 *     summary: Handle Twilio recording callbacks
 *     description: Receives recording completion notifications from Twilio
 */
router.post('/record-callback', async (req, res) => {
  try {
    const { CallSid, RecordingUrl, RecordingSid, RecordingDuration, From, To } = req.body;
    
    console.log(`🔵 Twilio recording callback:`);
    console.log(`   Call SID: ${CallSid}`);
    console.log(`   Recording SID: ${RecordingSid}`);
    console.log(`   Recording URL: ${RecordingUrl}`);
    console.log(`   Duration: ${RecordingDuration}`);
    
    if (!CallSid) {
      return res.status(400).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    
    // CRITICAL: Look up call record by Twilio CallSid to get our pre-generated UUID
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const activeCallsCollection = database.collection("activeCalls");
    
    const callRecord = await activeCallsCollection.findOne(
      { twilioCallSid: CallSid },
      { projection: { callUUID: 1, clientId: 1, campaignId: 1 } }
    );
    
    if (!callRecord) {
      console.error(`❌ No call record found for Twilio recording CallSid: ${CallSid}`);
      return res.status(404).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    
    const ourCallUUID = callRecord.callUUID; // Use our pre-generated UUID
    
    // Map recording data to Plivo format and update hangup record
    const { mapTwilioRecordingToPlivoFormat, createRecordingUrlUpdate } = require('../adapters/twilioToPlivoMapper.js');
    
    // Store recording data in the same collection as Plivo for consistency
    const recordCollection = database.collection("plivoRecordData");
    const hangupCollection = database.collection("plivoHangupData");
    
    // CRITICAL: Add duplicate prevention logic using our UUID (like Plivo saveRecordData())
    const existingRecord = await recordCollection.findOne({ CallUUID: ourCallUUID });
    if (existingRecord) {
      console.log(`⚠️ Twilio record with CallUUID ${ourCallUUID} already exists - skipping duplicate`);
      return res.status(409).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    
    // Transform Twilio recording data to Plivo format
    const recordData = mapTwilioRecordingToPlivoFormat(req.body, callRecord);
    
    // Save recording data
    await recordCollection.insertOne(recordData);
    
    // CRITICAL: Update hangup record with recording URL (like Plivo does)
    const recordingUpdateResult = await hangupCollection.updateOne(
      { CallUUID: ourCallUUID },
      createRecordingUrlUpdate(RecordingUrl, ourCallUUID)
    );
    
    console.log(`✅ Twilio recording data saved in Plivo format for call ${ourCallUUID} -> Twilio SID ${CallSid}`);
    console.log(`   Recording URL: ${RecordingUrl}`);
    console.log(`   Client ID: ${recordData.clientId}, Campaign: ${recordData.campId}`);
    console.log(`   Hangup record updated: ${recordingUpdateResult.modifiedCount > 0 ? '✅ Success' : '⚠️ Not found'}`);
    
    res.status(200).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    
  } catch (error) {
    console.error('❌ Error processing Twilio recording callback:', error);
    res.status(500).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

/**
 * @swagger
 * /twilio/record-status:
 *   post:
 *     tags: [Twilio]
 *     summary: Handle Twilio recording status callbacks
 *     description: Receives recording status updates from Twilio
 */
router.post('/record-status', async (req, res) => {
  try {
    const { RecordingSid, RecordingStatus, CallSid, RecordingDuration } = req.body;
    
    console.log(`🔵 Twilio recording status:`)
    console.log(`   Recording SID: ${RecordingSid}`);
    console.log(`   Status: ${RecordingStatus}`);
    console.log(`   Call SID: ${CallSid}`);
    console.log(`   Duration: ${RecordingDuration}`);
    
    // Log for debugging but don't need to store additional data
    // Recording callback already handles the main recording storage
    
    res.status(200).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    
  } catch (error) {
    console.error('❌ Error processing Twilio recording status:', error);
    res.status(500).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

/**
 * Test endpoint to check Twilio adapter
 */
router.get('/test-config', (req, res) => {
  try {
    const hasAccountSid = !!process.env.TWILIO_ACCOUNT_SID;
    const hasAuthToken = !!process.env.TWILIO_AUTH_TOKEN;
    
    res.json({
      success: true,
      twilio: {
        accountSidConfigured: hasAccountSid,
        authTokenConfigured: hasAuthToken,
        ready: hasAccountSid && hasAuthToken
      },
      supportedProviders: [
        { name: 'plivo', ready: true },
        { name: 'twilio', ready: hasAccountSid && hasAuthToken }
      ]
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error checking Twilio configuration'
    });
  }
});

module.exports = router;