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
    
    // Generate TwiML response
    const twiml = TwilioAdapter.generateTwiML({
      wssUrl: wss,
      callSid: CallSid,
      clientId: clientId,
      campaignId: campId
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
      statusTimestamp: new Date()
    };
    
    // Add duration and end time for completed calls
    if (CallStatus === 'completed' && Duration) {
      updateData.duration = parseInt(Duration);
      updateData.endTime = new Date();
    }
    
    const result = await activeCallsCollection.updateOne(
      { callUUID: CallSid, provider: 'twilio' },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      console.warn(`⚠️ No call record found for Twilio CallSid: ${CallSid}`);
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
    const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
    
    console.log(`🔵 Twilio recording callback:`);
    console.log(`   Call SID: ${CallSid}`);
    console.log(`   Recording SID: ${RecordingSid}`);
    console.log(`   Recording URL: ${RecordingUrl}`);
    console.log(`   Duration: ${RecordingDuration}`);
    
    // Store recording data (similar to Plivo callback-record-url)
    // You can extend this to save recording info to database
    
    res.status(200).json({ message: 'Recording callback processed' });
    
  } catch (error) {
    console.error('❌ Error processing Twilio recording callback:', error);
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