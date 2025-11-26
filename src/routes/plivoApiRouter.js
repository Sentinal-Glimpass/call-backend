const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const router = express.Router();
const upload = multer({ dest: 'list-uploads/' });

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
 * tags:
 *   name: Plivo API
 *   description: Protected Plivo API endpoints (requires API key authentication)
 */

const {deleteList,insertList, insertListContent,updateList, saveSingleLeadData   } = require('./../apps/plivo/plivo.js')
const apiKeyValidator = require('./../middleware/apiKeyValidator')
// Route to upload CSV
router.post('/upload-csv', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const listName = req.body.listName; // Expecting the list name in the request body
  const clientId = req.clientData._id.toString();
  
  if (!listName) {
    safeFileDelete(filePath); // Clean up file before returning error
    return res.status(400).json({ message: 'List name is required' });
  }

  let listId = null;

  try {
    // Save the list name and generate a list ID
    const listResult = await insertList(listName, clientId);
    if(listResult.status == 200){
        listId = listResult.listId;
    }
    if(listResult.status == 400){
        safeFileDelete(filePath);
        return res.status(400).json({
            message: listResult.message,
          });
    }

    if(listId == null){
        safeFileDelete(filePath);
        return res.status(500).json({
            message: 'Error saving data to database',
          });
    }
    const rows = [];
    const indianMobileRegex = /^(\+91|91)[6-9]\d{9}$/;
    // Read and parse the CSV file
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', async (data) => {
        let number = data.number.trim(); // Trim whitespace

        // If number starts with "0", remove it and add "91"
        if (number.startsWith("0")) {
          number = "91" + number.slice(1);
        } 
        // If number does not start with "91", add "91"
        else if (!number.startsWith("91") && !number.startsWith("+91")) {
          number = "91" + number;
        } 
        // If number starts with "91" but is only 10 digits long, add another "91"
        else if (number.startsWith("91") && number.length === 10) {
          number = "91" + number;
        }
    
        // Validate the final number
        if (indianMobileRegex.test(number)) {
          data.number = number; // Update the number in the data object
          data.listId = listId; // Add listId
          
          rows.push(data); // Push updated data object
        } else {
          await deleteList(listId);
          safeFileDelete(filePath);
          return res.status(500).json({ message: `Invalid mobile number ${number}.` });
        }
        // const row = {
        //   ...data,  // Spread the existing data properties
        //   listId,   // Add listId directly at the same level
        // };
        // rows.push(row);
      })
      .on('end', async () => {
        try {
          if (!validateCsvFormat(rows)) {
            await deleteList(listId);
            return res.status(500).json({ message: 'Invalid CSV format.' });
          }
          const count = rows.length;
          await updateList(listId, count);
          // Save all rows to MongoDB
          const result = await insertListContent(rows);

          res.status(result.status).json({
            message: result.message
          });
        } catch (err) {
          console.error(err);
          res.status(500).json({
            message: 'Error saving data to database',
          });
        }
      })
      .on('error', async (err) => {
        console.error(err);
        await deleteList(listId);
        res.status(500).json({
          message: 'Error processing CSV file',
        });
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error saving list to database' });
  } finally {
    // Always delete the temporary file, regardless of success or failure
    safeFileDelete(filePath);
  }
});

const validateCsvFormat = (data) => {
  if (data.length === 0) return false;

  // Only 'number' is mandatory, all other columns are optional and dynamic
  const headers = Object.keys(data[0]);

  // Check that 'number' column exists
  if (!headers.includes('number')) {
    console.error('CSV validation failed: "number" column is required');
    return false;
  }

  // Check that all rows have a number value
  const allRowsHaveNumber = data.every(row => row.number && row.number.trim() !== '');
  if (!allRowsHaveNumber) {
    console.error('CSV validation failed: All rows must have a valid "number" value');
    return false;
  }

  // Log detected columns for debugging
  console.log(`✅ CSV validation passed. Detected columns: ${headers.join(', ')}`);

  return true;
};

router.post('/lead-push', async(req, res) =>{
  try{
    const leadData = req.body;
    const clientData = req.clientData;
    const result = await saveSingleLeadData(leadData, clientData)
    res.status(result.status).send(result.message)
  } catch(error){
    res.status(500).send({ message: "Internal Server Error", error });
  }

})

/**
 * @swagger
 * /api.markaible/single-call:
 *   post:
 *     tags: [Plivo API]
 *     summary: Initiate a single API call (requires API key)
 *     description: Make a single call via API for HubSpot or other integrations. Requires assistantId which is used to auto-construct the WebSocket URL. Uses campId='api-call' for tracking.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - assistantId
 *               - fromNumber
 *             properties:
 *               number:
 *                 type: string
 *                 description: Phone number to call (with country code)
 *                 example: "+919608848421"
 *               assistantId:
 *                 type: string
 *                 description: Assistant/Bot ID (MongoDB ObjectId from assistant collection). Used to construct WebSocket URL automatically.
 *                 example: "678782afa8d9072894be7ca9"
 *               fromNumber:
 *                 type: string
 *                 description: Caller ID number
 *                 example: "+918035735659"
 *               wssUrl:
 *                 type: string
 *                 description: (OBSOLETE - ignored if provided) WebSocket URL is auto-constructed from assistantId. This field is accepted for backward compatibility but not used.
 *                 example: "wss://socket.glimpass.com/chat/v2/678782afa8d9072894be7ca9"
 *               firstName:
 *                 type: string
 *                 description: Contact first name (optional)
 *                 example: "John"
 *               email:
 *                 type: string
 *                 description: Contact email (optional)
 *                 example: "john@example.com"
 *               tag:
 *                 type: string
 *                 description: Custom tag for categorization (optional)
 *                 example: "hubspot-lead"
 *               provider:
 *                 type: string
 *                 description: Telephony provider (optional, auto-detected if not specified)
 *                 enum: [plivo, twilio]
 *                 example: "plivo"
 *     responses:
 *       200:
 *         description: Call initiated successfully
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
 *                   example: "Call initiated successfully"
 *                 callUUID:
 *                   type: string
 *                   example: "abc-123-def-456"
 *                 trackingId:
 *                   type: string
 *                   description: Same as callUUID, for HubSpot integration
 *                   example: "abc-123-def-456"
 *                 assistantId:
 *                   type: string
 *                   description: Assistant ID used for the call
 *                   example: "678782afa8d9072894be7ca9"
 *       400:
 *         description: Bad request - missing required fields (number, assistantId, fromNumber)
 *       401:
 *         description: Unauthorized - API key missing
 *       403:
 *         description: Forbidden - Invalid API key or assistant does not belong to client
 *       404:
 *         description: Assistant not found
 *       500:
 *         description: Internal server error
 */
router.post('/single-call', apiKeyValidator, async(req, res) => {
  try {
    const { number, assistantId, wssUrl, fromNumber, firstName, email, tag, provider, includeGlobalContext, includeAgentContext, global_context, Agent_context, ...customFields } = req.body;
    const clientData = req.clientData; // From API key middleware

    // Validate required fields - assistantId is required
    if (!number || !fromNumber || !assistantId) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: number, assistantId, fromNumber'
      });
    }

    // Verify assistant exists and belongs to this client
    const { getAssistantDetails } = require('./../apps/interLogue/client.js');
    const assistantData = await getAssistantDetails(assistantId);

    if (!assistantData || assistantData.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Assistant not found with ID: ${assistantId}`
      });
    }

    // Verify assistant belongs to the client making the request
    if (assistantData.clientId !== clientData._id.toString()) {
      console.log(`⚠️ Unauthorized assistant access attempt - Client: ${clientData.name} (${clientData._id}) tried to use assistant: ${assistantId} belonging to client: ${assistantData.clientId}`);
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to use this assistant'
      });
    }

    // Always construct wssUrl from assistantId (ignore wssUrl if provided)
    // Pattern: wss://socket.glimpass.com/chat/v2/{assistantId}
    const finalWssUrl = `wss://socket.glimpass.com/chat/v2/${assistantId}`;

    // Log if wssUrl was provided but will be ignored
    if (wssUrl) {
      console.log(`ℹ️ wssUrl provided but will be ignored, using constructed URL from assistantId`);
    }

    // Import unified call processing system
    const { processSingleCall } = require('./../apps/helper/activeCalls.js');

    console.log(`📞 API Call Request - Client: ${clientData.name}, To: ${number}, From: ${fromNumber}, Assistant: ${assistantId}`);

    // Process single call using unified system
    const callResult = await processSingleCall({
      clientId: clientData._id.toString(),
      campaignId: 'api-call', // Special identifier for API-initiated calls
      from: fromNumber,
      to: number,
      wssUrl: finalWssUrl,
      firstName: firstName || '',
      email: email || '',
      tag: tag || assistantId, // Use assistantId as tag for billing if no custom tag provided
      listId: 'api-call',
      provider: provider || null, // Optional: 'twilio' or 'plivo', auto-detected if not specified
      // Enhanced tracking for API calls
      contactIndex: 0,
      sequenceNumber: 1,
      contactData: { number, firstName, email, tag, assistantId, wssUrl: finalWssUrl, ...customFields },
      dynamicFields: { number, firstName, email, tag, assistantId, wssUrl: finalWssUrl, ...customFields },
      callSource: 'api-key', // Mark as API key initiated (vs 'jwt' for manual test)
      // NEW: Context flags for memory system (support both camelCase and snake_case)
      contextFlags: {
        includeGlobalContext: includeGlobalContext || global_context || false,
        includeAgentContext: includeAgentContext || Agent_context || false
      }
    });

    if (callResult.success) {
      console.log(`✅ API Call initiated: ${callResult.callUUID}`);
      res.status(200).json({
        success: true,
        message: 'Call initiated successfully',
        callUUID: callResult.callUUID,
        assistantId: assistantId
      });
    } else {
      console.error(`❌ API Call failed: ${callResult.error}`);
      res.status(500).json({
        success: false,
        message: callResult.error || 'Failed to initiate call'
      });
    }

  } catch(error) {
    console.error('❌ API single call error:', error);
    res.status(500).send({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
})

module.exports = router;