const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const {insertClient, getAssistantDetails, updateClient, getClientByClientId,  getStaff, getUser,getAllClients, getIvrLog, insertUsers, getStaffByClientId, getUserByClientId, getUserByStaffId, getAssistantByClientId, insertUser, insertStaff,  insertAssistant, insertSession, getClient, getAssistant, getSession, insertIvrLog,updateAssistant, getAllAssistants} = require('../apps/interLogue/client')
const {analyzeChat, createDietPdf, sendWATITemplateMessage} = require('../apps/interLogue/fitness')
const {callApiWithCallSid} = require('../apps/exotel/exotel')
const crypto = require("crypto");
const { 
  antiAutomationDelay,
  resetLoginAttempts,
  authenticateToken, 
  validateResourceOwnership, 
  auditLog 
} = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Interlogue
 *   description: Interlogue service integration for fitness and client management
 */

async function generateApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * @swagger
 * /interlogue/create-client:
 *   post:
 *     tags: [Interlogue]
 *     summary: Create a new client
 *     description: Creates a new client with auto-generated API key for Interlogue services
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *               - company
 *               - minutes
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *               password:
 *                 type: string
 *                 example: "password123"
 *               company:
 *                 type: string
 *                 example: "Acme Corp"
 *               minutes:
 *                 type: number
 *                 example: 60
 *     responses:
 *       200:
 *         description: Client created successfully
 *       500:
 *         description: Internal server error
 */
router.post('/create-client', async (req, res) => {
    try {
        const clientData = req.body;
        // const clientData = {name: 'piyush', email: 'warrior@glimpass.com', password: '12343', _id: '6635377d04863441e6c07cdf', company:'glimpass', minutes:60}
        clientData.apiKey = await generateApiKey()
        const result = await insertClient(clientData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/update-client', authenticateToken, validateResourceOwnership, auditLog, async(req, res) => {
    try{
        const clientId = req.body.clientId;
        const newDocs = req.body.newDocs;
        const result = await updateClient(clientId, newDocs);
        res.json(result.status).send({message: result.message});
    } catch(error){
        res.status(500).send({ message: "Internal Server Error", error });
    }
})

router.post('/get-client', antiAutomationDelay, auditLog, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Missing credentials',
                message: 'Email and password are required' 
            });
        }

        const clientData = await getClient(email, password);
        
        if (!clientData) {
            return res.status(401).json({ 
                error: 'Invalid credentials',
                message: 'Email or password is incorrect' 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                clientId: clientData._id.toString(),
                email: clientData.email,
                name: clientData.name,
                company: clientData.company
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        // Reset login attempts on successful login
        resetLoginAttempts(req.ip);
        
        // Return sanitized data with token
        const response = {
            success: true,
            user: {
                id: clientData._id,
                email: clientData.email,
                name: clientData.name,
                company: clientData.company,
                tokens: clientData.tokens,
                isActive: clientData.isActive,
                apiKey: clientData.apiKey, // Keep for backward compatibility
                incomingSet: clientData.incomingSet || [],
                callerNumbers: clientData.callerNumbers || []
            },
            token,
            expiresIn: process.env.JWT_EXPIRES_IN || '24h',
            message: 'Login successful'
        };

        res.json(response);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            error: 'Login failed',
            message: 'Internal server error during login' 
        });
    }
});
router.post('/get-client-by-clientId', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const clientId = req.body.clientId;
        const result = await getClientByClientId(clientId);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.get('/get-ivr-log', async (req, res) => {
    try {
        //const userId = req.body._id;
        // const userId = '663533bf9dc9cf669c98bce6';
        const result = await getIvrLog();
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.post('/get-assistant', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const unicode = req.body.unicode;
        // const unicode ='qwerty';
        const result = await getAssistant(unicode);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/get-assistant-details', async (req, res) => {
    try {
        // Check master key
        const { master_key_sprscrt, assistantId, customerNumber, listId } = req.body;

        if (!master_key_sprscrt || master_key_sprscrt !== process.env.MASTER_KEY) {
            return res.status(401).json({ error: "Invalid master key" });
        }

        const start = Date.now(); // Start time
        let result = await getAssistantDetails(assistantId);

        // If customerNumber and listId are provided, fetch CSV data and append to system prompt
        if (customerNumber && listId && result) {
            console.log(`📋 Fetching customer data for number: ${customerNumber}, listId: ${listId}`);

            try {
                const { getContactsFromList } = require('../apps/plivo/plivo.js');
                const contactResult = await getContactsFromList(customerNumber, listId);

                if (contactResult.status === 200 && contactResult.data && contactResult.data.length > 0) {
                    const contact = contactResult.data[0]; // Get first matching contact
                    console.log(`✅ Found customer data:`, contact);

                    // Format customer data as readable text
                    let customerDataText = '\n\n--- Customer Information ---\n';

                    // Add all CSV fields except internal ones
                    for (const [key, value] of Object.entries(contact)) {
                        if (!['_id', 'listId'].includes(key) && value) {
                            // Format field name (e.g., first_name -> First Name)
                            const fieldName = key.replace(/_/g, ' ')
                                .split(' ')
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(' ');
                            customerDataText += `${fieldName}: ${value}\n`;
                        }
                    }

                    // Append to system prompt at correct location: agent_prompts.task_1.system_prompt
                    if (result.payload && result.payload.agent_prompts && result.payload.agent_prompts.task_1 && result.payload.agent_prompts.task_1.system_prompt) {
                        result.payload.agent_prompts.task_1.system_prompt += customerDataText;
                        console.log(`✅ Appended customer data to payload.agent_prompts.task_1.system_prompt`);
                    } else if (result.agent_prompts && result.agent_prompts.task_1 && result.agent_prompts.task_1.system_prompt) {
                        result.agent_prompts.task_1.system_prompt += customerDataText;
                        console.log(`✅ Appended customer data to agent_prompts.task_1.system_prompt`);
                    } else {
                        console.warn(`⚠️ Could not find system_prompt field in expected location. Available keys:`, Object.keys(result));
                        if (result.payload) {
                            console.warn(`   payload keys:`, Object.keys(result.payload));
                        }
                    }

                    console.log(`📝 Customer data formatted and appended`);
                } else {
                    console.log(`⚠️ No customer data found for number: ${customerNumber}`);
                }
            } catch (csvError) {
                console.error(`❌ Error fetching customer data:`, csvError);
                // Continue without customer data - don't fail the entire request
            }
        }

        const end = Date.now(); // End time
        console.log(`API Response Time: ${end - start}ms`);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/create-assistant', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const assistantData = req.body;
        // Add clientId to assistant data
        assistantData.clientId = req.user.clientId;
        //  const assistantData = {name: 'piyush', email: 'warrior@glimpass.com', unicode: 'qwerty'}
        const result = await insertAssistant(assistantData);
        res.status(result.status).send({ _id: result.id });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/create-session',  async (req, res) => {
    try {
        const sessionData = req.body;
        //  const sessionData = {name: 'piyush', email: 'warrior@glimpass.com'}
        const result = await insertSession(sessionData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/get-session', async (req, res) => {
    try {
        const clientId = req.body._id;
        // const clientId = '663533bf9dc9cf669c98bce6';
        const result = await getSession(clientId);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

/**
 * @swagger
 * /interlogue/get-assistant-by-client:
 *   post:
 *     tags: [Interlogue]
 *     summary: Get assistants by client
 *     description: Retrieves all assistants associated with a specific client
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - _id
 *             properties:
 *               _id:
 *                 type: string
 *                 description: Client ID
 *                 example: "60d5ecb54b24c1001f7c8a92"
 *               isClient:
 *                 type: number
 *                 description: Client flag (0 or 1)
 *                 default: 0
 *                 example: 1
 *     responses:
 *       200:
 *         description: Assistants retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   unicode:
 *                     type: string
 *                   clientId:
 *                     type: string
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-assistant-by-client', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const clientId = req.body._id;
        const isClient = req.body.isClient || 0;
        // const unicode ='qwerty';
        const result = await getAssistantByClientId(clientId, isClient);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.post('/create-staff',  async (req, res) => {
    try {
        const staffData = req.body;
        //  const staffData = {name: 'piyush', email: 'warrior@glimpass.com'}
        const result = await insertStaff(staffData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.post('/create-ivr-log',  async (req, res) => {
    try {
        const staffData = req.body;
        //  const staffData = {name: 'piyush', email: 'warrior@glimpass.com'}
        const result = await insertIvrLog(staffData);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.post('/create-user',  async (req, res) => {
    try {
        const userData = req.body.userData;
        const isUpdate = req.body.isUpdate;
        //  const userData = {name: 'piyush', email: 'warrior@glimpass.com'}
        const result = await insertUsers(userData, isUpdate);
        res.status(result.status).send({ message: result.message });
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.post('/get-staff', async (req, res) => {
    try {
        const staffId = req.body._id;
        // const staffId = '663533bf9dc9cf669c98bce6';
        const result = await getStaff(staffId);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
}); 
router.post('/get-user', async (req, res) => {
    try {
        const userId = req.body._id;
        // const userId = '663533bf9dc9cf669c98bce6';
        const result = await getUser(userId);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
/**
 * @swagger
 * /interlogue/get-staff-by-client:
 *   post:
 *     tags: [Interlogue]
 *     summary: Get staff by client
 *     description: Retrieves all staff members associated with a specific client
 *     security:
 *       - bearerAuth: []
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
 *                 description: Client ID
 *                 example: "60d5ecb54b24c1001f7c8a92"
 *     responses:
 *       200:
 *         description: Staff members retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   clientId:
 *                     type: string
 *                   role:
 *                     type: string
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-staff-by-client', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const clientId = req.body.clientId;
        // const unicode ='qwerty';
        const result = await getStaffByClientId(clientId);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
/**
 * @swagger
 * /interlogue/get-user-by-client:
 *   post:
 *     tags: [Interlogue]
 *     summary: Get users by client
 *     description: Retrieves users associated with a specific client, optionally filtered by calling number
 *     security:
 *       - bearerAuth: []
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
 *                 description: Client ID
 *                 example: "60d5ecb54b24c1001f7c8a92"
 *               callingNumber:
 *                 type: string
 *                 description: Optional calling number filter
 *                 example: "+1234567890"
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   phone:
 *                     type: string
 *                   clientId:
 *                     type: string
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.post('/get-user-by-client', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const clientId = req.body.clientId;
        const callingNumber = req.body.callingNumber;
        // const unicode ='qwerty';
        const result = await getUserByClientId(clientId, callingNumber);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.post('/get-user-by-staff', async (req, res) => {
    try {
        const staffId = req.body.staffId;
        // const unicode ='qwerty';
        const result = await getUserByStaffId(staffId);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
/**
 * @swagger
 * /interlogue/get-all-clients:
 *   get:
 *     tags: [Interlogue]
 *     summary: Get all clients
 *     description: Retrieves a list of all clients in the system (admin access required)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Clients retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   company:
 *                     type: string
 *                   isActive:
 *                     type: boolean
 *                   tokens:
 *                     type: number
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.get('/get-all-clients', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const result = await getAllClients();
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
/**
 * @swagger
 * /interlogue/get-all-assistants:
 *   get:
 *     tags: [Interlogue]
 *     summary: Get all assistants
 *     description: Retrieves a list of all assistants in the system (admin access required)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assistants retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   unicode:
 *                     type: string
 *                   clientId:
 *                     type: string
 *                   isActive:
 *                     type: boolean
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       403:
 *         description: Forbidden - invalid JWT token or access denied
 *       500:
 *         description: Internal server error
 */
router.get('/get-all-assistants', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    console.log("hello");
	try {
        const result = await getAllAssistants();
	    console.log(result);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});

router.post('/update-assistant', authenticateToken, validateResourceOwnership, auditLog, async (req, res) => {
    try {
        const assistantId = req.body.assistantId;
       const docs = req.body.newDocs;
       const isClient = req.body.isClient || 0;
        const result = await updateAssistant(assistantId, docs, isClient);
        res.status(result.status).send({ message: result.message});
    } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
    }
});
router.get('/get-diet', async (req, res) => {
    const conversation = `
    Caller: Hi, I'm looking to gain 10 kg weight.
    AI: Sure, can you please tell me your height and weight and age?
    Caller: I'm 179 cm tall and weigh 70 kg and age 21.
    AI: are you allergic to any food and can you tell what you eat normally.
    Caller: i eat typical north indian meal and i am allergic to oatmeal.
    AI: can i send you diet plan on whatsapp.
    Caller: Yes please send
    `;
	try {
        // const result = await createDietPdf(conversation);
        sendWATITemplateMessage(ph_no)
	    // console.log(result);
        res.json(result)
    } catch (error) {
        res.status(500).send({ message: "Internal SPerver Error", error });
    }
});

router.get('/applet-call-back', async (req, res) => {
   const queryParam = req.query;
   const callSid = req.query.CallSid;
	try {
        const chatData = await callApiWithCallSid(callSid);
        const result =  createDietPdf(chatData.chat, queryParam.From);
	    res.status(200).send({ message: "message will be sent, currently in processing", error });
    } catch (error) {
        res.status(500).send({ message: "Internal SPerver Error", error });
    }
});

router.get('/markaible-applet-call-back', async (req, res) => {
    const queryParam = req.query;
    const callSid = req.query.CallSid;
    const ph_no = req.query.From;
     try {
        //  const chatData = await callApiWithCallSid(callSid);
        //  const result =  createDietPdf(chatData.chat, queryParam.From);
        sendWATITemplateMessage(ph_no)
        res.status(200).send({ message: "message will be sent, currently in processing", error });
     } catch (error) {
         res.status(500).send({ message: "Internal SPerver Error", error });
     }
 });
module.exports = router;
