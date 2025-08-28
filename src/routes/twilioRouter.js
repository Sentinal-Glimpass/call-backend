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
    const { wss, clientId, campId, listId, firstName, tag } = req.query;
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
    
    // Generate TwiML response with all available data (matching Plivo extraHeaders)
    const twiml = TwilioAdapter.generateTwiML({
      wssUrl: wss,
      callSid: CallSid,
      clientId: clientId,
      campaignId: campId,
      listId: listId,
      firstName: firstName,
      from: From,
      to: To,
      tag: tag
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
      
      // Also save hangup data for consistency with Plivo system
      try {
        const hangupCollection = database.collection("plivoHangupData");
        const { CallDuration, SipResponseCode } = req.body;
        
        // Get clientId and campaignId from activeCalls record
        const callRecord = await activeCallsCollection.findOne(
          { callUUID: CallSid },
          { projection: { clientId: 1, campaignId: 1 } }
        );
        
        const hangupData = {
          CallUUID: CallSid,
          From: From,
          To: To,
          CallStatus: 'completed', // Map to Plivo format
          Duration: Duration ? parseInt(Duration) : 0,
          BillDuration: CallDuration ? parseInt(CallDuration) : 0,
          HangupCause: SipResponseCode === '200' ? 'NORMAL_CLEARING' : 'CALL_REJECTED',
          HangupCauseCode: SipResponseCode || '200',
          Provider: 'twilio',
          Event: 'Hangup',
          EndTime: new Date().toISOString().replace('T', ' ').substring(0, 19),
          createdAt: new Date(),
          // Add missing fields from call record for proper reporting
          clientId: callRecord?.clientId?.toString() || null,
          campId: callRecord?.campaignId === 'testcall' ? 'testcall' : (callRecord?.campaignId?.toString() || 'incoming')
        };
        
        await hangupCollection.insertOne(hangupData);
        console.log(`✅ Twilio hangup data saved for call ${CallSid} (clientId: ${hangupData.clientId}, campId: ${hangupData.campId})`);
      } catch (hangupError) {
        console.error('❌ Error saving Twilio hangup data:', hangupError);
      }
      
      // CRITICAL: Add missing billing operations that Plivo hangup handler does
      if (callRecord?.clientId) {
        try {
          console.log(`💰 Processing Twilio billing for call: ${CallSid}, Type: ${hangupData.campId}, Duration: ${Duration}s`);
          
          const { 
            saveCallBillingDetail, 
            updateClientBalance: updateClientBalanceNew
          } = require('../apps/billing/billingCore');
          const { getClientByClientId } = require('../apps/interLogue/client');
          const billingRouter = require('./billingRouter');
          
          // Determine call type
          let callType;
          if (hangupData.campId === 'incoming') {
            callType = 'incoming';
          } else if (hangupData.campId === 'testcall') {
            callType = 'testcall';
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
          
          const duration = parseInt(Duration) || 0;
          const creditsToDeduct = duration; // 1 second = 1 credit
          const currentBalance = existingClient.availableBalance || 0;
          const newBalance = currentBalance - creditsToDeduct;
          
          console.log(`💰 Twilio Billing: ${callType} call - ${creditsToDeduct} credits (duration: ${duration}s)`);
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
          
          // BILLING HISTORY: Only for non-campaign calls
          if (callType !== 'campaign') {
            const billingHistoryCollection = database.collection("billingHistory");
            
            let billingDescription, campName;
            if (callType === 'testcall') {
              billingDescription = `Test call to ${To} for ${duration} seconds`;
              campName = 'Test Call';
            } else {
              billingDescription = `Incoming call from ${From} for ${duration} seconds`;
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
              callDuration: duration,
              callType: callType,
              from: From,
              to: To
            };
            
            await billingHistoryCollection.insertOne(billingEntry);
            console.log(`✅ Twilio billingHistory entry created for ${callType}`);
          } else {
            console.log(`📋 Twilio campaign call - balance updated but billing history deferred until campaign completion`);
          }
          
          // Save detailed call record
          await saveCallBillingDetail({
            clientId: clientId,
            callUuid: CallSid,
            duration: duration,
            type: callType,
            from: From,
            to: To,
            credits: creditsToDeduct,
            aiCredits: 0,
            telephonyCredits: creditsToDeduct,
            campaignId: callType === 'campaign' ? hangupData.campId : null,
            campaignName: callType === 'campaign' ? `Campaign ${hangupData.campId}` : null
          });
          
          console.log(`✅ Twilio call billing processed: ${creditsToDeduct} credits deducted, balance updated to ${newBalance} (Call Type: ${callType})`);
          
        } catch (billingError) {
          console.error(`❌ Twilio billing failed:`, billingError);
          // Don't fail the entire hangup process if billing fails
        }
      }
      
      // Track call end in database system
      const { trackCallEnd } = require('../apps/helper/activeCalls.js');
      const endResult = await trackCallEnd(CallSid, {
        duration: parseInt(Duration) || null,
        endReason: 'completed'
      });
      
      if (!endResult.success) {
        console.warn(`⚠️ Failed to track Twilio call end: ${endResult.error}`);
      } else {
        console.log(`✅ Twilio call end tracked: ${CallSid} (Active calls: ${endResult.activeCallsCount || 'unknown'})`);
      }
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
      return res.status(400).json({ error: 'Missing CallSid' });
    }
    
    // Store recording data in the same collection as Plivo for consistency
    await connectToMongo();
    const database = client.db("talkGlimpass");
    const recordCollection = database.collection("plivoRecordData"); // Use exact same collection as Plivo
    
    // CRITICAL: Add duplicate prevention logic that Plivo saveRecordData() has
    const existingRecord = await recordCollection.findOne({ CallUUID: CallSid });
    if (existingRecord) {
      console.log(`⚠️ Twilio record with CallUUID ${CallSid} already exists - skipping duplicate`);
      return res.status(409).json({ message: "Record with this CallUUID already exists." });
    }
    
    const recordData = {
      CallUUID: CallSid,  // Use same field name as Plivo
      From: From,
      To: To,
      RecordingUrl: RecordingUrl,
      RecordingSid: RecordingSid,
      RecordingDuration: RecordingDuration ? parseInt(RecordingDuration) : 0,
      Provider: 'twilio', // Mark as Twilio record
      Event: 'Recording', // Same as Plivo format
      RecordingCreatedAt: new Date(),
      createdAt: new Date()
    };
    
    await recordCollection.insertOne(recordData);
    console.log(`✅ Twilio recording data saved for call ${CallSid}`);
    
    res.status(200).json({ message: 'Recording callback processed' });
    
  } catch (error) {
    console.error('❌ Error processing Twilio recording callback:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    
    res.status(200).json({ message: 'Recording status processed' });
    
  } catch (error) {
    console.error('❌ Error processing Twilio recording status:', error);
    res.status(500).json({ error: 'Internal server error' });
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