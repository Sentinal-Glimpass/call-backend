// Required dependencies
const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const router = express.Router();
// Configure multer with size and timeout limits
const upload = multer({ 
  dest: 'list-uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1 // Only allow 1 file
  },
  fileFilter: (req, file, cb) => {
    // Allow CSV files with flexible MIME type checking
    const allowedMimeTypes = [
      'text/csv',
      'application/csv',
      'text/plain',
      'application/vnd.ms-excel',
      'text/x-csv',
      'application/x-csv'
    ];
    
    const isValidExtension = file.originalname.toLowerCase().endsWith('.csv');
    const isValidMimeType = allowedMimeTypes.includes(file.mimetype);
    
    if (isValidExtension || isValidMimeType) {
      console.log(`✅ File accepted: ${file.originalname} (${file.mimetype})`);
      cb(null, true);
    } else {
      console.log(`❌ File rejected: ${file.originalname} (${file.mimetype})`);
      cb(new Error(`Only CSV files are allowed. Received: ${file.mimetype}`), false);
    }
  }
});
const activeCalls = require('../apps/helper/activeCalls')
const apiKeyValidator = require('../middleware/apiKeyValidator')
const { 
  authenticateToken, 
  validateResourceOwnership, 
  auditLog 
} = require('../middleware/authMiddleware');
const { 
  createValidationMiddleware, 
  commonSchemas 
} = require('../middleware/validationMiddleware');

/**
 * @swagger
 * tags:
 *   name: Plivo
 *   description: Plivo SMS/voice operations and campaign management
 */
const{ retryCampaign, getIncomingBilling,  updateIncomingClientBalance, getCampaignStatus, getContactsFromList, insertList, getIncomingReport, getContactfromListId, saveHangupData, insertListContent, updateList, getListByClientId, initiatePlivoCall, makeCallViaCampaign, getCampaignByClientId, saveRecordData, getReportByCampId, deleteList, cancelCampaign, pauseCampaign, resumeCampaign, getCampaignProgress, getTestCallReport, validateClientBalance, getCurrentClientBalance, getCampaignAnalytics, getClientAnalytics} = require('../apps/plivo/plivo');

// Validation schemas for Plivo endpoints
const validationSchemas = {
  csvUpload: createValidationMiddleware({
    body: {
      listName: {
        required: true,
        validate: 'isValidAlphanumeric',
        sanitize: 'sanitizeString',
        minLength: 1,
        maxLength: 100
      },
      clientId: {
        required: false,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      }
    }
  }),
  
  campaignCreate: createValidationMiddleware({
    body: {
      campaignName: {
        required: true,
        validate: 'isValidAlphanumeric',
        sanitize: 'sanitizeString',
        minLength: 1,
        maxLength: 100
      },
      listId: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      },
      wssUrl: {
        required: true,
        validate: (value) => {
          try {
            const url = new URL(value);
            return url.protocol === 'wss:' || url.protocol === 'ws:' || 'URL must use ws:// or wss:// protocol';
          } catch {
            return 'Invalid WebSocket URL format';
          }
        },
        sanitize: 'sanitizeString'
      },
      fromNumber: {
        required: true,
        validate: 'isValidPhone',
        sanitize: 'sanitizePhone'
      },
      clientId: {
        required: false, // Optional since it can come from JWT token
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      }
    }
  }),
  
  phoneValidation: createValidationMiddleware({
    body: {
      number: {
        required: true,
        validate: 'isValidPhone',
        sanitize: 'sanitizePhone'
      }
    }
  }),
  
  singleCallValidation: createValidationMiddleware({
    body: {
      from: {
        required: true,
        validate: 'isValidPhone',
        sanitize: 'sanitizePhone'
      },
      to: {
        required: true,
        validate: 'isValidPhone', 
        sanitize: 'sanitizePhone'
      },
      wssUrl: {
        required: true,
        validate: (value) => {
          try {
            const url = new URL(value);
            return url.protocol === 'wss:' || url.protocol === 'ws:' || 'URL must use ws:// or wss:// protocol';
          } catch {
            return 'Invalid WebSocket URL format';
          }
        },
        sanitize: 'sanitizeString'
      },
      clientId: {
        required: false,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      },
      assistantId: {
        required: false,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      },
      customPrompt: {
        required: false,
        validate: 'isValidString',
        sanitize: 'sanitizeString',
        maxLength: 1000
      }
    }
  }),
  
  mongoIdParam: createValidationMiddleware({
    params: {
      id: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      }
    }
  }),
  
  reportQuery: createValidationMiddleware({
    body: {
      campaignId: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      }
    }
  }),
  
  campaignControl: createValidationMiddleware({
    body: {
      campaignId: {
        required: true,
        validate: 'isValidMongoId',
        sanitize: 'sanitizeString'
      }
    }
  })
};


/**
 * @swagger
 * /plivo/upload-csv:
 *   post:
 *     tags: [Plivo]
 *     summary: Upload CSV file for contact list
 *     description: Upload a CSV file to create a contact list for Plivo campaigns
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - listName
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV file containing contacts
 *               listName:
 *                 type: string
 *                 example: "Marketing Campaign List"
 *               clientId:
 *                 type: string
 *                 description: Optional - will use authenticated user's clientId if not provided
 *                 example: "66cd8cc80b5a146186b9db8f"
 *     responses:
 *       200:
 *         description: CSV uploaded and processed successfully
 *       400:
 *         description: Bad request - missing required fields
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
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

// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          message: 'File too large',
          details: 'File size must be less than 5MB'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          message: 'Too many files',
          details: 'Only one file is allowed'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          message: 'Unexpected field name',
          details: 'File field must be named "file"'
        });
      default:
        return res.status(400).json({
          message: 'File upload error',
          details: err.message
        });
    }
  } else if (err) {
    // Custom file filter error
    return res.status(400).json({
      message: 'File validation failed',
      details: err.message
    });
  }
  next();
};

// Route to upload CSV
router.post('/upload-csv', authenticateToken, validateResourceOwnership, upload.single('file'), handleMulterError, validationSchemas.csvUpload, auditLog, async (req, res) => {
  // Detailed file upload validation
  console.log('File upload debug:', {
    hasFile: !!req.file,
    fileKeys: req.file ? Object.keys(req.file) : [],
    bodyKeys: Object.keys(req.body || {}),
    bodyValues: req.body,
    headers: req.headers['content-type'],
    listNameValue: req.body.listName,
    clientIdValue: req.body.clientId
  });

  if (!req.file || !req.file.path) {
    return res.status(400).json({ 
      message: 'No file uploaded or file validation failed',
      details: 'Please ensure you upload a valid CSV file under 5MB. Make sure the form field name is "file".',
      debug: {
        hasFile: !!req.file,
        contentType: req.headers['content-type'],
        fieldName: 'Expected field name: "file"'
      }
    });
  }

  const filePath = req.file.path;
  const listName = req.body.listName;
  const clientId = req.body.clientId || req.user.clientId;

  if (!listName) {
    safeFileDelete(filePath); // Clean up file before returning error
    return res.status(400).json({ message: 'List name is required' });
  }

  let listId = null;

  try {
    // Save the list name and generate a list ID
    const listResult = await insertList(listName, clientId);
    
    // Check if list creation was successful
    if (listResult.status !== 200) {
      throw new Error(listResult.message || 'Error saving list to database');
    }
    
    listId = listResult.listId;
    console.log('List created successfully with ID:', listId);

    const rows = [];
    
    // Process CSV file with proper cleanup
    const processCSV = () => {
      return new Promise((resolve, reject) => {
        let validationFailed = false;

        fs.createReadStream(filePath)
          .pipe(csvParser())
          .on('data', (data) => {
            if (validationFailed) return;
            
            const number = data.number?.trim();
            
            if (!number) {
              validationFailed = true;
              reject(new Error('Missing phone number in CSV'));
              return;
            }

            // Simple validation - just check that number starts with "+"
            if (number.startsWith("+")) {
              data.number = number;
              data.listId = listId;
              rows.push(data);
            } else {
              validationFailed = true;
              reject(new Error(`Invalid mobile number format ${number}. Numbers must start with "+".`));
            }
          })
          .on('end', () => {
            if (!validationFailed) {
              resolve(rows);
            }
          })
          .on('error', (error) => {
            reject(error);
          });
      });
    };

    // Process the CSV file
    await processCSV();
    
    // Update list count and save data
    const count = rows.length;
    await updateList(listId, count);
    const result = await insertListContent(rows);

    res.status(result.status).json({
      message: result.message
    });

  } catch (error) {
    console.error('CSV upload error:', error);
    
    // Clean up database list if it was created
    if (listId) {
      try {
        await deleteList(listId);
      } catch (deleteError) {
        console.error('Error cleaning up list:', deleteError);
      }
    }

    res.status(500).json({
      message: error.message || 'Error processing CSV file'
    });

  } finally {
    // Always delete the temporary file, regardless of success or failure
    safeFileDelete(filePath);
  }
});

router.post('/get-list-by-clientId', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
    try{
        const clientId = req.body.clientId
        const result = await getListByClientId(clientId);
        res.status(result.status).send( result.data );
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }
})

/**
 * @swagger
 * /plivo/get-list-contact:
 *   post:
 *     tags: [Plivo]
 *     summary: Get all contacts from a specific contact list
 *     description: Retrieves all contacts that belong to a specific contact list
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - listId
 *             properties:
 *               listId:
 *                 type: string
 *                 description: The ID of the contact list to retrieve contacts from
 *                 example: "67a867f04b78b023e2197fd1"
 *     responses:
 *       200:
 *         description: List contacts fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   number:
 *                     type: string
 *                     example: "+919876543210"
 *                   name:
 *                     type: string
 *                     example: "John Doe"
 *                   listId:
 *                     type: string
 *                     example: "67a867f04b78b023e2197fd1"
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-list-contact', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
  try{
    const listId = req.body.listId
    // const listId = "67a867f04b78b023e2197fd1"
    const result = await getContactfromListId(listId)
    res.status(result.status).send(result.data)
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }
})
router.post('/single-call', authenticateToken, validateResourceOwnership, validationSchemas.singleCallValidation, auditLog, async(req, res) =>{
    try{
        const { from, to, wssUrl, clientId, assistantId, customPrompt, provider } = req.body;
        
        // Validate client balance before making test call - simple <= 0 check
        const balanceCheck = await getCurrentClientBalance(clientId);
        
        if (!balanceCheck.success) {
            console.log(`❌ Test call blocked: ${balanceCheck.error}`);
            return res.status(400).json({
                success: false,
                message: balanceCheck.error,
                callType: 'test_call'
            });
        }
        
        if (balanceCheck.balance <= 0) {
            console.log(`❌ Test call blocked: Insufficient balance (${balanceCheck.balance} credits)`);
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance: Balance must be positive to make test call',
                balance: balanceCheck.balance,
                callType: 'test_call'
            });
        }
        
        console.log(`✅ Balance validation passed for test call: ${balanceCheck.balance} credits available`);
        
        // Get provider and credentials info for logging
        const PhoneProviderService = require('../services/phoneProviderService');
        const TelephonyCredentialsService = require('../services/telephonyCredentialsService');
        
        try {
            // Determine provider - either explicitly provided or from phone number mapping
            let providerInfo;
            if (provider) {
                console.log(`🎯 Using explicitly specified provider: ${provider}`);
                providerInfo = { provider: provider.toLowerCase(), phoneNumber: from, isExplicit: true };
            } else {
                console.log(`🔍 Determining provider based on phone number mapping...`);
                providerInfo = await PhoneProviderService.getProvider(from);
            }
            
            let credentialsInfo;
            
            if (clientId) {
                credentialsInfo = await TelephonyCredentialsService.getCredentials(clientId, providerInfo.provider);
            } else {
                credentialsInfo = TelephonyCredentialsService.getSystemDefaultCredentials(providerInfo.provider, 'unknown');
            }
            
            // Comprehensive logging for single call
            console.log(`📞 SINGLE CALL ROUTING DETAILS:`);
            console.log(`   📱 From: ${from} → To: ${to}`);
            console.log(`   👤 Client ID: ${clientId}`);
            console.log(`   🏢 Provider: ${providerInfo.provider.toUpperCase()} ${provider ? '(EXPLICIT)' : '(PHONE MAPPING)'}`);
            console.log(`   🔑 Credentials: ${credentialsInfo.isClientSpecific ? 'CLIENT-SPECIFIC' : 'SYSTEM DEFAULT'}`);
            console.log(`   🆔 Account SID: ${TelephonyCredentialsService.maskCredential(credentialsInfo.accountSid)}`);
            console.log(`   📋 Call Type: SINGLE TEST CALL`);
            console.log(`   🎯 Assistant ID: ${assistantId || 'N/A'}`);
            
        } catch (providerError) {
            console.warn(`⚠️ Could not determine provider info: ${providerError.message}`);
        }
        
        // Use processSingleCall to get proper tracking, concurrency, and billing (like campaigns do)
        const { processSingleCall } = require('../apps/helper/activeCalls.js');
         
        const callParams = {
            clientId,
            campaignId: 'testcall',
            from,
            to,
            wssUrl,
            firstName: customPrompt || '',
            tag: assistantId,
            listId: 'testcall',
            provider: provider, // Pass the provider parameter 
            // Additional params for proper tracking
            contactIndex: 0,
            sequenceNumber: 1,
            contactData: { first_name: customPrompt || '', number: to }
        };
        
        console.log('🚀 Initiating single call via processSingleCall (with tracking)...');
        const result = await processSingleCall(callParams);
        
        if (result.success) {
            console.log(`✅ Single call initiated successfully via ${result.provider.toUpperCase()}: ${result.callUUID}`);
            
            // Return the EXACT same format as original initiatePlivoCall for frontend compatibility
            res.status(200).send({
                api_id: result.callUUID, // Map callUUID to api_id for compatibility
                message: 'Call initiated successfully.',
                request_uuid: result.callUUID
            });
        } else {
            console.error(`❌ Single call failed: ${result.error}`);
            // Return error in same format as original
            res.status(500).send({ message: result.error });
        } 
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }
})

router.post('/create-campaign', authenticateToken, validateResourceOwnership, validationSchemas.campaignCreate, auditLog, async(req, res) =>{
  try{
    const listId = req.body.listId
    const fromNumber = req.body.fromNumber
    const wssUrl = req.body.wssUrl
    const campaignName = req.body.campaignName
    const clientId = req.body.clientId
    const provider = req.body.provider

    if (!listId || !fromNumber || !wssUrl || !campaignName || !clientId) {
      return res.status(400).json({ 
          status: 400, 
          message: "Please provide all required values: listId, fromNumber, wssUrl, campaignName, clientId." 
      });
    }
    
    // Get provider and credentials info for logging
    const PhoneProviderService = require('../services/phoneProviderService');
    const TelephonyCredentialsService = require('../services/telephonyCredentialsService');
    
    // Declare variables outside try-catch to avoid reference errors
    let providerInfo = null;
    let credentialsInfo = null;
    
    try {
        // Determine provider - either explicitly provided or from phone number mapping
        if (provider) {
            console.log(`🎯 Using explicitly specified provider: ${provider}`);
            providerInfo = { provider: provider.toLowerCase(), phoneNumber: fromNumber, isExplicit: true };
        } else {
            console.log(`🔍 Determining provider based on phone number mapping...`);
            providerInfo = await PhoneProviderService.getProvider(fromNumber);
        }
        
        if (clientId) {
            credentialsInfo = await TelephonyCredentialsService.getCredentials(clientId, providerInfo.provider);
        } else {
            credentialsInfo = TelephonyCredentialsService.getSystemDefaultCredentials(providerInfo.provider, 'unknown');
        }
        
        // Comprehensive logging for campaign creation
        console.log(`🚀 CAMPAIGN CREATION ROUTING DETAILS:`);
        console.log(`   📊 Campaign Name: ${campaignName}`);
        console.log(`   📱 From Number: ${fromNumber}`);
        console.log(`   👤 Client ID: ${clientId}`);
        console.log(`   📋 List ID: ${listId}`);
        console.log(`   🏢 Provider: ${providerInfo.provider.toUpperCase()} ${provider ? '(EXPLICIT)' : '(PHONE MAPPING)'}`);
        console.log(`   🔑 Credentials: ${credentialsInfo.isClientSpecific ? 'CLIENT-SPECIFIC' : 'SYSTEM DEFAULT'}`);
        console.log(`   🆔 Account SID: ${TelephonyCredentialsService.maskCredential(credentialsInfo.accountSid)}`);
        console.log(`   📋 Call Type: BULK CAMPAIGN`);
        console.log(`   🌐 WebSocket URL: ${wssUrl}`);
        
    } catch (providerError) {
        console.warn(`⚠️ Could not determine provider info for campaign: ${providerError.message}`);
    }
    
    console.log('🚀 Starting campaign via enhanced system...');
    const result = await makeCallViaCampaign(listId, fromNumber, wssUrl, campaignName, clientId, provider)
    let status = result.status || 200
    let message = result.message || "call scheduled"
    
    if (result.status === 200) {
        console.log(`✅ Campaign created successfully: ${campaignName} (ID: ${result.campaignId || 'N/A'})`);
        console.log(`   📊 Campaign will use provider: ${providerInfo?.provider?.toUpperCase() || 'Auto-detected'}`);
        console.log(`   🔑 Credentials: ${credentialsInfo?.isClientSpecific ? 'CLIENT-SPECIFIC' : 'SYSTEM DEFAULT'}`);
        console.log(`   📱 From Number: ${fromNumber}`);
        console.log(`   📋 List ID: ${listId}`);
    } else {
        console.error(`❌ Campaign creation failed: ${message}`);
    }
    
    res.status(status).send({message: message})
  } catch(error){
    console.error('❌ Campaign creation error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error message:', error.message);
    res.status(500).send({ 
      message: "Internal Server Error", 
      error: error.message || error.toString(),
      details: error.stack 
    });
  }
})

/**
 * @swagger
 * /plivo/get-contact-by-list:
 *   post:
 *     tags: [Plivo]
 *     summary: Find specific contact by phone number within a list
 *     description: Search for a specific phone number within a contact list and return matching contacts
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - listId
 *             properties:
 *               number:
 *                 type: string
 *                 description: Phone number to search for (matches last 10 digits)
 *                 example: "8264281590"
 *               listId:
 *                 type: string
 *                 description: The ID of the contact list to search within
 *                 example: "67dd026b54866db7bc1f4c1d"
 *     responses:
 *       200:
 *         description: Matching contacts found successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   number:
 *                     type: string
 *                     example: "+918264281590"
 *                   name:
 *                     type: string
 *                     example: "John Doe"
 *                   listId:
 *                     type: string
 *                     example: "67dd026b54866db7bc1f4c1d"
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-contact-by-list', authenticateToken, validateResourceOwnership, validationSchemas.phoneValidation, auditLog, async(req, res) =>{
  try{
    const number = req.body.number
    const listId = req.body.listId
    // const number = "8264281590"
    // const listId = "67dd026b54866db7bc1f4c1d"
    const result = await getContactsFromList(number, listId)
    res.status(result.status).send( result.data ); 
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }
})

/**
 * @swagger
 * /plivo/get-active-channels:
 *   get:
 *     tags: [Plivo]
 *     summary: Get active call channels information
 *     description: Retrieve information about currently active call channels
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Active channels information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activeCalls:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: number
 *                       example: 2
 *                     MAX_CALLS:
 *                       type: number
 *                       example: 5
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.get('/get-active-channels', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
  try{
    const { getConcurrencyStats } = require('../apps/helper/activeCalls');
    const clientId = req.query.clientId; // Optional client filter
    const includeCalls = req.query.includeCalls === 'true';
    
    // Get concurrency statistics
    const stats = await getConcurrencyStats(clientId);
    
    const response = {
      timestamp: new Date().toISOString(),
      stats,
      // Legacy compatibility
      activeCalls: {
        count: stats.global.active,
        MAX_CALLS: stats.global.max
      }
    };
    
    // Include detailed call list if requested
    if (includeCalls) {
      const { connectToMongo, client } = require('../../models/mongodb.js');
      await connectToMongo();
      
      const database = client.db("talkGlimpass");
      const activeCallsCollection = database.collection("activeCalls");
      
      const query = { status: { $in: ['processed', 'ringing', 'ongoing'] } };
      if (clientId) {
        query.clientId = new (require('mongodb')).ObjectId(clientId);
      }
      
      const activeCalls = await activeCallsCollection
        .find(query)
        .sort({ startTime: -1 })
        .limit(100) // Limit to prevent large responses
        .toArray();
        
      response.activeCalls.calls = activeCalls;
    }
    
    res.status(200).json(response);   
  } catch (error){
    console.error('❌ Error getting active channels:', error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });  
  }
})

router.post('/get-campaign-by-client', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try{
    const clientId = req.body.clientId
    const result = await getCampaignByClientId(clientId)
    res.status(result.status).send( result.data );
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }
})

router.post('/retry-campaign', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try{
    const campId = req.body.campaignId;
    //const campId = "67ee66a3fe00d34aba085864"
    const result = await retryCampaign(campId)
    res.status(result.status).send( result.data);
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }
})

/**
 * @swagger
 * /plivo/get-report-by-campaign:
 *   post:
 *     tags: [Plivo]
 *     summary: Get campaign report with cursor-based pagination
 *     description: Retrieve campaign report including completed calls and campaign status with pagination support. Returns partial results even for ongoing campaigns. Use cursor-based pagination for large datasets.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campaignId
 *             properties:
 *               campaignId:
 *                 type: string
 *                 description: The ID of the campaign to get report for
 *                 example: "67fca247fe00d34aba08702e"
 *               cursor:
 *                 type: string
 *                 description: Cursor for pagination (ObjectId from previous page's last record). Omit for first page.
 *                 example: "64a1b2c3d4e5f6789abc0123"
 *               limit:
 *                 type: number
 *                 description: Number of records per page (default 100, max 1000)
 *                 example: 100
 *                 minimum: 1
 *                 maximum: 1000
 *               isDownload:
 *                 type: boolean
 *                 description: Set to true to download all records (ignores pagination)
 *                 example: false
 *               filters:
 *                 type: object
 *                 description: Optional filters to apply to the data (supports multiple custom filters)
 *                 properties:
 *                   duration:
 *                     type: object
 *                     description: Filter by call duration (Duration field converted to integer)
 *                     properties:
 *                       min:
 *                         type: number
 *                         description: Minimum call duration in seconds
 *                         example: 30
 *                       max:
 *                         type: number
 *                         description: Maximum call duration in seconds
 *                         example: 300
 *                       equals:
 *                         type: number
 *                         description: Exact call duration in seconds
 *                         example: 60
 *                   customFilters:
 *                     type: array
 *                     description: Array of custom field filters (supports multiple filters)
 *                     items:
 *                       type: object
 *                       properties:
 *                         field:
 *                           type: string
 *                           description: Field name to filter on (supports nested fields with underscore notation)
 *                           example: "leadAnalysis_is_lead"
 *                         value:
 *                           type: string
 *                           description: String value to search for (supports boolean values like 'true'/'false')
 *                           example: "true"
 *                         operator:
 *                           type: string
 *                           enum: [contains, not_contains]
 *                           description: String comparison operator
 *                           example: "contains"
 *                   custom:
 *                     type: object
 *                     description: Legacy single custom filter (deprecated - use customFilters instead)
 *                     properties:
 *                       field:
 *                         type: string
 *                         description: Field name to filter on
 *                         example: "hangupFirstName"
 *                       value:
 *                         type: string
 *                         description: String value to search for
 *                         example: "john"
 *                       operator:
 *                         type: string
 *                         enum: [contains, not_contains]
 *                         description: String comparison operator
 *                         example: "contains"
 *     responses:
 *       200:
 *         description: Campaign report retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 200
 *                 data:
 *                   type: array
 *                   description: Array of completed call records
 *                   items:
 *                     type: object
 *                 totalDuration:
 *                   type: number
 *                   example: 1250
 *                   description: Total call duration in seconds (total across all pages)
 *                 message:
 *                   type: string
 *                   example: "Merged data fetched successfully."
 *                 campaignStatus:
 *                   type: string
 *                   enum: [running, paused, completed, cancelled, failed]
 *                   example: "running"
 *                   description: Current status of the campaign
 *                 isCompleted:
 *                   type: boolean
 *                   example: false
 *                   description: Whether the campaign has completed
 *                 completedCalls:
 *                   type: number
 *                   example: 45
 *                   description: Number of calls completed so far
 *                 totalScheduledCalls:
 *                   type: number
 *                   example: 100
 *                   description: Total number of calls scheduled
 *                 failedCalls:
 *                   type: number
 *                   example: 5
 *                   description: Number of failed calls
 *                 totalCount:
 *                   type: number
 *                   example: 150
 *                   description: Total number of records across all pages
 *                 hasNextPage:
 *                   type: boolean
 *                   example: true
 *                   description: Whether there are more pages available
 *                 nextCursor:
 *                   type: string
 *                   example: "64a1b2c3d4e5f6789abc0124"
 *                   description: Cursor for next page (null if no more pages)
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: string
 *                       example: "N/A"
 *                       description: Page numbers not applicable with cursor pagination
 *                     hasNextPage:
 *                       type: boolean
 *                       example: true
 *                     nextCursor:
 *                       type: string
 *                       example: "64a1b2c3d4e5f6789abc0124"
 *                     totalRecords:
 *                       type: number
 *                       example: 150
 *                     limit:
 *                       oneOf:
 *                         - type: number
 *                         - type: string
 *                       example: 100
 *                       description: Records per page or 'All' for download mode
 *                 isDownload:
 *                   type: boolean
 *                   example: false
 *                   description: Whether this was a download request
 *       404:
 *         description: Campaign not found
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-report-by-campaign', authenticateToken, validateResourceOwnership, validationSchemas.reportQuery, auditLog, async(req, res) =>{
  try{
    const camp_id = req.body.campaignId;
    const cursor = req.body.cursor || null; // For pagination
    const limit = parseInt(req.body.limit) || 100; // Default 100 records per page
    const isDownload = req.body.isDownload === true || req.body.isDownload === 'true'; // For full download
    const filters = req.body.filters || null; // For filtering
    
    console.log(`📊 Campaign report request: ${camp_id}, cursor: ${cursor}, limit: ${limit}, download: ${isDownload}, filters:`, filters);
    
    const result = await getReportByCampId(camp_id, cursor, limit, isDownload, filters)
    
    // Handle 404 for campaign not found
    if(result.status == 404){
      return res.status(404).send({ message: result.message });
    }
    
    // Enhanced response with pagination metadata
    res.status(result.status || 200).send(result)
  } catch(error){
    console.error('❌ Error in get-report-by-campaign:', error);
    res.status(500).send({ message: "Internal Server Error", error: error.message });
  }
})

/**
 * @swagger
 * /plivo/get-campaign-status:
 *   post:
 *     tags: [Plivo]
 *     summary: Get campaign status information
 *     description: Retrieve the current status of a specific campaign
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campaignId
 *             properties:
 *               campaignId:
 *                 type: string
 *                 description: The ID of the campaign to get status for
 *                 example: "67fca247fe00d34aba08702e"
 *     responses:
 *       200:
 *         description: Campaign status retrieved successfully
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-campaign-status', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
  try{
    const camp_id = req.body.campaignId;
    // const camp_id = "67fca247fe00d34aba08702e"
    const result = await getCampaignStatus(camp_id)
    res.status(result.status).send(result.data)
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }
})

/**
 * @swagger
 * /plivo/get-incoming-by-number:
 *   post:
 *     tags: [Plivo]
 *     summary: Get incoming call reports by phone number with cursor-based pagination and date filtering
 *     description: Retrieve incoming call reports for a specific phone number using cursor-based pagination for efficient data loading. Supports date range filtering and download mode for bulk data export.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromNumber
 *             properties:
 *               fromNumber:
 *                 type: string
 *                 description: The phone number to get incoming reports for
 *                 example: "918035735659"
 *               cursor:
 *                 type: string
 *                 description: Optional cursor for pagination (ObjectId of last item from previous page). Ignored in download mode.
 *                 example: "507f1f77bcf86cd799439011"
 *               limit:
 *                 type: integer
 *                 description: Number of items per page (1-100, default 20). Ignored in download mode.
 *                 minimum: 1
 *                 maximum: 100
 *                 default: 20
 *                 example: 20
 *               isDownload:
 *                 type: boolean
 *                 description: Enable download mode to get all records without pagination limits. REQUIRES dateRange to be specified.
 *                 default: false
 *                 example: true
 *               dateRange:
 *                 type: object
 *                 description: Optional date range filter. REQUIRED when isDownload is true.
 *                 properties:
 *                   startDate:
 *                     type: string
 *                     format: date
 *                     description: Start date (YYYY-MM-DD format)
 *                     example: "2024-01-01"
 *                   endDate:
 *                     type: string
 *                     format: date
 *                     description: End date (YYYY-MM-DD format, inclusive)
 *                     example: "2024-01-31"
 *     responses:
 *       200:
 *         description: Incoming reports retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   description: Array of incoming call reports
 *                   items:
 *                     type: object
 *                 hasNextPage:
 *                   type: boolean
 *                   description: Whether there are more pages available
 *                   example: true
 *                 nextCursor:
 *                   type: string
 *                   description: Cursor for the next page (null if no more pages)
 *                   example: "507f1f77bcf86cd799439012"
 *                 totalItems:
 *                   type: integer
 *                   description: Number of items in current page (or retrieved items in download mode)
 *                   example: 20
 *                 totalCount:
 *                   type: integer
 *                   description: Total number of records matching the query. Only provided on first page (no cursor) or download mode.
 *                   nullable: true
 *                   example: 1500
 *                 message:
 *                   type: string
 *                   examples:
 *                     firstPage: "Merged data fetched successfully. Page: 20, Total available: 1500"
 *                     subsequentPage: "Merged data fetched successfully. Page: 20"
 *                     download: "Download data fetched successfully. Retrieved: 1500, Total available: 1500"
 *                 isDownload:
 *                   type: boolean
 *                   description: Whether response is in download mode
 *                   example: false
 *                 dateRange:
 *                   type: object
 *                   description: Applied date range filter (null if not used)
 *                   nullable: true
 *                   properties:
 *                     startDate:
 *                       type: string
 *                       format: date
 *                     endDate:
 *                       type: string
 *                       format: date
 *       400:
 *         description: Bad request - validation errors
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   examples:
 *                     - "Download mode requires a date range. Please provide startDate and/or endDate to limit the data scope."
 *                     - "Invalid startDate format. Use YYYY-MM-DD."
 *                     - "Invalid endDate format. Use YYYY-MM-DD."
 *       404:
 *         description: No reports found for the provided number
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                 hasNextPage:
 *                   type: boolean
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
 *                 totalCount:
 *                   type: integer
 *                   description: Total count of matching records (0 for no data found)
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-incoming-by-number', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
  try{
    const fromNumber = req.body.fromNumber;
    const cursor = req.body.cursor || null; // Optional cursor for pagination
    const limit = parseInt(req.body.limit) || 20; // Default limit of 20
    const isDownload = req.body.isDownload === true; // Download mode flag
    const dateRange = req.body.dateRange || null; // Date range filter
    
    // Validate download mode requirements
    if (isDownload && (!dateRange || (!dateRange.startDate && !dateRange.endDate))) {
      return res.status(400).send({ 
        message: "Download mode requires a date range. Please provide startDate and/or endDate to limit the data scope." 
      });
    }
    
    // Validate date range format if provided
    if (dateRange) {
      if (dateRange.startDate && isNaN(Date.parse(dateRange.startDate))) {
        return res.status(400).send({ message: "Invalid startDate format. Use YYYY-MM-DD." });
      }
      if (dateRange.endDate && isNaN(Date.parse(dateRange.endDate))) {
        return res.status(400).send({ message: "Invalid endDate format. Use YYYY-MM-DD." });
      }
      
      // Don't swap dates here - let the MongoDB query logic handle it properly
      console.log(`📅 Received date range: startDate=${dateRange.startDate}, endDate=${dateRange.endDate}`);
    }
    
    // Validate limit bounds (only for non-download mode)
    let finalLimit = limit;
    if (!isDownload) {
      const maxLimit = 100;
      finalLimit = Math.min(Math.max(limit, 1), maxLimit);
    }
    
    const result = await getIncomingReport(fromNumber, cursor, finalLimit, dateRange, isDownload);
    
    if(result.status == 404){
      return res.status(404).send({ 
        message: result.message,
        data: result.data,
        hasNextPage: result.hasNextPage,
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
        isDownload: result.isDownload,
        dateRange: result.dateRange
      });
    }
    
    // Return full response with pagination info (even for download mode)
    res.status(result.status).send({
      data: result.data,
      hasNextPage: result.hasNextPage,
      nextCursor: result.nextCursor,
      totalItems: result.totalItems,
      totalCount: result.totalCount,
      message: result.message,
      isDownload: result.isDownload,
      dateRange: result.dateRange
    });
  } catch(error) {
    console.error("Error in get-incoming-by-number:", error);
    res.status(500).send({ message: "Internal Server Error", error: error.message });
  }
})

/**
 * @swagger
 * /plivo/get-test-call-report:
 *   post:
 *     tags: [Plivo]
 *     summary: Get test call reports
 *     description: Retrieve test call reports for single call testing
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: The client ID to get test call reports for
 *                 example: "664a130cb70125f7e8c84d4a"
 *     responses:
 *       200:
 *         description: Test call reports retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 200
 *                 data:
 *                   type: array
 *                   description: Array of test call records
 *                   items:
 *                     type: object
 *                     properties:
 *                       CallUUID:
 *                         type: string
 *                         description: Unique call identifier
 *                       From:
 *                         type: string
 *                         description: Caller phone number
 *                       To:
 *                         type: string
 *                         description: Called phone number
 *                       Duration:
 *                         type: string
 *                         description: Call duration in seconds
 *                       callType:
 *                         type: string
 *                         example: "testcall"
 *                       RecordUrl:
 *                         type: string
 *                         description: Call recording URL if available
 *                         nullable: true
 *                       conversation_time:
 *                         type: number
 *                         description: Bot conversation duration
 *                       lead_data:
 *                         type: object
 *                         description: Lead analysis data from bot
 *                       user_data:
 *                         type: object
 *                         description: User interaction data
 *                       bot_response:
 *                         type: string
 *                         description: Final bot response/summary
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         description: Call timestamp
 *                 totalDuration:
 *                   type: number
 *                   description: Total conversation time in seconds
 *                 message:
 *                   type: string
 *                   example: "Test call data fetched successfully with enriched information."
 *       404:
 *         description: No test call data found
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-test-call-report', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
  try{
    const clientId = req.body.clientId;
    const result = await getTestCallReport(clientId)
    if(result.status == 404){
      res.status(404).send({ message: result.message });
      return;
    }
    res.status(result.status).send(result)
  } catch(error) {
    res.status(500).send({ message: "Internal Server Error", error });
  }
})

/**
 * @swagger
 * /plivo/get-recording-stream-url:
 *   post:
 *     tags: [Plivo]
 *     summary: Get authenticated recording stream URL
 *     description: Validates client ownership and returns authenticated URL for recording playback
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - recordingUrl
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: The client ID who owns this recording
 *                 example: "688d42040633f48913672d43"
 *               recordingUrl:
 *                 type: string
 *                 description: The Twilio recording URL to authenticate
 *                 example: "https://api.twilio.com/2010-04-01/Accounts/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/Recordings/RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 *     responses:
 *       200:
 *         description: Authenticated streaming URL returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 streamUrl:
 *                   type: string
 *                   example: "https://api.twilio.com/2010-04-01/Accounts/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/Recordings/RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.mp3"
 *                 provider:
 *                   type: string
 *                   example: "twilio"
 *                 credentialSource:
 *                   type: string
 *                   example: "client-specific"
 *       400:
 *         description: Bad request - missing parameters
 *       403:
 *         description: Forbidden - invalid credentials
 *       404:
 *         description: Recording not accessible
 */
router.post('/get-recording-stream-url', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { clientId, recordingUrl } = req.body;
    
    if (!clientId || !recordingUrl) {
      return res.status(400).json({ 
        error: 'Missing required parameters', 
        message: 'clientId and recordingUrl are required' 
      });
    }
    
    // Check if this is a Twilio recording URL
    if (!recordingUrl.includes('api.twilio.com')) {
      return res.status(400).json({ 
        error: 'Unsupported recording format', 
        message: 'Only Twilio recording URLs are currently supported' 
      });
    }
    
    const TelephonyCredentialsService = require('../services/telephonyCredentialsService');
    
    // Try to get client-specific Twilio credentials
    let credentials = await TelephonyCredentialsService.getCredentials(clientId, 'twilio');
    let credentialSource = 'client-specific';
    
    // If no client-specific credentials, fall back to default
    if (!credentials) {
      console.log(`📻 No client-specific Twilio creds for ${clientId}, using default credentials`);
      credentials = {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN
      };
      credentialSource = 'default';
      
      if (!credentials.accountSid || !credentials.authToken) {
        return res.status(503).json({ 
          error: 'Service unavailable', 
          message: 'No Twilio credentials available for recording access' 
        });
      }
    }
    
    // Validate the recording URL belongs to the account we have credentials for
    const urlAccountSid = recordingUrl.match(/\/Accounts\/([^\/]+)\//);
    if (!urlAccountSid) {
      return res.status(400).json({ 
        error: 'Invalid recording URL', 
        message: 'Could not extract account SID from recording URL' 
      });
    }
    
    const recordingAccountSid = urlAccountSid[1];
    if (recordingAccountSid !== credentials.accountSid) {
      return res.status(403).json({ 
        error: 'Access denied', 
        message: 'Recording belongs to different Twilio account' 
      });
    }
    
    // Create our own proxy streaming URL instead of returning Twilio URL directly
    const streamUrl = `${process.env.BASE_URL || 'https://api.markaible.com'}/plivo/stream-recording/${clientId}/${encodeURIComponent(recordingUrl)}`;
    
    console.log(`🎵 Generated proxy recording stream URL for client ${clientId} (${credentialSource})`);
    
    res.json({
      streamUrl: streamUrl,
      provider: 'twilio',
      credentialSource: credentialSource
    });
    
  } catch(error) {
    console.error('❌ Error generating recording stream URL:', error);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to generate recording stream URL',
      details: error.message 
    });
  }
})

/**
 * @swagger
 * /plivo/stream-recording/{clientId}/{recordingUrl}:
 *   get:
 *     tags: [Plivo]
 *     summary: Stream authenticated recording audio
 *     description: Proxy endpoint that authenticates with Twilio and streams recording audio
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: The client ID who owns this recording
 *       - in: path
 *         name: recordingUrl
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded Twilio recording URL
 *     responses:
 *       200:
 *         description: Audio stream
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: Forbidden - invalid credentials
 *       404:
 *         description: Recording not found
 */
router.get('/stream-recording/:clientId/:recordingUrl(*)', async(req, res) => {
  try {
    const { clientId, recordingUrl } = req.params;
    const decodedRecordingUrl = decodeURIComponent(recordingUrl);
    
    console.log(`🎵 Streaming recording for client: ${clientId}`);
    console.log(`🎵 Recording URL: ${decodedRecordingUrl}`);
    
    // Validate this is a Twilio recording URL
    if (!decodedRecordingUrl.includes('api.twilio.com')) {
      return res.status(400).json({ 
        error: 'Unsupported recording format', 
        message: 'Only Twilio recording URLs are supported' 
      });
    }
    
    const TelephonyCredentialsService = require('../services/telephonyCredentialsService');
    
    // Get client-specific Twilio credentials or fall back to default
    let credentials = await TelephonyCredentialsService.getCredentials(clientId, 'twilio');
    if (!credentials) {
      console.log(`📻 Using default Twilio credentials for client ${clientId}`);
      credentials = {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN
      };
      
      if (!credentials.accountSid || !credentials.authToken) {
        return res.status(503).json({ 
          error: 'Service unavailable', 
          message: 'No Twilio credentials available' 
        });
      }
    }
    
    // Validate the recording belongs to our account
    const urlAccountSid = decodedRecordingUrl.match(/\/Accounts\/([^\/]+)\//);
    if (!urlAccountSid || urlAccountSid[1] !== credentials.accountSid) {
      return res.status(403).json({ 
        error: 'Access denied', 
        message: 'Recording belongs to different account' 
      });
    }
    
    // Stream the recording from Twilio with authentication
    const axios = require('axios');
    const audioUrl = `${decodedRecordingUrl}.mp3`;
    
    console.log(`🎵 Fetching audio from Twilio: ${audioUrl}`);
    
    const response = await axios({
      method: 'GET',
      url: audioUrl,
      auth: {
        username: credentials.accountSid,
        password: credentials.authToken
      },
      responseType: 'stream'
    });
    
    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    // Pipe the Twilio audio response directly to our response
    response.data.pipe(res);
    
    console.log(`✅ Audio streaming started for client ${clientId}`);
    
  } catch(error) {
    console.error('❌ Error streaming recording:', error);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: 'Recording not found', 
        message: 'The requested recording could not be found' 
      });
    } else if (error.response?.status === 401) {
      return res.status(403).json({ 
        error: 'Authentication failed', 
        message: 'Invalid Twilio credentials' 
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to stream recording' 
    });
  }
})

router.post('/callback-url', async(req, res) => {
  try{
    const { Event, CallUUID } = req.body;
    
    if (!CallUUID) {
      console.warn('⚠️ StatusCallback received without CallUUID');
      return res.status(400).json({ message: "Missing CallUUID" });
    }
    
    console.log(`📡 StatusCallback received: Event=${Event}, CallUUID=${CallUUID}`);
    
    // Handle StartStream event - call was answered and conversation started
    if (Event === 'StartStream') {
      const { connectToMongo, client } = require('../../models/mongodb.js');
      await connectToMongo();
      const database = client.db("talkGlimpass");
      const activeCallsCollection = database.collection("activeCalls");
      
      const result = await activeCallsCollection.updateOne(
        { callUUID: CallUUID },
        { 
          $set: { 
            status: 'ongoing',  // Call answered and conversation started
            statusTimestamp: new Date(), // Track when status was set for lazy cleanup
            streamStartTime: new Date(),
            updatedAt: new Date()
          } 
        }
      );
      
      if (result.matchedCount > 0) {
        console.log(`✅ Call marked as ongoing (answered): ${CallUUID}`);
      } else {
        console.warn(`⚠️ CallUUID not found for StartStream: ${CallUUID}`);
      }
    }
    
    res.status(200).json({ message: "StatusCallback processed" });
  } catch(error) {
    console.error("❌ Error in statusCallback:", error);
    res.status(500).json({ message: "Error processing status callback" });
  }
})

// router.post('/ring-url', async(req, res) => {
//   try{
//     console.log(req.body)
//   } catch(error)
//   {
//   }
// })

// router.post('/hangup-url', async(req, res) => {
//   try{
//     console.log(req.body)
//   } catch(error)
//   {
//   }
// })


router.post('/callback-record-url', async(req, res) => {
  try{
    const recordData = req.body
    const result = await saveRecordData(recordData)
    res.status(200).json({ message: "Recording data saved successfully" });
  } catch(error)
  {
    console.log('error recording data:', error)
    res.status(500).json({ message: "Error saving recording data" });
  }
})

const validateCsvFormat = (data) => {
  if (data.length === 0) return false;
  const expectedHeaders = ['number', 'first_name', 'last_name', 'company_name', 'email', 'tag', 'custom_field'];
  // Check if the headers in the data match the expected headers
  let headers = Object.keys(data[0]);
	headers= headers.slice(0,7)
  if (!expectedHeaders.every(header => headers.includes(header))) {
    return false;
  }

  // Check if each row has values for at least one of the required fields
  return data.every(row => expectedHeaders.some(header => row[header] !== ''));
};

/**
 * @swagger
 * /plivo/check-socket-connection:
 *   post:
 *     tags: [Plivo]
 *     summary: Check socket connection for call confirmation
 *     description: Simulate socket connection confirmation for call tracking
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Socket connection confirmed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Call confirmed, active count incremented."
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/check-socket-connection', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
  try {
      // Simulate socket connection confirmation
      // activeCalls.activeCalls.count++ // Increment when call is confirmed
      // console.log(`Call confirmed. Active calls: ${activeCalls.activeCalls.count}`);
      res.status(200).json({ message: "Call confirmed, active count incremented." });
  } catch (error) {
      console.error("Error in check-socket-connection:", error);
      res.status(500).json({ message: "Error in checking socket connection." });
  }
});

router.post('/ring-url', async (req, res) => {
  try {
      const { CallUUID } = req.body;
      if (!CallUUID) return res.status(400).json({ message: "Missing CallUUID" });

      console.log(`🔔 Ring webhook received for CallUUID: ${CallUUID}`);
      
      // Update the existing call record with ring confirmation
      // The call was already tracked when processSingleCall was initiated
      const { connectToMongo, client } = require('../../models/mongodb.js');
      await connectToMongo();
      
      const database = client.db("talkGlimpass");
      const activeCallsCollection = database.collection("activeCalls");
      
      const result = await activeCallsCollection.updateOne(
        { callUUID: CallUUID },
        { 
          $set: { 
            status: 'ringing',  // Update to ringing state
            statusTimestamp: new Date(), // Track when status was set for lazy cleanup
            ringTime: new Date(),
            updatedAt: new Date()
          } 
        }
      );
      
      if (result.matchedCount === 0) {
        console.warn(`⚠️  CallUUID not found in activeCalls: ${CallUUID}`);
        // This could be a direct Plivo call not through our system
        return res.status(200).json({ message: "Ring received but call not tracked" });
      }
      
      console.log(`✅ Ring confirmed for CallUUID: ${CallUUID}`);
      return res.status(200).json({ message: "Ring recorded successfully" });
      
  } catch (error) {
      console.error("❌ Error in ring webhook:", error);
      return res.status(500).json({ message: "Error processing ring webhook" });
  }
});

/**
* API Hit 3 & 4: Call End
* Decrease count only on the second hit.
*/
router.post('/hangup-url', async (req, res) => {
  try {
      const { CallUUID, To, CallDuration, HangupCause } = req.body;
      const { campId, hangupFirstName, tag } = req.query;
      
      if (!CallUUID) return res.status(400).json({ message: "Missing CallUUID" });
      
      console.log(`📞 Hangup webhook received for CallUUID: ${CallUUID}`);
      
      // Prepare hangup data for legacy systems
      const hangupData = req.body;
      hangupData.campId = campId ?? 'incoming';
      hangupData.hangupFirstName = hangupFirstName ?? '';
      hangupData.tag = tag ?? '';
      
      // Process billing using NEW billing system
      console.log(`💰 Processing billing for call: ${CallUUID}, Type: ${hangupData.campId}, Duration: ${hangupData.Duration}s`);
      
      // Use NEW billing system instead of old one
      const { 
        saveCallBillingDetail, 
        updateClientBalance: updateClientBalanceNew
      } = require('../apps/billing/billingCore');
      const { getClientByClientId } = require('../apps/interLogue/client');
      const billingRouter = require('./billingRouter');
      
      try {
        // Determine call type
        let callType;
        if (hangupData.campId === 'incoming') {
          callType = 'incoming';
        } else if (hangupData.campId === 'testcall') {
          callType = 'testcall';
        } else {
          callType = 'campaign';
        }
        
        // Get clientId from tag (for test calls and campaigns) or lookup for incoming calls
        let clientId = null;
        let existingClient = null;

        // Try to resolve clientId, but don't fail if we can't find it
        try {
          if (callType === 'incoming') {
            // For incoming calls, try to lookup by phone number (receiver)
            const clientLookupNumber = hangupData.To;
            const possibleNumbers = [clientLookupNumber];
            if (clientLookupNumber.startsWith('91') && clientLookupNumber.length === 12) {
              possibleNumbers.push('0' + clientLookupNumber.slice(2));
              possibleNumbers.push(clientLookupNumber.slice(2));
              possibleNumbers.push('+' + clientLookupNumber);
            }

            const { connectToMongo, client: mongoClient } = require('../../models/mongodb.js');
            await connectToMongo();
            const database = mongoClient.db("talkGlimpass");
            const clientCollection = database.collection("client");

            console.log('🔍 Incoming call - looking up client using numbers:', possibleNumbers);
            const foundClient = await clientCollection.findOne({callerNumbers: { $in: possibleNumbers }});

            if (foundClient) {
              clientId = foundClient._id.toString();
              existingClient = foundClient;
              console.log(`✅ Found client for incoming call: ${clientId}`);
            } else {
              console.warn('⚠️ Client not found for incoming call:', possibleNumbers, '- will save hangup data without client association');
            }
          } else {
            // For test calls and campaigns, tag contains assistantId - need to lookup client
            const assistantId = hangupData.tag;
            if (!assistantId) {
              console.warn('⚠️ No assistantId found in tag for', callType, 'call - will save hangup data without client association');
            } else {
              // Step 1: Find client that owns this assistant
              console.log(`🔍 Step 1: Looking up client for assistantId: ${assistantId}`);
              const { connectToMongo, client: mongoClient } = require('../../models/mongodb.js');
              await connectToMongo();
              const database = mongoClient.db("talkGlimpass");
              const assistantCollection = database.collection("assistant");
              const { ObjectId } = require('mongodb');

              const assistant = await assistantCollection.findOne({ _id: new ObjectId(assistantId) });
              if (assistant && assistant.clientId) {
                clientId = assistant.clientId;
                console.log(`✅ Step 1: Found clientId ${clientId} for assistant ${assistantId}`);

                // Get full client data
                existingClient = await getClientByClientId(clientId);
              } else {
                console.warn('⚠️ Assistant not found or no clientId:', assistantId, '- will save hangup data without client association');
              }
            }
          }
        } catch (clientLookupError) {
          console.warn('⚠️ Error during client lookup:', clientLookupError.message, '- will save hangup data without client association');
        }

        // Add resolved clientId to hangupData (may be null)
        hangupData.clientId = clientId;

        console.log(`🎯 Using clientId: ${clientId || 'null'} for ${callType} call`);

        const duration = parseInt(hangupData.Duration) || 0;
        const creditsToDeduct = duration; // 1 second = 1 credit

        // Only process billing if we have a valid client
        if (clientId && existingClient) {
          const currentBalance = existingClient.availableBalance || 0;
          const newBalance = currentBalance - creditsToDeduct;

          console.log(`💰 NEW Billing: ${callType} call - ${creditsToDeduct} credits (duration: ${duration}s)`);
          console.log(`💰 Current Balance: ${currentBalance}`);

          // UPDATED BILLING LOGIC: Balance updates for ALL calls, but billing history only for non-campaign calls
          console.log(`💰 Processing call billing: ${currentBalance} -> ${newBalance}`);

          // Update client balance immediately for ALL call types (including campaign calls)
          const { connectToMongo, client: mongoClient } = require('../../models/mongodb.js');
          await connectToMongo();
          const database = mongoClient.db("talkGlimpass");
          const clientCollection = database.collection("client");
          const { ObjectId } = require('mongodb');

          // Update client balance immediately for ALL calls (real-time balance updates)
          await clientCollection.updateOne(
            { _id: new ObjectId(clientId) },
            { $set: { availableBalance: newBalance } }
          );

          // Broadcast balance update via SSE for ALL calls (including campaign calls)
          if (billingRouter.broadcastBalanceUpdate) {
            try {
              console.log(`📡 Broadcasting individual call balance update: ${clientId} -> ${newBalance} credits (Call Type: ${callType})`);
              billingRouter.broadcastBalanceUpdate(clientId, newBalance, 'call_end');
            } catch (error) {
              console.warn('Failed to broadcast balance update:', error.message);
            }
          } else {
            console.warn('⚠️ SSE broadcast function not available');
          }
        } else {
          console.log(`💰 Skipping billing for ${callType} call - no client associated (duration: ${duration}s)`);
        }
        
        // BILLING HISTORY: Only for non-campaign calls (incoming, test calls) and only if we have a client
        // Campaign calls get billing history entries only at campaign completion
        if (callType !== 'campaign' && clientId && existingClient) {
          const { connectToMongo, client: mongoClient } = require('../../models/mongodb.js');
          await connectToMongo();
          const database = mongoClient.db("talkGlimpass");
          const billingHistoryCollection = database.collection("billingHistory");

          const currentBalance = existingClient.availableBalance || 0;
          const newBalance = currentBalance - creditsToDeduct;

          let billingDescription, campName;
          if (callType === 'testcall') {
            billingDescription = `Test call to ${hangupData.To} for ${duration} seconds`;
            campName = 'Test Call';
          } else {
            billingDescription = `Incoming call from ${hangupData.From} for ${duration} seconds`;
            campName = 'Incoming Call';
          }

          const billingEntry = {
            clientId: clientId,
            camp_name: campName,
            campaignId: '',
            balanceCount: -creditsToDeduct, // Negative for deductions
            date: new Date(),
            desc: billingDescription,
            transactionType: 'Dr', // Debit entry
            newAvailableBalance: newBalance,
            callUUID: hangupData.CallUUID,
            callDuration: duration,
            callType: callType,
            from: hangupData.From,
            to: hangupData.To
          };

          const historyResult = await billingHistoryCollection.insertOne(billingEntry);
          console.log(`✅ billingHistory entry created for ${callType}: ${historyResult.insertedId}`);
        } else if (callType === 'campaign') {
          console.log(`📋 Campaign call - balance updated but billing history deferred until campaign completion`);
        } else {
          console.log(`📋 Skipping billing history for ${callType} call - no client associated`);
        }
        
        // Save detailed call record for ALL calls (for tracking purposes) - even without client association
        try {
          await saveCallBillingDetail({
            clientId: clientId, // May be null for unknown clients
            callUuid: hangupData.CallUUID,
            duration: duration,
            type: callType,
            from: hangupData.From,
            to: hangupData.To,
            credits: creditsToDeduct,
            aiCredits: 0,
            telephonyCredits: creditsToDeduct,
            campaignId: callType === 'campaign' ? hangupData.campId : null,
            campaignName: callType === 'campaign' ? `Campaign ${hangupData.campId}` : null
          });
          console.log(`✅ Call billing detail saved for ${callType} call: ${hangupData.CallUUID}`);
        } catch (billingDetailError) {
          console.warn(`⚠️ Failed to save call billing detail:`, billingDetailError.message);
        }

        if (clientId && existingClient) {
          const currentBalance = existingClient.availableBalance || 0;
          const newBalance = currentBalance - creditsToDeduct;
          console.log(`✅ Call processed: ${creditsToDeduct} credits deducted, balance updated to ${newBalance} (Call Type: ${callType})`);
        } else {
          console.log(`✅ Call processed: ${callType} call saved without billing (no client association)`);
        }

        // Note: Campaign calls get real-time balance updates but billing history only at campaign end
        
      } catch (billingError) {
        console.error(`❌ Billing failed for ${callType} call:`, billingError);
        // Continue to save hangup data even if billing fails
        console.log(`📋 Continuing to save hangup data despite billing failure`);
      }

      // CRITICAL: Always save hangup data regardless of billing success/failure
      try {
        await saveHangupData(hangupData);
        console.log(`✅ Hangup data saved successfully for CallUUID: ${CallUUID}`);
      } catch (hangupError) {
        console.error(`❌ CRITICAL: Failed to save hangup data for ${CallUUID}:`, hangupError);
        // This should be treated as a critical error but still return 200 to Plivo
        // to prevent webhook retries
      }
      
      // Track call end in new database system
      const { trackCallEnd } = require('../apps/helper/activeCalls.js');
      const endResult = await trackCallEnd(CallUUID, {
        duration: parseInt(CallDuration) || null,
        endReason: HangupCause || 'hangup'
      });
      
      if (!endResult.success) {
        console.warn(`⚠️  Failed to track call end: ${endResult.error}`);
        // Continue processing even if tracking fails
      } else {
        console.log(`✅ Call end tracked: ${CallUUID} (Active calls: ${endResult.activeCallsCount || 'unknown'})`);
      }
      
      return res.status(200).json({ message: "Hangup processed successfully" });
  } catch (error) {
      console.error("Error in call end:", error);
      return res.status(500).json({ message: "Error in processing call end." });
  }
});

router.post('/get-incoming-billing', authenticateToken, validateResourceOwnership, auditLog, async(req, res) =>{
  try{
    const {clientId, number} = req.body;
    // const clientId = '664a130cb70125f7e8c84d4a'
    // const number = '918035735659'
    const result = await getIncomingBilling(clientId, number)
    if(result.status == 500){
      res.status(500).send({ message: result.message });
    }
    res.status(result.status).send(result.data)
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }
})

/**
 * @swagger
 * /plivo/pause-campaign:
 *   post:
 *     tags: [Plivo]
 *     summary: Pause an active campaign
 *     description: Immediately pause an active campaign at its current position. The campaign can be resumed later from the same position.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campaignId
 *             properties:
 *               campaignId:
 *                 type: string
 *                 description: The ID of the campaign to pause
 *                 example: "67fca247fe00d34aba08702e"
 *               pausedBy:
 *                 type: string
 *                 description: Optional - ID of user who paused the campaign
 *                 example: "664a130cb70125f7e8c84d4a"
 *     responses:
 *       200:
 *         description: Campaign paused successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Campaign paused successfully"
 *       400:
 *         description: Campaign not found or not in running state
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/pause-campaign', authenticateToken, validateResourceOwnership, validationSchemas.campaignControl, auditLog, async(req, res) => {
  try {
    const { campaignId } = req.body;
    
    console.log(`⏸️ Pause request received for campaign: ${campaignId}`);
    
    const result = await pauseCampaign(campaignId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json({
      success: true,
      message: "Campaign paused successfully",
      campaignId: campaignId
    });
    
  } catch (error) {
    console.error("❌ Error in pause-campaign endpoint:", error);
    res.status(500).json({ 
      success: false,
      message: "Internal server error", 
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /plivo/resume-campaign:
 *   post:
 *     tags: [Plivo]
 *     summary: Resume a paused campaign
 *     description: Resume a paused campaign from its exact saved position. The campaign will continue processing from where it left off.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campaignId
 *             properties:
 *               campaignId:
 *                 type: string
 *                 description: The ID of the campaign to resume
 *                 example: "67fca247fe00d34aba08702e"
 *     responses:
 *       200:
 *         description: Campaign resumed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Campaign resumed from position 45"
 *                 remainingContacts:
 *                   type: number
 *                   example: 155
 *                   description: Number of remaining contacts to process
 *       400:
 *         description: Campaign not found or not in paused state
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/resume-campaign', authenticateToken, validateResourceOwnership, validationSchemas.campaignControl, auditLog, async(req, res) => {
  try {
    const { campaignId } = req.body;
    
    console.log(`▶️ Resume request received for campaign: ${campaignId}`);
    
    const result = await resumeCampaign(campaignId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json({
      success: true,
      message: result.message,
      campaignId: campaignId,
      remainingContacts: result.remainingContacts
    });
    
  } catch (error) {
    console.error("❌ Error in resume-campaign endpoint:", error);
    res.status(500).json({ 
      success: false,
      message: "Internal server error", 
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /plivo/cancel-campaign:
 *   post:
 *     tags: [Plivo]
 *     summary: Cancel a running or paused campaign
 *     description: Permanently cancel a campaign. Cannot be undone - campaign becomes terminal.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campaignId
 *             properties:
 *               campaignId:
 *                 type: string
 *                 description: The ID of the campaign to cancel
 *                 example: "67fca247fe00d34aba08702e"
 *     responses:
 *       200:
 *         description: Campaign cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Campaign cancelled successfully"
 *                 campaignId:
 *                   type: string
 *                   example: "67fca247fe00d34aba08702e"
 *       400:
 *         description: Cannot cancel campaign (wrong status or not found)
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/cancel-campaign', authenticateToken, validateResourceOwnership, validationSchemas.campaignControl, auditLog, async(req, res) => {
  try {
    const { campaignId } = req.body;
    
    console.log(`🛑 Cancel request received for campaign: ${campaignId}`);
    
    const result = await cancelCampaign(campaignId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json({
      success: true,
      message: "Campaign cancelled successfully",
      campaignId: campaignId
    });
    
  } catch (error) {
    console.error("❌ Error in cancel-campaign endpoint:", error);
    res.status(500).json({ 
      success: false,
      message: "Internal server error", 
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /plivo/campaign-progress/{campaignId}:
 *   get:
 *     tags: [Plivo]
 *     summary: Get real-time campaign progress information
 *     description: Retrieve comprehensive campaign progress including status, completion percentage, call statistics, and container health information.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the campaign to get progress for
 *         example: "67fca247fe00d34aba08702e"
 *     responses:
 *       200:
 *         description: Campaign progress retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 campaignId:
 *                   type: string
 *                   example: "67fca247fe00d34aba08702e"
 *                 campaignName:
 *                   type: string
 *                   example: "Marketing Campaign Q1"
 *                 status:
 *                   type: string
 *                   enum: [running, paused, completed, cancelled, failed]
 *                   example: "running"
 *                 progress:
 *                   type: object
 *                   properties:
 *                     currentIndex:
 *                       type: number
 *                       example: 45
 *                     totalContacts:
 *                       type: number
 *                       example: 200
 *                     processedContacts:
 *                       type: number
 *                       example: 45
 *                     remainingContacts:
 *                       type: number
 *                       example: 155
 *                     progressPercentage:
 *                       type: number
 *                       example: 23
 *                 timing:
 *                   type: object
 *                   properties:
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     lastActivity:
 *                       type: string
 *                       format: date-time
 *                     pausedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     resumedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     estimatedCompletion:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                 statistics:
 *                   type: object
 *                   properties:
 *                     connectedCalls:
 *                       type: number
 *                       example: 38
 *                     failedCalls:
 *                       type: number
 *                       example: 7
 *                 health:
 *                   type: object
 *                   properties:
 *                     heartbeat:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     heartbeatStatus:
 *                       type: string
 *                       enum: [healthy, stale, inactive]
 *                       example: "healthy"
 *                     containerId:
 *                       type: string
 *                       example: "container_1704798123456_abc123def"
 *       404:
 *         description: Campaign not found
 *       401:
 *         description: Unauthorized - JWT token missing or expired
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.get('/campaign-progress/:campaignId', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const campaignId = req.params.campaignId;
    
    // Validate campaignId format
    if (!campaignId || !require('mongodb').ObjectId.isValid(campaignId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID format"
      });
    }
    
    console.log(`📊 Progress request for campaign: ${campaignId}`);
    
    const result = await getCampaignProgress(campaignId);
    
    if (!result.success) {
      if (result.error === "Campaign not found") {
        return res.status(404).json({
          success: false,
          message: "Campaign not found"
        });
      }
      
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in campaign-progress endpoint:", error);
    res.status(500).json({ 
      success: false,
      message: "Internal server error", 
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /plivo/dashboard/campaigns:
 *   get:
 *     tags: [Plivo]
 *     summary: Get comprehensive campaign list with dashboard data
 *     description: Retrieve campaign list with progress, health, and statistics for dashboard display
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [running, paused, completed, cancelled]
 *         description: Filter by campaign status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of campaigns per page
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter campaigns created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter campaigns created before this date
 *     responses:
 *       200:
 *         description: Campaign list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 campaigns:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalCount:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/dashboard/campaigns', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { getCampaignList } = require('../services/campaignDashboardService.js');
    
    const clientId = req.user.clientId || req.query.clientId;
    
    // Build filters from query parameters
    const filters = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    };
    
    if (req.query.status) {
      filters.status = Array.isArray(req.query.status) ? req.query.status : [req.query.status];
    }
    
    if (req.query.startDate || req.query.endDate) {
      filters.dateRange = {
        startDate: req.query.startDate,
        endDate: req.query.endDate
      };
    }
    
    console.log(`📊 Dashboard campaign list request for client: ${clientId}`);
    
    const result = await getCampaignList(clientId, filters);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in dashboard campaigns endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/dashboard/stats:
 *   get:
 *     tags: [Plivo]
 *     summary: Get system-wide statistics for dashboard
 *     description: Retrieve comprehensive system statistics including campaigns, calls, and health metrics
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *         description: Optional client filter for stats
 *     responses:
 *       200:
 *         description: System statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 statistics:
 *                   type: object
 *                 concurrency:
 *                   type: object
 *                 health:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/dashboard/stats', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { getSystemStats } = require('../services/campaignDashboardService.js');
    
    const clientId = req.query.clientId || (req.user.role !== 'admin' ? req.user.clientId : null);
    
    console.log(`📊 System stats request for client: ${clientId || 'global'}`);
    
    const result = await getSystemStats(clientId);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in dashboard stats endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/dashboard/failed-calls:
 *   get:
 *     tags: [Plivo]
 *     summary: Get failed call analysis
 *     description: Retrieve detailed analysis of failed calls with retry recommendations
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: campaignId
 *         schema:
 *           type: string
 *         description: Filter by specific campaign
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter failures after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter failures before this date
 *     responses:
 *       200:
 *         description: Failed call analysis retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 analysis:
 *                   type: object
 *                   properties:
 *                     totalFailures:
 *                       type: number
 *                     failuresByReason:
 *                       type: array
 *                     retryRecommendations:
 *                       type: array
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/dashboard/failed-calls', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { getFailedCallAnalysis } = require('../services/campaignDashboardService.js');
    
    const clientId = req.user.clientId || req.query.clientId;
    
    const filters = {};
    if (req.query.campaignId) filters.campaignId = req.query.campaignId;
    if (req.query.startDate || req.query.endDate) {
      filters.dateRange = {
        startDate: req.query.startDate,
        endDate: req.query.endDate
      };
    }
    
    console.log(`🔍 Failed call analysis request for client: ${clientId}`);
    
    const result = await getFailedCallAnalysis(clientId, filters);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in failed calls analysis endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/dashboard/bulk-operations:
 *   post:
 *     tags: [Plivo]
 *     summary: Perform bulk operations on campaigns
 *     description: Pause, resume, or cancel multiple campaigns at once
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campaignIds
 *               - operation
 *             properties:
 *               campaignIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of campaign IDs to operate on
 *               operation:
 *                 type: string
 *                 enum: [pause, resume, cancel]
 *                 description: Operation to perform
 *               operatorId:
 *                 type: string
 *                 description: ID of user performing the operation
 *     responses:
 *       200:
 *         description: Bulk operation completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: object
 *                   properties:
 *                     successful:
 *                       type: array
 *                     failed:
 *                       type: array
 *                     total:
 *                       type: number
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/dashboard/bulk-operations', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { bulkCampaignOperation } = require('../services/campaignDashboardService.js');
    
    const { campaignIds, operation, operatorId } = req.body;
    const clientId = req.user.clientId;
    
    // Validation
    if (!campaignIds || !Array.isArray(campaignIds) || campaignIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "campaignIds must be a non-empty array"
      });
    }
    
    if (!['pause', 'resume', 'cancel'].includes(operation)) {
      return res.status(400).json({
        success: false,
        message: "operation must be one of: pause, resume, cancel"
      });
    }
    
    console.log(`🔄 Bulk ${operation} operation for ${campaignIds.length} campaigns (client: ${clientId})`);
    
    const result = await bulkCampaignOperation(clientId, campaignIds, operation, operatorId || req.user.id);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in bulk operations endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/monitoring/active-calls:
 *   get:
 *     tags: [Plivo]
 *     summary: Get comprehensive active calls monitoring
 *     description: Retrieve detailed active calls monitoring with system health and analytics
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *         description: Filter by specific client
 *       - in: query
 *         name: includeCalls
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include detailed call list in response
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *           default: 100
 *         description: Maximum number of calls to include
 *     responses:
 *       200:
 *         description: Active calls monitoring data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     overview:
 *                       type: object
 *                     activeCalls:
 *                       type: object
 *                     heartbeats:
 *                       type: object
 *                     recentActivity:
 *                       type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/monitoring/active-calls', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { getActiveCallsMonitoring } = require('../services/activeCallsMonitoringService.js');
    
    const filters = {
      clientId: req.query.clientId || (req.user.role !== 'admin' ? req.user.clientId : null),
      includeCalls: req.query.includeCalls === 'true',
      limit: parseInt(req.query.limit) || 100
    };
    
    console.log(`📊 Active calls monitoring request (client: ${filters.clientId || 'global'})`);
    
    const result = await getActiveCallsMonitoring(filters);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in active calls monitoring endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/monitoring/utilization:
 *   get:
 *     tags: [Plivo]
 *     summary: Get real-time system utilization metrics
 *     description: Retrieve current system utilization including concurrency, campaigns, and call rates
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: System utilization retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 utilization:
 *                   type: object
 *                   properties:
 *                     concurrency:
 *                       type: object
 *                     campaigns:
 *                       type: object
 *                     callRate:
 *                       type: object
 *                     systemStatus:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/monitoring/utilization', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { getSystemUtilization } = require('../services/activeCallsMonitoringService.js');
    
    console.log('📊 System utilization request');
    
    const result = await getSystemUtilization();
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in system utilization endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/monitoring/analytics:
 *   get:
 *     tags: [Plivo]
 *     summary: Get detailed call analytics
 *     description: Retrieve comprehensive call analytics with failure analysis and performance metrics
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Analytics start date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Analytics end date
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *         description: Filter by specific client
 *     responses:
 *       200:
 *         description: Call analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 analytics:
 *                   type: object
 *                   properties:
 *                     timeRange:
 *                       type: object
 *                     callDistribution:
 *                       type: array
 *                     failureAnalysis:
 *                       type: array
 *                     summary:
 *                       type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/monitoring/analytics', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { getCallAnalytics } = require('../services/activeCallsMonitoringService.js');
    
    const filters = {
      clientId: req.query.clientId || (req.user.role !== 'admin' ? req.user.clientId : null)
    };
    
    if (req.query.startDate || req.query.endDate) {
      filters.timeRange = {
        start: req.query.startDate,
        end: req.query.endDate
      };
    }
    
    console.log(`📊 Call analytics request (client: ${filters.clientId || 'global'})`);
    
    const result = await getCallAnalytics(filters);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error("❌ Error in call analytics endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/one-time-cleanup:
 *   post:
 *     tags: [Plivo]
 *     summary: One-time cleanup of all stuck calls
 *     description: Mark all currently stuck calls as failed (use once to clean up existing issues)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cleanup completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 cleanedCount:
 *                   type: number
 *                 details:
 *                   type: object
 *       500:
 *         description: Internal server error
 */
router.post('/one-time-cleanup', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { oneTimeCleanupAllStuckCalls } = require('../apps/helper/activeCalls.js');
    
    console.log('🧹 ONE-TIME CLEANUP: Starting manual cleanup of all stuck calls...');
    
    const result = await oneTimeCleanupAllStuckCalls();
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Cleanup failed'
      });
    }
    
    res.status(200).json({
      success: true,
      message: `One-time cleanup completed. Marked ${result.cleanedCount} calls as failed.`,
      cleanedCount: result.cleanedCount,
      details: result.details
    });
    
  } catch (error) {
    console.error("❌ Error in one-time cleanup endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/campaign-analytics/{campaignId}:
 *   get:
 *     summary: Get comprehensive analytics for a specific campaign
 *     tags: [Plivo]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *         description: Campaign ID
 *     responses:
 *       200:
 *         description: Campaign analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 data:
 *                   type: object
 *                   properties:
 *                     campaignId:
 *                       type: string
 *                     totalCalls:
 *                       type: integer
 *                       description: Total number of calls made
 *                     totalDuration:
 *                       type: integer
 *                       description: Total duration in seconds
 *                     averageDuration:
 *                       type: integer
 *                       description: Average call duration in seconds
 *                     totalCost:
 *                       type: number
 *                       description: Total campaign cost in credits
 *                     totalLeads:
 *                       type: integer
 *                       description: Number of leads generated
 *                     costPerLead:
 *                       type: number
 *                       description: Cost per lead in credits
 *                     costPerCall:
 *                       type: number
 *                       description: Average cost per call in credits
 *                     leadConversionRate:
 *                       type: number
 *                       description: Lead conversion rate as percentage
 *       404:
 *         description: Campaign not found
 *       500:
 *         description: Internal server error
 */

router.get('/campaign-analytics/:campaignId', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { campaignId } = req.params;
    
    console.log(`📊 Campaign analytics request for: ${campaignId}`); // Added analytics endpoint
    
    const result = await getCampaignAnalytics(campaignId);
    
    if (result.status === 404) {
      return res.status(404).json({ 
        success: false, 
        message: result.message 
      });
    }
    
    res.status(200).json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error("❌ Error in campaign-analytics endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /plivo/client-analytics/{clientId}:
 *   get:
 *     summary: Get comprehensive analytics for a specific client
 *     tags: [Plivo]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 12
 *         description: Number of months to include in analysis
 *     responses:
 *       200:
 *         description: Client analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 data:
 *                   type: object
 *                   properties:
 *                     clientId:
 *                       type: string
 *                     currentMonth:
 *                       type: object
 *                       properties:
 *                         expenditure:
 *                           type: number
 *                         calls:
 *                           type: integer
 *                         duration:
 *                           type: integer
 *                     lastMonth:
 *                       type: object
 *                       properties:
 *                         expenditure:
 *                           type: number
 *                         calls:
 *                           type: integer
 *                         duration:
 *                           type: integer
 *                     growth:
 *                       type: object
 *                       properties:
 *                         expenditureGrowthPercent:
 *                           type: number
 *                         callGrowthPercent:
 *                           type: number
 *                     lifetime:
 *                       type: object
 *                       properties:
 *                         totalExpenditure:
 *                           type: number
 *                         totalCalls:
 *                           type: integer
 *                         totalDuration:
 *                           type: integer
 *                         averageCallCost:
 *                           type: number
 *                         firstTransactionDate:
 *                           type: string
 *                         lastTransactionDate:
 *                           type: string
 *                     monthlyBreakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           year:
 *                             type: integer
 *                           month:
 *                             type: integer
 *                           monthName:
 *                             type: string
 *                           expenditure:
 *                             type: number
 *                           calls:
 *                             type: integer
 *                           duration:
 *                             type: integer
 *       500:
 *         description: Internal server error
 */
router.get('/client-analytics/:clientId', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
  try {
    const { clientId } = req.params;
    const months = parseInt(req.query.months) || 12;
    
    console.log(`📊 Client analytics request for: ${clientId} (${months} months)`);
    
    const result = await getClientAnalytics(clientId, months);
    
    res.status(result.status || 200).json({
      success: result.status !== 500,
      ...result
    });
    
  } catch (error) {
    console.error("❌ Error in client-analytics endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

module.exports = router;
