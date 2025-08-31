const express = require('express');
const multer = require('multer');
const router = express.Router();
const fs = require('fs').promises;
const { 
  authenticateToken, 
  validateResourceOwnership, 
  auditLog 
} = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Exotel
 *   description: Exotel telephony integration for call handling and campaign management
 */

const {makeCallViaCampaign, scheduleCallViaCampaign, addIncomingCallData, createCustomer, fetchCustomerByClient,  getLogData, getLogDataByCallSid, getclientOverviewByCampId, mergeCampaignAndLogData, saveLogData, addBillingHistoryInMongo, getBillingHistoryByClientId, getSingleCampaignDetails, getContactsFromList, getObjectiveQualifiedLead, createCampaign, getAudioData,  processCsvFile, storeAudioDataNew,  getReportByCampaignId,  getCampaignByClientId, createList, getListByClientId, getCallBackAfterCall} = require('../apps/exotel/exotel')
const { sendWATITemplateMessage} = require('../apps/interLogue/fitness')
const activeCalls = require('../apps/helper/activeCalls')
const upload = multer({ dest: 'uploads/' });

// Helper function to safely delete files
const safeFileDelete = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted temporary file: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error deleting file ${filePath}:`, error);
  }
};

/**
 * @swagger
 * /exotel/schedule-call:
 *   post:
 *     tags: [Exotel]
 *     summary: Schedule a call via campaign
 *     description: Initiate a call using Exotel campaign system
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - name
 *               - clientId
 *               - callerNumber
 *               - incomingAppId
 *             properties:
 *               number:
 *                 type: string
 *                 example: "7061588225"
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               clientId:
 *                 type: string
 *                 example: "66cd8cc80b5a146186b9db8f"
 *               callerNumber:
 *                 type: string
 *                 example: "+918047495083"
 *               incomingAppId:
 *                 type: string
 *                 example: "app123"
 *     responses:
 *       200:
 *         description: Call scheduled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "call in progress"
 *       500:
 *         description: Internal server error
 */
router.post('/schedule-call', authenticateToken, validateResourceOwnership, auditLog, async(req,res) => {
    try{
        const number = req.body.number;
        const first_name = req.body.name;
        const clientId = req.body.clientId;
        const callerNumber = req.body.callerNumber;
        const appId = req.body.incomingAppId;
        // const number = '7061588225';
        // const first_name = 'Piyush';
        // const clientId = "66cd8cc80b5a146186b9db8f";

        const response  = await scheduleCallViaCampaign(number, first_name, clientId, callerNumber, appId);
        res.status(200).send({message: "call in progress"})
        // res.json(response)
    } catch(error){
        res.status(500).send({ message: "Internal Server Error" + error.message });
    }
    
})
router.post('/upload-csv', authenticateToken, validateResourceOwnership, auditLog, upload.single('file_name'), (req, res) => {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }
  
    // Choose either file path or buffer based on your requirement
    const filePath = req.file.path;
    const buffer = req.file.buffer;
    const file_name = req.body.list_name;
    const from_number = req.body.from_number;

    if (!file_name) {
      safeFileDelete(filePath); // Clean up file before returning error
      return res.status(400).send('List name is required.');
    }

    try {
      processCsvFile(filePath, buffer, file_name, from_number, (error, message) => {
        try {
          if (error) {
            res.status(500).send(error);
          } else {
            console.log(message);
            res.send(message);
          }
        } catch (responseError) {
          console.error('Error sending response:', responseError);
        } finally {
          // Always delete the temporary file, regardless of success or failure
          safeFileDelete(filePath);
        }
      });
    } catch (processingError) {
      console.error('Error processing CSV:', processingError);
      res.status(500).send('Error processing CSV file.');
      // Always delete the temporary file, regardless of success or failure
      safeFileDelete(filePath);
    }
  });
router.post('/campaign-call', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const listId = req.body.listId;
        const clientId = req.body.clientId;
        // const camp_id =  req.body.camp_id;
        const camp_name = req.body.camp_name;
        const balToken =req.body.balToken;
        const retries = req.body.retries;
        const appId = req.body.appId;
        const callerNumber = req.body.callerNumber;
        // const listId = ["32503f8785124f859b9889c3ea1af54c"];
        // const clientId = "123456";
        // const camp_id =  "345436543";
        // const camp_name = "ram camp";
        const result = await makeCallViaCampaign(listId, camp_name, clientId, balToken, retries, appId, callerNumber);
        res.status(200).send({message: "call in progress"})
    } catch (err) {
        res.status(500).send({ message: "Internal Server Error" + err.message });
    }
});
router.post('/create-campaign', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
    try{
    const clientId = req.body.clientId;
    const camp_name = req.body.camp_name;
    // const clientId = '123456';
    // const camp_name = 'campaign check';
    const result = await createCampaign(clientId, camp_name);
    res.status(200).send({ message: result.message, result });
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/get-camp-by-clientId', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const clientId = req.body.clientId;
        // const clientId = '123456';
        const result = await getCampaignByClientId(clientId);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

/**
 * @swagger
 * /exotel/get-contacts-from-list:
 *   post:
 *     tags: [Exotel]
 *     summary: Get contacts from a specific list
 *     description: Retrieve all contacts from an Exotel contact list by list SID
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - listSid
 *             properties:
 *               listSid:
 *                 type: string
 *                 description: Exotel list SID identifier
 *                 example: "937bd01052cf4a2f8616a9441bec5bfd"
 *     responses:
 *       200:
 *         description: Contacts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: "contact123"
 *                       name:
 *                         type: string
 *                         example: "John Doe"
 *                       number:
 *                         type: string
 *                         example: "+919876543210"
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "listSid is required"
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Access token required"
 *                 message:
 *                   type: string
 *                   example: "Please provide a valid authentication token"
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid token"
 *                 message:
 *                   type: string
 *                   example: "JWT token validation failed"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Internal Server Error"
 *                 error:
 *                   type: object
 */
router.post('/get-contacts-from-list', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const listSid = req.body.listSid;
        
        if (!listSid) {
            return res.status(400).json({ message: "listSid is required" });
        }
        
        const result = await getContactsFromList(listSid);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }
})

router.post('/create-list', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
    try{
    const listSid = req.body.listSid;
    const list_name = req.body.listName;
    const clientId = req.body.clientId
    const listSize = req.body.listSize
    const response = req.body.response
    // const clientId = '123456';
    // const camp_name = 'campaign check';
    const result = await createList(clientId, list_name, listSid, response, listSize);
    res.status(200).send({ message: result.message });
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/get-list-by-clientId', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const clientId = req.body.clientId;
        // const clientId = '123456';
        const result = await getListByClientId(clientId);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/get-billing-history-by-clientId', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const clientId = req.body.clientId;
        // const clientId = '123456';
        const result = await getBillingHistoryByClientId(clientId);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/get-call-report-by-campaign', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const campaignId = req.body.campaignId;
        const duration = 30;
        const clientId = req.body.clientId
        const prompt = req.body.prompt || '';
        const camp_name = req.body.camp_name || 'testing campaign';
        // const campaignId = '891e6a1383ef6ecc06d1b5165b2e6ff2189u';
        // const duration = 0;
        // const clientId = '66cd8cc80b5a146186b9db8f'
        // const prompt = {True: 'if the user accecpts ', False: 'if the user rejects or is not sure'};
        // const camp_name = 'testing campaign'
        const result = await getReportByCampaignId(campaignId, duration, clientId, prompt, camp_name);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error }); 
    }

})

router.post('/get-campaign-details', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const campaignId = req.body.campaignId;
        const result = await getSingleCampaignDetails(campaignId);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/get-client-overview', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const campaignId = req.body.campaignId;
        const clientId = req.body.clientId;
        const result = await getclientOverviewByCampId(campaignId, clientId);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

/**
 * @swagger
 * /exotel/get-incoming-call-details:
 *   post:
 *     tags: [Exotel]
 *     summary: Get incoming call details with campaign data
 *     description: Retrieve detailed information about incoming calls merged with campaign data
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Phone number to retrieve call details for
 *                 example: "+919876543210"
 *               sd:
 *                 type: number
 *                 description: Search depth parameter (optional, defaults to 0)
 *                 example: 0
 *                 default: 0
 *     responses:
 *       200:
 *         description: Incoming call details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 callDetails:
 *                   type: object
 *                   properties:
 *                     phoneNumber:
 *                       type: string
 *                       example: "+919876543210"
 *                     campaignData:
 *                       type: object
 *                       description: Associated campaign information
 *                     logData:
 *                       type: object
 *                       description: Call log information
 *                     duration:
 *                       type: number
 *                       example: 120
 *                     status:
 *                       type: string
 *                       example: "completed"
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "phoneNumber is required"
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Access token required"
 *                 message:
 *                   type: string
 *                   example: "Please provide a valid authentication token"
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid token"
 *                 message:
 *                   type: string
 *                   example: "JWT token validation failed"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Internal Server Error"
 *                 error:
 *                   type: object
 */
router.post('/get-incoming-call-details', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const phoneNumber = req.body.phoneNumber;
        const sd = req.body.sd || 0;
        
        if (!phoneNumber) {
            return res.status(400).json({ message: "phoneNumber is required" });
        }
        
        const result = await mergeCampaignAndLogData(phoneNumber, sd);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/get-objective-qualified-lead', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const campaignId = req.body.campaignId;
        const prompt = req.body.prompt;
        // const campaignId = '5c05cb26707c80fd03681f434a48cc8a188u';
        // const prompt = "I want the data where the user is interested in the AI's offerings";
        const result = await getObjectiveQualifiedLead(campaignId, prompt);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/call-back', async(req, res) => {
    try{
        const response = req.body;
        // const clientId = '123456';
        const result = await getCallBackAfterCall(response);
        res.json(result.status).send({message: result.message});
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})
router.post('/call-back-after-end', async(req, res) => {
    try{
        const response = req.body;
        // const clientId = '123456';
        const result = await getCallBackAfterEachCallEnd(response);
        res.json(result.status).send({message: result.message});
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.get('/incoming-applet-call-back', async (req, res) => {
    const queryParam = req.query;
    const callSid = req.query.CallSid;
    const ph_no = req.query.From;

    // Helper function to create a delay
    const waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        const result = await addIncomingCallData(queryParam);

        // Wait for 30 seconds (30000 milliseconds)
        await waitFor(10000);

        const logData = await getLogDataByCallSid(callSid);
        console.log(logData);

        if (logData && logData.structuredOutputData && logData.structuredOutputData.coldLead == 0) {
            console.log('message will be send')
            sendWATITemplateMessage(ph_no);
        }

        res.status(200).send({ message: "message will be sent, currently in processing" });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

/**
 * @swagger
 * /exotel/store-audio-data:
 *   post:
 *     tags: [Exotel]
 *     summary: Store audio data for agent training
 *     description: Store audio sentence data associated with an agent for voice training and recognition
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sentence
 *               - agent_id
 *               - audio_data
 *             properties:
 *               sentence:
 *                 type: string
 *                 description: Text transcription of the audio
 *                 example: "mai riya bol rhi hu, kya aapse 2 min baat kar sakti hu"
 *               agent_id:
 *                 type: string
 *                 description: Unique identifier for the agent
 *                 example: "354324"
 *               audio_data:
 *                 type: string
 *                 description: Audio data or reference for storage
 *                 example: "riya audio"
 *     responses:
 *       200:
 *         description: Audio data stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Audio data stored successfully"
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "sentence, agent_id, and audio_data are required"
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Access token required"
 *                 message:
 *                   type: string
 *                   example: "Please provide a valid authentication token"
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid token"
 *                 message:
 *                   type: string
 *                   example: "JWT token validation failed"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Internal Server Error"
 *                 error:
 *                   type: object
 */
router.post('/store-audio-data', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const sentence = req.body.sentence;
        const agent_id = req.body.agent_id;
        const audio_data = req.body.audio_data;
        
        if (!sentence || !agent_id || !audio_data) {
            return res.status(400).json({ message: "sentence, agent_id, and audio_data are required" });
        }
        
        const result = storeAudioDataNew(sentence, agent_id, audio_data);
        res.json(result.status).send({message: result.message});
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }
})

router.post('/get-best-match', async (req, res) => {
    try{
    const text = req.body.sentence;
    const agent_id = req.body.agent_id;
    // const text = "mai riya hu. aapse do min baat karni thi"
    // const agent_id =  "354324"
    if (!text) {
      return res.status(400).send('Text is required');
    }
  
    const bestMatchAudioData = await getAudioData(text, agent_id);
    if (!bestMatchAudioData) {
      return res.status(404).send('No matching audio data found');
    }
  
    res.json({ audioData: bestMatchAudioData });  
  } catch (error)
  {
    res.status(500).send({ message: "Internal Server Error", error });
  }
  });

router.post('/add-sa-billing', async(req, res) => {
    try{
        const clientId = req.body.clientId;
        const balance = req.body.balance;
        const transactionType = req.body.transactionType;
        const desc = req.body.desc;
        const newAvailableBalance = req.body.newAvailableBalance;
        const date = new Date();
        const camp_name = '';
        const campaignId = '';
        const result = await addBillingHistoryInMongo(camp_name, clientId, balance, date, campaignId, desc, transactionType, newAvailableBalance)
        res.status(result.status).send({message: result.message})
    } catch{
        res.status(500).send({ message:  'server error' });
    }
})

router.post('/save-log-data', async(req,res)=>{
    try{
       const data = req.body;
       console.log(`🚀 SAVE-LOG-DATA ENDPOINT HIT - CallUUID: ${data.callUUID || 'NOT FOUND'}`);
       
       const result = await saveLogData(data)
       
       // CRITICAL: Update hangup record with bot conversation data for proper merging  
       if (result.status === 200 && data.callUUID) {
         try {
           const { connectToMongo, client } = require('../../models/mongodb.js');
           await connectToMongo();
           const database = client.db("talkGlimpass");
           const hangupCollection = database.collection("plivoHangupData");
           
           // Get existing record to preserve RecordUrl
           const existingRecord = await hangupCollection.findOne({ CallUUID: data.callUUID });
           
           console.log(`🔍 DEBUG - Bot merge - Existing record RecordUrl:`, existingRecord?.RecordUrl);
           
           // Update hangup record with bot conversation data (preserve RecordUrl)
           const hangupUpdate = {
             $set: {
               messages: data.messages || [],
               conversation_time: data.conversation_time || null,
               call_sid: data.call_sid || "",
               stream_id: data.stream_id || "",
               caller_number: data.caller_number || "",
               ai_number: data.ai_number || "",
               agent_id: data.agent_id || "",
               lead_analysis: data.lead_analysis || null,
               summary: data.summary || null,
               chat: data.chat || null,
               structuredOutputData: data.structuredOutputData || null,
               caller: data.caller || "",
               exophone: data.exophone || "",
               // Mark that bot data has been merged
               botDataMerged: new Date(),
               // CRITICAL: Preserve existing RecordUrl if it exists
               ...(existingRecord?.RecordUrl && { RecordUrl: existingRecord.RecordUrl })
             }
           };
           
           console.log(`🔍 DEBUG - Bot merge update RecordUrl:`, hangupUpdate.$set.RecordUrl);
           
           const mergeResult = await hangupCollection.updateOne(
             { CallUUID: data.callUUID },
             hangupUpdate
           );
           
           if (mergeResult.modifiedCount > 0) {
             console.log(`✅ Bot conversation data merged with hangup record: ${data.callUUID}`);
             
             // Check final state after merge
             const finalRecord = await hangupCollection.findOne({ CallUUID: data.callUUID }, { RecordUrl: 1 });
             console.log(`🔍 DEBUG - Final record after bot merge RecordUrl:`, finalRecord?.RecordUrl);
           } else {
             console.warn(`⚠️ No hangup record found to merge bot data: ${data.callUUID}`);
           }
         } catch (mergeError) {
           console.error(`❌ Failed to merge bot data with hangup record:`, mergeError);
           // Don't fail the main request if merge fails
         }
       }
       
       // Update activeCalls status to 'completed' when bot data is received
       // Bot data only arrives after call has ended, so we can safely mark as completed
       let { callUUID } = data;
       if (callUUID) {
         try {
           const { connectToMongo, client } = require('../../models/mongodb.js');
           await connectToMongo();
           const database = client.db("talkGlimpass");
           const activeCallsCollection = database.collection("activeCalls");
           
           // CRITICAL: Handle Twilio CallSids - look up by twilioCallSid first
           let currentCall = await activeCallsCollection.findOne({ callUUID: callUUID });
           
           // If not found by callUUID, try looking up by twilioCallSid (for Twilio calls)
           if (!currentCall && callUUID.startsWith('CA')) {
             console.log(`🔍 Twilio CallSid detected: ${callUUID}, looking up by twilioCallSid...`);
             currentCall = await activeCallsCollection.findOne({ twilioCallSid: callUUID });
             
             if (currentCall) {
               // Update data.callUUID to use our internal UUID for saveLogData
               console.log(`✅ Found Twilio call: ${callUUID} -> ${currentCall.callUUID}`);
               data.callUUID = currentCall.callUUID; // Replace Twilio CallSid with our UUID
               callUUID = currentCall.callUUID; // Update local variable too
             }
           }
           
           console.log(`🔍 DEBUG: Bot data received for CallUUID ${callUUID}`);
           console.log(`🔍 DEBUG: Current call status: ${currentCall?.status || 'NOT FOUND'}`);
           
           // Update call to completed status (bot analytics received means call is definitely done)
           const updateResult = await activeCallsCollection.updateOne(
             { callUUID: callUUID },
             { 
               $set: { 
                 status: 'completed',  // Final state: bot analytics received
                 statusTimestamp: new Date(), // Track when status was set for lazy cleanup
                 botDataReceived: new Date(),
                 updatedAt: new Date()
               } 
             }
           );
           
           if (updateResult.matchedCount > 0) {
             console.log(`✅ Call marked as completed: ${callUUID}`);
           } else {
             console.log(`⚠️ CallUUID not found in activeCalls: ${callUUID}`);
           }
         } catch (updateError) {
           console.error(`❌ Failed to update call status: ${updateError.message}`);
           // Don't fail the main request if status update fails
         }
       }
       
       res.status(result.status).send({message: result.message})
    } catch(error){
        res.status(500).send({ message:  error });
    }
})



/**
 * @swagger
 * /exotel/get-log-data:
 *   post:
 *     tags: [Exotel]
 *     summary: Get call log data between phone numbers
 *     description: Retrieve call log data between two phone numbers for analysis and reporting
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *             properties:
 *               from:
 *                 type: string
 *                 description: Source phone number
 *                 example: "07061588225"
 *               to:
 *                 type: string
 *                 description: Destination phone number
 *                 example: "07314626886"
 *     responses:
 *       200:
 *         description: Log data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       callSid:
 *                         type: string
 *                         example: "CA123456789"
 *                       from:
 *                         type: string
 *                         example: "07061588225"
 *                       to:
 *                         type: string
 *                         example: "07314626886"
 *                       duration:
 *                         type: number
 *                         example: 180
 *                       status:
 *                         type: string
 *                         example: "completed"
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                         example: "2023-10-01T10:30:00Z"
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "from and to phone numbers are required"
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Access token required"
 *                 message:
 *                   type: string
 *                   example: "Please provide a valid authentication token"
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid token"
 *                 message:
 *                   type: string
 *                   example: "JWT token validation failed"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Internal Server Error"
 *                 error:
 *                   type: object
 */
router.post('/get-log-data', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
    try{
        const from = req.body.from;
        const to = req.body.to;
        
        if (!from || !to) {
            return res.status(400).json({ message: "from and to phone numbers are required" });
        }
        
        const result = await getLogData(from, to)
        res.json(result)
    } catch(error){
        res.status(500).send({ message:  error });
    }
})


router.post('/add-customer', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
    try{
    const data = req.body;
    const result = await createCustomer(data);
    res.status(200).send({ message: result.message, result });
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }

})

router.post('/get-customer-by-client', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
    try{
        const clientId = req.body.clientId;
        const result = await fetchCustomerByClient(clientId);
        res.json(result);
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }
})


module.exports = router;
